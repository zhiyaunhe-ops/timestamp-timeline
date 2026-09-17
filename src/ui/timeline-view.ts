import { ItemView, MarkdownRenderer, Notice, TFile, WorkspaceLeaf, setIcon } from 'obsidian';
import type TimestampTimelinePlugin from '../main';
import { t } from '../i18n';
import {
  blockDigest,
  blocksToMarkdown,
  filterBlocks,
  groupByDay,
  groupByFile,
  plainLine,
  scanVault,
  sortBlocks,
  taskState,
  type FileGroup,
  type GroupMode,
  type ScanResult,
  type SortOrder,
  type Strictness,
  type TimelineBlock,
} from '../scan';
import { formatDate } from '../timestamp';

export const VIEW_TYPE_TIMELINE = 'timestamp-timeline-view';

/**
 * Vault-wide chronological view.
 *
 * Layout rationale:
 *   - a fixed left rail carries the time, so the eye scans one time column
 *     instead of hunting for times inside paragraphs;
 *   - blocks are grouped under sticky day headers, hung off a vertical spine;
 *   - every block folds to a few plain-text lines, individually or all at once,
 *     which is what makes a 40-block day readable;
 *   - the source note is a link that jumps to the exact line;
 *   - blocks render in batches, so a large vault stays scrollable.
 */
export class TimelineView extends ItemView {
  plugin: TimestampTimelinePlugin;

  private state: ScanResult | null = null;
  private scanning = false;
  private dirty = false;

  private query = '';
  private scopeMode: 'all' | 'file' | 'folder' = 'all';
  private order: SortOrder;
  private group: GroupMode;
  private strictness: Strictness;
  /** Only list blocks that still hold an unchecked task. */
  private onlyTasks: boolean;
  private visible = 0;

  private foldedAll: boolean;
  /** Explicit per-block folds/expands, overriding `foldedAll`. */
  private readonly folds = new Map<string, boolean>();
  private readonly collapsed = new Set<string>();

  private listEl!: HTMLElement;
  private statusEl!: HTMLElement;
  private searchEl!: HTMLInputElement;
  private foldBtn!: HTMLButtonElement;
  private taskBtn!: HTMLButtonElement;
  private scopeSelect!: HTMLSelectElement;

  constructor(leaf: WorkspaceLeaf, plugin: TimestampTimelinePlugin) {
    super(leaf);
    this.plugin = plugin;
    this.order = plugin.settings.tlSort;
    this.group = plugin.settings.tlGroupBy;
    this.strictness = plugin.settings.tlStrictness;
    this.onlyTasks = plugin.settings.tlOnlyTasks;
    this.foldedAll = plugin.settings.tlCollapseAll;
  }

  getViewType(): string {
    return VIEW_TYPE_TIMELINE;
  }

  getDisplayText(): string {
    return t('tl.title');
  }

  getIcon(): string {
    return 'calendar-clock';
  }

  async onOpen(): Promise<void> {
    this.buildUI();
    this.registerEvent(this.app.vault.on('modify', (file) => this.markDirty(file.path)));
    this.registerEvent(this.app.vault.on('create', (file) => this.markDirty(file.path)));
    this.registerEvent(this.app.vault.on('delete', (file) => this.markDirty(file.path)));
    this.registerEvent(
      this.app.workspace.on('active-leaf-change', () => {
        if (this.scopeMode !== 'all') this.render();
      }),
    );
    await this.refresh();
  }

  /** Called by the plugin when the UI language changes. */
  async rebuild(): Promise<void> {
    this.buildUI();
    this.render();
  }

  /** Re-read the fold-all default after it changed in the settings panel. */
  applyCollapseSetting(): void {
    this.foldedAll = this.plugin.settings.tlCollapseAll;
    this.folds.clear();
    this.syncFoldButton();
    this.render();
  }

  /** Re-read the task-only default after it changed in the settings panel. */
  applyOnlyTasksSetting(): void {
    this.onlyTasks = this.plugin.settings.tlOnlyTasks;
    this.visible = 0;
    this.syncTaskButton();
    this.render();
  }

  private markDirty(path: string): void {
    if (!path.endsWith('.md')) return;
    this.dirty = true;
    this.renderStatus();
  }

  // ---------------------------------------------------------------- UI build

  private buildUI(): void {
    const container = this.contentEl;
    container.empty();
    container.addClass('ai-ns-tl-view');

    const bar = container.createDiv({ cls: 'ai-ns-tl-bar' });

    this.searchEl = bar.createEl('input', { cls: 'ai-ns-tl-search', type: 'search' });
    this.searchEl.placeholder = t('tl.search');
    this.searchEl.value = this.query;
    this.searchEl.oninput = () => {
      this.query = this.searchEl.value;
      this.visible = 0;
      this.render();
    };

    const selects = bar.createDiv({ cls: 'ai-ns-tl-selects' });

    this.scopeSelect = this.makeSelect(
      selects,
      t('tl.scope'),
      [
        ['all', t('tl.scope.all')],
        ['file', t('tl.scope.file')],
        ['folder', t('tl.scope.folder')],
      ],
      this.scopeMode,
      (value) => {
        this.scopeMode = value as 'all' | 'file' | 'folder';
        this.visible = 0;
        this.render();
      },
    );

    this.makeSelect(
      selects,
      t('tl.sortLabel'),
      [
        ['desc', t('set.tlSort.new')],
        ['asc', t('set.tlSort.old')],
      ],
      this.order,
      (value) => {
        this.order = value as SortOrder;
        this.plugin.settings.tlSort = this.order;
        void this.plugin.saveSettings();
        this.render();
      },
    );

    this.makeSelect(
      selects,
      t('tl.groupLabel'),
      [
        ['day', t('set.tlGroup.day')],
        ['file', t('set.tlGroup.file')],
        ['none', t('set.tlGroup.none')],
      ],
      this.group,
      (value) => {
        this.group = value as GroupMode;
        this.plugin.settings.tlGroupBy = this.group;
        void this.plugin.saveSettings();
        this.render();
      },
    );

    this.makeSelect(
      selects,
      t('set.tlStrict.name'),
      [
        ['strict', t('set.tlStrict.strict')],
        ['normal', t('set.tlStrict.normal')],
        ['loose', t('set.tlStrict.loose')],
      ],
      this.strictness,
      (value) => {
        this.strictness = value as Strictness;
        this.plugin.settings.tlStrictness = this.strictness;
        void this.plugin.saveSettings();
        void this.refresh();
      },
    );

    const actions = bar.createDiv({ cls: 'ai-ns-tl-actions' });

    this.taskBtn = actions.createEl('button', { cls: 'ai-ns-mini ai-ns-tl-onlytasks' });
    this.taskBtn.onclick = () => this.toggleOnlyTasks();

    this.foldBtn = actions.createEl('button', { cls: 'ai-ns-mini ai-ns-tl-foldall' });
    this.foldBtn.onclick = () => this.toggleFoldAll();

    const rescanBtn = actions.createEl('button', { cls: 'ai-ns-icon-btn' });
    setIcon(rescanBtn, 'refresh-cw');
    rescanBtn.setAttr('aria-label', t('tl.refresh'));
    rescanBtn.setAttr('title', t('tl.refresh'));
    rescanBtn.onclick = () => void this.refresh();

    const copyBtn = actions.createEl('button', { cls: 'ai-ns-icon-btn' });
    setIcon(copyBtn, 'copy');
    copyBtn.setAttr('aria-label', t('tl.copyAll'));
    copyBtn.setAttr('title', t('tl.copyAll'));
    copyBtn.onclick = () => void this.copyAll();

    const exportBtn = actions.createEl('button', { cls: 'mod-cta ai-ns-mini' });
    exportBtn.setText(t('tl.export'));
    exportBtn.onclick = () => void this.exportNote();

    this.statusEl = container.createDiv({ cls: 'ai-ns-tl-status' });

    const scroll = container.createDiv({ cls: 'ai-ns-tl-scroll' });
    this.listEl = scroll.createDiv({ cls: 'ai-ns-tl-list' });

    this.syncFoldButton();
    this.syncTaskButton();
  }

  private makeSelect(
    parent: HTMLElement,
    label: string,
    options: Array<[string, string]>,
    value: string,
    onChange: (value: string) => void,
  ): HTMLSelectElement {
    const wrap = parent.createDiv({ cls: 'ai-ns-tl-select' });
    wrap.createSpan({ cls: 'ai-ns-tl-select-label', text: label });
    const select = wrap.createEl('select');
    for (const [val, text] of options) {
      select.createEl('option', { text }).value = val;
    }
    select.value = value;
    select.onchange = () => onChange(select.value);
    return select;
  }

  // ------------------------------------------------------------------ folding

  /** Folding is off entirely when the line budget is 0. */
  private foldingEnabled(): boolean {
    return this.plugin.settings.tlCollapsedLines > 0;
  }

  private static keyOf(block: TimelineBlock): string {
    return `${block.filePath}:${block.stamp.line}`;
  }

  private isFolded(block: TimelineBlock): boolean {
    return this.folds.get(TimelineView.keyOf(block)) ?? this.foldedAll;
  }

  /** Fold a whole day (or file group) down to one line per block. */
  private toggleDay(key: string): void {
    if (this.collapsed.has(key)) this.collapsed.delete(key);
    else this.collapsed.add(key);
    this.render();
  }

  private toggleFold(block: TimelineBlock, evt?: Event): void {
    evt?.stopPropagation();
    if (!this.foldingEnabled()) return;
    this.folds.set(TimelineView.keyOf(block), !this.isFolded(block));
    this.render();
  }

  private toggleFoldAll(): void {
    if (!this.foldingEnabled()) {
      new Notice(t('set.tlLines.name'));
      return;
    }
    this.foldedAll = !this.foldedAll;
    this.folds.clear();
    this.plugin.settings.tlCollapseAll = this.foldedAll;
    void this.plugin.saveSettings();
    this.syncFoldButton();
    this.render();
  }

  private syncFoldButton(): void {
    if (!this.foldBtn) return;
    this.foldBtn.setText(this.foldedAll ? t('tl.unfoldAll') : t('tl.foldAll'));
    this.foldBtn.setAttr('aria-pressed', String(this.foldedAll));
    this.foldBtn.toggleClass('is-active', this.foldedAll);
  }

  /** Task filter is a view-level toggle, mirrored into the plugin settings. */
  private toggleOnlyTasks(): void {
    this.onlyTasks = !this.onlyTasks;
    this.plugin.settings.tlOnlyTasks = this.onlyTasks;
    void this.plugin.saveSettings();
    this.visible = 0;
    this.syncTaskButton();
    this.render();
  }

  private syncTaskButton(): void {
    if (!this.taskBtn) return;
    this.taskBtn.setText(this.onlyTasks ? t('tl.allTasks') : t('tl.onlyTasks'));
    this.taskBtn.setAttr('aria-pressed', String(this.onlyTasks));
    this.taskBtn.setAttr(
      'title',
      this.onlyTasks ? t('tl.onlyTasksOn') : t('tl.onlyTasksOff'),
    );
    this.taskBtn.toggleClass('is-active', this.onlyTasks);
  }

  /**
   * Plain-text digest used while a block is folded. Deliberately not markdown:
   * a two-line clamp of a table source renders as an empty table, plain text
   * does not.
   */
  private preview(block: TimelineBlock, lines: number): { text: string; omitted: number } {
    const all = block.content.split('\n');
    const shown = all.slice(0, lines).map(plainLine).filter((l) => l.length > 0);
    const omitted = all.slice(lines).filter((l) => l.trim().length > 0).length;
    let text = shown.join('\n');
    if (text.length > 260) text = `${text.slice(0, 260)}…`;
    return { text, omitted };
  }

  // ----------------------------------------------------------------- scanning

  async refresh(): Promise<void> {
    if (this.scanning) return;
    this.scanning = true;
    this.statusEl?.setText(t('tl.scanning'));
    try {
      this.state = await scanVault(this.app, this.plugin.scanSettings());
      this.dirty = false;
      this.visible = 0;
      this.render();
    } catch (err) {
      new Notice(`${t('msg.error')}${(err as Error).message}`);
      this.statusEl?.setText(`${t('msg.error')}${(err as Error).message}`);
    } finally {
      this.scanning = false;
    }
  }

  // ------------------------------------------------------------------- render

  private filteredBlocks(): TimelineBlock[] {
    if (!this.state) return [];
    const active = this.app.workspace.getActiveFile();
    return filterBlocks(this.state.blocks, {
      query: this.query.trim().toLowerCase(),
      filePath: this.scopeMode === 'file' ? active?.path : undefined,
      folderPath:
        this.scopeMode === 'folder' ? (active?.parent?.path ?? '') : undefined,
      hideEmpty: this.plugin.settings.tlHideEmpty,
      onlyTasks: this.onlyTasks,
    });
  }

  /**
   * Scope is chosen once but the target note is whatever is focused now, so the
   * folder option label tracks the live folder: "当前文件夹（海航项目）".
   * Always edits the folder option by value — rewriting the *selected* option
   * would rename "全库" the moment you switch away.
   */
  private syncScopeLabel(): void {
    if (!this.scopeSelect) return;
    const option = Array.from(this.scopeSelect.options).find((o) => o.value === 'folder');
    if (!option) return;
    let text = t('tl.scope.folder');
    if (this.scopeMode === 'folder') {
      const active = this.app.workspace.getActiveFile();
      const name = active ? active.parent?.name || t('tl.rootFolder') : t('tl.noFile');
      text = `${t('tl.scope.folder')}（${name}）`;
    }
    if (option.text !== text) option.text = text;
  }

  /** The folder the view is currently scoped to, if any. */
  private scopedFolder(): string | null {
    if (this.scopeMode !== 'folder') return null;
    return this.app.workspace.getActiveFile()?.parent?.path ?? '';
  }

  render(): void {
    if (!this.listEl) return;
    this.syncScopeLabel();
    this.renderStatus();
    this.syncFoldButton();
    this.syncTaskButton();
    this.listEl.empty();

    const blocks = this.filteredBlocks();
    if (blocks.length === 0) {
      const empty = this.onlyTasks ? t('tl.emptyTasks') : t('tl.empty');
      this.listEl.createDiv({ cls: 'ai-ns-tl-empty', text: empty });
      return;
    }

    if (this.visible === 0) this.visible = this.plugin.settings.tlPageSize;
    let emitted = 0;

    /**
     * Appends one block to the group that owns it, never to the list root.
     * Handing `this.listEl` to every group was what pushed a card out of its
     * own day: the header stayed inside an empty group, the card landed between
     * two groups, and the date ended up closer to the *next* day than to its
     * own block. `outline` renders the one-line stand-in used by folded groups.
     */
    const emit = (parent: HTMLElement, block: TimelineBlock, outline = false): boolean => {
      if (emitted >= this.visible) return false;
      if (outline) this.renderOutlineRow(parent, block);
      else this.renderCard(parent, block);
      emitted += 1;
      return true;
    };

    if (this.group === 'day') {
      for (const day of groupByDay(blocks, this.order)) {
        if (emitted >= this.visible) break;
        const groupEl = this.listEl.createDiv({ cls: 'ai-ns-tl-day' });
        const folded = this.collapsed.has(day.key);
        const head = groupEl.createDiv({ cls: 'ai-ns-tl-dayhead' });
        head.toggleClass('is-collapsed', folded);

        // A real button, not a decorative span: the chevron has to look and
        // behave like the control it is.
        const chevron = head.createEl('button', { cls: 'ai-ns-tl-chevron', attr: { type: 'button' } });
        setIcon(chevron, folded ? 'chevron-right' : 'chevron-down');
        chevron.setAttr('aria-expanded', String(!folded));
        chevron.setAttr('aria-label', folded ? t('tl.unfoldDay') : t('tl.foldDay'));
        chevron.setAttr('title', folded ? t('tl.unfoldDay') : t('tl.foldDay'));
        chevron.addEventListener('click', (evt) => {
          evt.stopPropagation();
          this.toggleDay(day.key);
        });

        head.createSpan({ cls: 'ai-ns-tl-daydate', text: day.key });
        head.createSpan({
          cls: 'ai-ns-tl-dayweek',
          text: formatDate(day.date, 'ddd', this.plugin.currentLang()),
        });
        if (folded) head.createSpan({ cls: 'ai-ns-tl-foldstate', text: t('tl.foldedTag') });
        head.createSpan({ cls: 'ai-ns-tl-daycount', text: `${day.blocks.length}` });
        head.addEventListener('click', () => this.toggleDay(day.key));

        // A folded day keeps every block, compressed to one line each — nothing
        // silently vanishes, which is what made the old hide-everything version
        // read as "clicking does nothing".
        if (folded) {
          const outline = groupEl.createDiv({ cls: 'ai-ns-tl-outline' });
          for (const block of day.blocks) if (!emit(outline, block, true)) break;
          continue;
        }

        const body = groupEl.createDiv({ cls: 'ai-ns-tl-daybody' });
        for (const block of day.blocks) if (!emit(body, block)) break;
      }
    } else if (this.group === 'file') {
      for (const file of groupByFile(blocks, this.order)) {
        if (emitted >= this.visible) break;
        this.renderFileGroup(file, emit);
      }
    } else {
      for (const block of sortBlocks(blocks, this.order)) if (!emit(this.listEl, block)) break;
    }

    if (emitted < blocks.length) {
      const more = this.listEl.createEl('button', { cls: 'ai-ns-tl-more' });
      more.setText(`${t('tl.more')} · ${t('tl.remaining')} ${blocks.length - emitted}`);
      more.onclick = () => {
        this.visible += this.plugin.settings.tlPageSize;
        this.render();
      };
    }
  }

  private renderFileGroup(
    group: FileGroup,
    emit: (parent: HTMLElement, block: TimelineBlock, outline?: boolean) => boolean,
  ): void {
    const groupEl = this.listEl.createDiv({ cls: 'ai-ns-tl-file' });
    const key = `file:${group.path}`;
    const folded = this.collapsed.has(key);
    const head = groupEl.createDiv({ cls: 'ai-ns-tl-filehead' });
    head.toggleClass('is-collapsed', folded);

    const chevron = head.createEl('button', { cls: 'ai-ns-tl-chevron', attr: { type: 'button' } });
    setIcon(chevron, folded ? 'chevron-right' : 'chevron-down');
    chevron.setAttr('aria-expanded', String(!folded));
    chevron.addEventListener('click', (evt) => {
      evt.stopPropagation();
      this.toggleDay(key);
    });

    head.createSpan({ cls: 'ai-ns-tl-filelink', text: group.basename });
    if (folded) head.createSpan({ cls: 'ai-ns-tl-foldstate', text: t('tl.foldedTag') });
    head.createSpan({ cls: 'ai-ns-tl-daycount', text: `${group.blocks.length}` });
    head.addEventListener('click', () => this.toggleDay(key));

    if (folded) {
      const outline = groupEl.createDiv({ cls: 'ai-ns-tl-outline' });
      for (const block of group.blocks) if (!emit(outline, block, true)) break;
      return;
    }

    const body = groupEl.createDiv({ cls: 'ai-ns-tl-daybody' });
    for (const block of group.blocks) if (!emit(body, block)) break;
  }

  /** One compact, clickable row standing in for a whole block. */
  private renderOutlineRow(parent: HTMLElement, block: TimelineBlock): void {
    const row = parent.createDiv({ cls: 'ai-ns-tl-outline-row' });
    row.setText(
      blockDigest(block, this.plugin.settings.stampTimeFormat, this.plugin.currentLang()),
    );
    if (block.content.trim().length === 0) row.addClass('is-empty');
    row.setAttr('title', `${block.filePath} : ${block.stamp.line + 1}`);
    row.addEventListener('click', () => void this.openBlock(block));
  }

  private renderStatus(): void {
    if (!this.statusEl) return;
    const blocks = this.state?.blocks ?? [];
    const filtered = this.filteredBlocks().length;
    const hidden = this.plugin.settings.tlHideEmpty
      ? blocks.filter((b) => b.content.trim().length === 0).length
      : 0;

    const parts = [
      `${filtered} / ${blocks.length} ${t('tl.count')}`,
      `${this.state?.stampedFileCount ?? 0}/${this.state?.fileCount ?? 0} ${t('tl.files')}`,
    ];

    if (this.onlyTasks) parts.push(t('tl.onlyTasksOn'));

    const folder = this.scopedFolder();
    if (folder !== null) {
      parts.push(`${t('tl.scope.folder')}：${folder || t('tl.rootFolder')}`);
    }
    if (hidden > 0) parts.push(`${t('tl.hiddenEmpty')} ${hidden} ${t('tl.hiddenEmptySuffix')}`);
    if (this.dirty) parts.push(`⚠ ${t('tl.refresh')}`);

    this.statusEl.setText(parts.join(' · '));
  }

  // -------------------------------------------------------------------- cards

  private renderCard(parent: HTMLElement, block: TimelineBlock): void {
    const folded = this.foldingEnabled() && this.isFolded(block);
    const task = taskState(block.content);
    const card = parent.createDiv({ cls: 'ai-ns-tl-card' });
    if (block.fromFilename) card.addClass('is-filename');
    if (folded) card.addClass('is-folded');
    if (task === 'done') card.addClass('is-done');

    const rail = card.createDiv({ cls: 'ai-ns-tl-rail' });
    if (block.stamp.hasTime) {
      rail.createSpan({
        cls: 'ai-ns-tl-time',
        text: formatDate(block.stamp.date, this.plugin.settings.stampTimeFormat, this.plugin.currentLang()),
      });
    } else {
      rail.createSpan({ cls: 'ai-ns-tl-time is-dateonly', text: '—' });
    }
    if (block.stamp.label) rail.createSpan({ cls: 'ai-ns-tl-tag', text: block.stamp.label });

    const main = card.createDiv({ cls: 'ai-ns-tl-main' });

    const head = main.createDiv({ cls: 'ai-ns-tl-cardhead' });
    if (this.foldingEnabled()) {
      const foldBtn = head.createEl('button', { cls: 'ai-ns-tl-fold', attr: { type: 'button' } });
      setIcon(foldBtn, folded ? 'chevron-right' : 'chevron-down');
      foldBtn.setAttr('aria-expanded', String(!folded));
      foldBtn.setAttr('aria-label', folded ? t('tl.unfold') : t('tl.fold'));
      foldBtn.setAttr('title', folded ? t('tl.unfold') : t('tl.fold'));
      foldBtn.addEventListener('click', (evt) => this.toggleFold(block, evt));
      // The head row is a second, larger hit target for the same action.
      head.addClass('is-clickable');
      head.addEventListener('click', (evt) => this.toggleFold(block, evt));
    }

    // Task state badge — only meaningful for blocks that actually hold one.
    if (task !== 'none') {
      const badge = head.createSpan({
        cls: `ai-ns-tl-task is-${task}`,
        text: task === 'todo' ? '☐' : '☑',
      });
      badge.setAttr('title', task === 'todo' ? t('tl.taskTodo') : t('tl.taskDone'));
    }

    const link = head.createEl('a', { cls: 'ai-ns-tl-src', text: block.fileBasename, href: '#' });
    link.setAttr('title', `${block.filePath} : ${block.stamp.line + 1}`);
    link.addEventListener('click', (evt) => {
      evt.preventDefault();
      evt.stopPropagation();
      void this.openBlock(block);
    });
    if (block.heading) head.createSpan({ cls: 'ai-ns-tl-crumb', text: `› ${block.heading}` });
    if (block.fromFilename) head.createSpan({ cls: 'ai-ns-tl-badge', text: t('tl.fromFilename') });

    const actions = head.createDiv({ cls: 'ai-ns-tl-cardactions' });

    const copyBtn = actions.createEl('button', { cls: 'ai-ns-icon-btn' });
    setIcon(copyBtn, 'copy');
    copyBtn.setAttr('aria-label', t('tl.copy'));
    copyBtn.addEventListener('click', (evt) => {
      evt.stopPropagation();
      void this.copyBlock(block);
    });

    const openBtn = actions.createEl('button', { cls: 'ai-ns-icon-btn' });
    setIcon(openBtn, 'corner-down-right');
    openBtn.setAttr('aria-label', t('tl.open'));
    openBtn.addEventListener('click', (evt) => {
      evt.stopPropagation();
      void this.openBlock(block);
    });

    if (block.content.trim().length === 0) {
      main.createDiv({ cls: 'ai-ns-tl-nobody', text: '—' });
      return;
    }

    if (folded) {
      const { text, omitted } = this.preview(block, this.plugin.settings.tlCollapsedLines);
      const preview = main.createDiv({ cls: 'ai-ns-tl-folded' });
      preview.setText(text);
      if (omitted > 0) {
        preview.createSpan({ cls: 'ai-ns-tl-morelines', text: `  +${omitted} ${t('tl.linesOmitted')}` });
      }
      return;
    }

    const body = main.createDiv({ cls: 'ai-ns-tl-body' });
    if (!this.plugin.settings.tlRenderMarkdown) {
      body.createEl('div', { cls: 'ai-ns-tl-pre', text: block.content });
      return;
    }
    MarkdownRenderer.render(this.app, block.content, body, block.filePath, this).catch(() => {
      body.empty();
      body.createEl('div', { cls: 'ai-ns-tl-pre', text: block.content });
    });
  }

  // ------------------------------------------------------------------ actions

  private async openBlock(block: TimelineBlock): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(block.filePath);
    if (!(file instanceof TFile)) {
      new Notice(t('msg.noFile'));
      return;
    }
    const leaf = this.app.workspace.getLeaf(false);
    await leaf.openFile(file);
    const editor = (leaf.view as {
      editor?: {
        setCursor(pos: { line: number; ch: number }): void;
        scrollIntoView(range: unknown, center: boolean): void;
      };
    }).editor;
    if (!editor) return;
    const line = Math.max(0, block.stamp.line);
    editor.setCursor({ line, ch: 0 });
    editor.scrollIntoView({ from: { line, ch: 0 }, to: { line, ch: 0 } }, true);
  }

  private blockMarkdown(block: TimelineBlock): string {
    const time = block.stamp.hasTime
      ? formatDate(block.stamp.date, this.plugin.settings.stampTimeFormat, this.plugin.currentLang())
      : '';
    const label = block.stamp.label ? ` ${block.stamp.label}` : '';
    return `### ${time}${label} · [[${block.fileBasename}]]\n\n${block.content}`.trim();
  }

  private async copyBlock(block: TimelineBlock): Promise<void> {
    await navigator.clipboard.writeText(this.blockMarkdown(block));
    new Notice(t('tl.copied'));
  }

  private documentMarkdown(): string {
    return blocksToMarkdown(this.filteredBlocks(), {
      title: t('tl.exportTitle'),
      order: this.order,
      timeFormat: this.plugin.settings.stampTimeFormat,
      lang: this.plugin.currentLang(),
      includeSource: true,
      maxChars: 0,
    });
  }

  private async copyAll(): Promise<void> {
    const blocks = this.filteredBlocks();
    if (blocks.length === 0) {
      new Notice(this.onlyTasks ? t('tl.emptyTasks') : t('tl.empty'));
      return;
    }
    await navigator.clipboard.writeText(this.documentMarkdown());
    new Notice(t('tl.copied'));
  }

  private async exportNote(): Promise<void> {
    const blocks = this.filteredBlocks();
    if (blocks.length === 0) {
      new Notice(this.onlyTasks ? t('tl.emptyTasks') : t('tl.empty'));
      return;
    }
    const stamp = formatDate(new Date(), 'YYYY-MM-DD HHmm', 'zh');
    const folder = this.app.workspace.getActiveFile()?.parent?.path;
    const prefix = folder ? `${folder}/` : '';
    const base = `${t('tl.exportTitle')} ${stamp}`;

    let path = `${prefix}${base}.md`;
    let n = 2;
    while (this.app.vault.getAbstractFileByPath(path)) {
      path = `${prefix}${base} ${n}.md`;
      n += 1;
    }
    const file = await this.app.vault.create(path, this.documentMarkdown());
    await this.app.workspace.getLeaf(true).openFile(file);
    new Notice(`${t('tl.exported')}${file.path}`);
  }

  async onClose(): Promise<void> {
    this.contentEl.empty();
  }
}
