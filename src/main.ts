import { MarkdownView, Notice, Plugin, debounce, type Editor, type WorkspaceLeaf } from 'obsidian';
import { TimelineSettingTab, DEFAULT_SETTINGS, type TimelineSettings } from './settings';
import { getLang, setLang, t } from './i18n';
import { TimelineView, VIEW_TYPE_TIMELINE } from './ui/timeline-view';
import { analyzeLine, buildStamp, verdictForText, type StampFormatConfig } from './timestamp';
import { confidenceThreshold, type ScanSettings } from './scan';

/** `*,//,~~` → `['*', '//', '~~']`. Entries may be written as literal text. */
export function parseMarkers(spec: string): string[] {
  return spec
    .split(/[,，\n]/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

export default class TimestampTimelinePlugin extends Plugin {
  settings!: TimelineSettings;

  /** Non-zero while the plugin itself is writing to the document. */
  private stampGuard = 0;
  /** Wall clock of the last programmatic insert, as a second line of defence. */
  private stampAt = 0;
  private stampTarget: Editor | null = null;
  private queueStamp?: () => void;

  async onload(): Promise<void> {
    await this.loadSettings();
    setLang(this.settings.language);

    this.registerView(VIEW_TYPE_TIMELINE, (leaf) => new TimelineView(leaf, this));
    // The timeline wants a whole tab, so it gets its own ribbon icon.
    this.addRibbonIcon('calendar-clock', t('ribbon.timeline'), () => void this.activateTimeline());
    this.addSettingTab(new TimelineSettingTab(this.app, this));

    this.registerCommands();
    this.registerEditorMenu();
    this.registerAutoStamp();
  }

  onunload(): void {
    this.app.workspace.detachLeavesOfType(VIEW_TYPE_TIMELINE);
  }

  // ------------------------------------------------------------------ settings

  async loadSettings(): Promise<void> {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }

  /** Re-render open views after a language change. */
  refreshUI(): void {
    setLang(this.settings.language);
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_TIMELINE)) {
      if (leaf.view instanceof TimelineView) void leaf.view.rebuild();
    }
  }

  currentLang(): 'zh' | 'en' {
    return getLang();
  }

  /** Open the timeline in a main-area tab (it wants the width). */
  async activateTimeline(): Promise<void> {
    const { workspace } = this.app;
    const existing = workspace.getLeavesOfType(VIEW_TYPE_TIMELINE);
    if (existing.length > 0) {
      await workspace.revealLeaf(existing[0]);
      if (existing[0].view instanceof TimelineView) void existing[0].view.refresh();
      return;
    }
    const leaf: WorkspaceLeaf = workspace.getLeaf('tab');
    await leaf.setViewState({ type: VIEW_TYPE_TIMELINE, active: true });
    await workspace.revealLeaf(leaf);
  }

  // ------------------------------------------------------- timeline plumbing

  scanSettings(): ScanSettings {
    const s = this.settings;
    return {
      strictness: s.tlStrictness,
      includeTimeOnly: s.tlIncludeTimeOnly,
      useFilenameDate: s.tlUseFilenameDate,
      breakAtHeadings: s.tlBreakAtHeadings,
      allowPartialDates: s.tlAllowPartialDates,
      ignoreMarkers: parseMarkers(s.tlIgnoreMarkers),
      excludeFolders: s.tlExcludeFolders,
    };
  }

  /** Re-draw open timelines after a display-only setting changed. */
  refreshTimeline(): void {
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_TIMELINE)) {
      if (leaf.view instanceof TimelineView) leaf.view.render();
    }
  }

  /** "Start fully folded" changed — push it into the open views. */
  applyCollapseSetting(): void {
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_TIMELINE)) {
      if (leaf.view instanceof TimelineView) leaf.view.applyCollapseSetting();
    }
  }

  /** "Only unfinished tasks" changed — push it into the open views. */
  applyOnlyTasksSetting(): void {
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_TIMELINE)) {
      if (leaf.view instanceof TimelineView) leaf.view.applyOnlyTasksSetting();
    }
  }

  // ------------------------------------------------------- timestamp plumbing

  stampConfig(): StampFormatConfig {
    const s = this.settings;
    return {
      template: s.stampTemplate,
      dateFormat: s.stampDateFormat,
      timeFormat: s.stampTimeFormat,
      segments: s.stampSegments,
      lang: getLang(),
    };
  }

  /**
   * Validate what would be inserted, without touching the document. Used by the
   * "smart" command and by the auto-insert path so both share one rule.
   */
  stampVerdict(editor: Editor): ReturnType<typeof verdictForText> {
    const cursor = editor.getCursor();
    const above = editor.getRange({ line: 0, ch: 0 }, { line: cursor.line, ch: 0 });
    return verdictForText(above, new Date(), {
      ...this.stampConfig(),
      thresholdHours: this.settings.stampThresholdHours,
      stampOnSegmentChange: this.settings.stampOnSegmentChange,
      minConfidence: confidenceThreshold('normal'),
      // Transcript-style `HH:mm` lines are not "records" — ignore them here.
      allowTimeOnly: false,
    });
  }

  /** Insert a stamp above the cursor's line. Returns false when nothing changed. */
  insertStampAtCursor(editor: Editor, force = false): boolean {
    if (!force && this.stampVerdict(editor).skip) {
      new Notice(t('msg.stampFresh'));
      return false;
    }

    const cursor = editor.getCursor();
    const lineText = editor.getLine(cursor.line) ?? '';
    // Someone already started this line with a stamp — leave it alone.
    const own = analyzeLine(lineText, cursor.line, { allowTimeOnly: false });
    if (own && own.token.hasDate && own.confidence >= confidenceThreshold('normal')) {
      new Notice(t('msg.stampFresh'));
      return false;
    }

    const blank = this.settings.stampBlankLineAfter;
    const text = `${buildStamp(new Date(), this.stampConfig())}\n${blank ? '\n' : ''}`;
    const insertedLines = blank ? 2 : 1;

    this.stampGuard += 1;
    try {
      editor.replaceRange(text, { line: cursor.line, ch: 0 });
    } finally {
      this.stampGuard -= 1;
      this.stampAt = Date.now();
    }

    editor.setCursor({ line: cursor.line + insertedLines, ch: cursor.ch });
    return true;
  }

  // ------------------------------------------------------------- auto stamping

  private registerAutoStamp(): void {
    this.queueStamp = debounce(
      () => {
        const editor = this.stampTarget;
        this.stampTarget = null;
        if (!editor || this.stampGuard > 0) return;
        void this.runAutoStamp(editor);
      },
      1500,
      true,
    );

    this.registerEvent(
      this.app.workspace.on('editor-change', (editor) => {
        if (!this.settings.stampAutoInsert) return;
        if (this.stampGuard > 0) return;
        if (Date.now() - this.stampAt < 400) return;
        this.stampTarget = editor;
        this.queueStamp?.();
      }),
    );

    this.registerEvent(
      this.app.workspace.on('active-leaf-change', () => {
        this.queueStamp?.();
        this.stampTarget = null;
      }),
    );
  }

  private async runAutoStamp(editor: Editor): Promise<void> {
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (!view || view.editor !== editor) return;
    if (!this.settings.stampAutoInsert) return;

    const cursor = editor.getCursor();
    const lineText = editor.getLine(cursor.line) ?? '';

    // Nothing worth stamping yet.
    if (lineText.trim().length === 0) return;

    if (this.settings.stampScope === 'endOfNote') {
      // Only fire when the cursor sits on the last non-empty line — i.e. the
      // user is writing at the bottom. Editing older text is never touched.
      for (let i = cursor.line + 1; i <= editor.lastLine(); i += 1) {
        if ((editor.getLine(i) ?? '').trim().length > 0) return;
      }
    }

    if (this.stampVerdict(editor).skip) return;
    this.insertStampAtCursor(editor, true);
  }

  // ------------------------------------------------------------------ commands

  private registerCommands(): void {
    this.addCommand({
      id: 'insert-timestamp',
      name: t('cmd.insertStamp'),
      editorCallback: (editor) => {
        if (this.insertStampAtCursor(editor, false)) new Notice(t('msg.stampInserted'));
      },
    });

    this.addCommand({
      id: 'force-insert-timestamp',
      name: t('cmd.forceStamp'),
      editorCallback: (editor) => {
        if (this.insertStampAtCursor(editor, true)) new Notice(t('msg.stampInserted'));
      },
    });

    this.addCommand({
      id: 'open-timeline',
      name: t('cmd.openTimeline'),
      callback: () => void this.activateTimeline(),
    });
  }

  private registerEditorMenu(): void {
    this.registerEvent(
      this.app.workspace.on('editor-menu', (menu, editor) => {
        menu.addItem((item) =>
          item
            .setTitle(t('menu.stamp'))
            .setIcon('clock')
            .onClick(() => {
              if (this.insertStampAtCursor(editor, false)) new Notice(t('msg.stampInserted'));
            }),
        );
      }),
    );
  }
}
