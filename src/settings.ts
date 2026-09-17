import { App, Notice, PluginSettingTab, Setting } from 'obsidian';
import type TimelinePlugin from './main';
import { setLang, t, type LangMode } from './i18n';
import { scanVault, type Strictness } from './scan';
import { buildStamp, DEFAULT_SEGMENTS_ZH, DEFAULT_STAMP_TEMPLATE } from './timestamp';
import { dateFormatHelp } from './format-help';

export interface TimelineSettings {
  language: LangMode;

  // ------------------------------------------------------------- timestamps
  /** Insert a timestamp while writing when the preceding text has none recent. */
  stampAutoInsert: boolean;
  /** `endOfNote` only fires while writing at the bottom of the note. */
  stampScope: 'endOfNote' | 'anywhere';
  /** Hours after which a stamp is considered stale. */
  stampThresholdHours: number;
  /** Also stamp when the day segment (morning/noon/evening) changed. */
  stampOnSegmentChange: boolean;
  /** Placeholders: {date} {time} {weekday} {weekday-long} {part} {iso}. */
  stampTemplate: string;
  stampDateFormat: string;
  stampTimeFormat: string;
  /** `HH:label,HH:label`, e.g. `05:早上,11:中午,13:下午,18:晚上,23:凌晨`. */
  stampSegments: string;
  /** Leave a blank line between the stamp and the text below it. */
  stampBlankLineAfter: boolean;

  // -------------------------------------------------------------- timeline
  tlStrictness: Strictness;
  tlIncludeTimeOnly: boolean;
  tlUseFilenameDate: boolean;
  tlBreakAtHeadings: boolean;
  tlAllowPartialDates: boolean;
  /** Comma separated opt-out markers, e.g. `*` for `*2026年12月31日`. */
  tlIgnoreMarkers: string;
  tlExcludeFolders: string;
  tlSort: 'desc' | 'asc';
  tlGroupBy: 'day' | 'file' | 'none';
  tlPageSize: number;
  tlRenderMarkdown: boolean;
  tlHideEmpty: boolean;
  /** Lines kept when a block is folded. 0 disables folding entirely. */
  tlCollapsedLines: number;
  /** Start the timeline with every block folded. */
  tlCollapseAll: boolean;
  /** Show only `- [ ]` tasks, hiding `- [x]` ones. */
  tlOnlyTasks: boolean;
}

export const DEFAULT_SETTINGS: TimelineSettings = {
  language: 'auto',

  stampAutoInsert: true,
  stampScope: 'endOfNote',
  stampThresholdHours: 8,
  stampOnSegmentChange: true,
  stampTemplate: DEFAULT_STAMP_TEMPLATE,
  stampDateFormat: 'YYYY-MM-DD',
  stampTimeFormat: 'HH:mm',
  stampSegments: DEFAULT_SEGMENTS_ZH,
  stampBlankLineAfter: true,

  tlStrictness: 'normal',
  tlIncludeTimeOnly: false,
  tlUseFilenameDate: true,
  tlBreakAtHeadings: true,
  tlAllowPartialDates: true,
  tlIgnoreMarkers: '*',
  tlExcludeFolders: '',
  tlSort: 'desc',
  tlGroupBy: 'day',
  tlPageSize: 60,
  tlRenderMarkdown: true,
  tlHideEmpty: true,
  tlCollapsedLines: 2,
  tlCollapseAll: false,
  tlOnlyTasks: false,
};

export class TimelineSettingTab extends PluginSettingTab {
  plugin: TimelinePlugin;

  constructor(app: App, plugin: TimelinePlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.addClass('ai-ns-settings');

    // ---------- Language ----------
    new Setting(containerEl).setName(t('set.lang')).setHeading();

    new Setting(containerEl)
      .setName(t('set.uiLang.name'))
      .setDesc(t('set.uiLang.desc'))
      .addDropdown((dd) =>
        dd
          .addOption('auto', t('set.uiLang.auto'))
          .addOption('zh', '中文')
          .addOption('en', 'English')
          .setValue(this.plugin.settings.language)
          .onChange(async (value) => {
            this.plugin.settings.language = value as LangMode;
            setLang(this.plugin.settings.language);
            await this.plugin.saveSettings();
            this.plugin.refreshUI();
            this.display();
          }),
      );

    this.renderTimestampSection(containerEl);
    this.renderTimelineSection(containerEl);
  }

  // --------------------------------------------------------------- timestamps

  private previewEl: HTMLElement | null = null;

  private renderTimestampSection(containerEl: HTMLElement): void {
    const s = this.plugin.settings;

    new Setting(containerEl).setName(t('set.stamp')).setHeading();

    new Setting(containerEl)
      .setName(t('set.stampAuto.name'))
      .setDesc(t('set.stampAuto.desc'))
      .addToggle((toggle) =>
        toggle.setValue(s.stampAutoInsert).onChange(async (value) => {
          s.stampAutoInsert = value;
          await this.plugin.saveSettings();
        }),
      );

    new Setting(containerEl)
      .setName(t('set.stampScope.name'))
      .setDesc(t('set.stampScope.desc'))
      .addDropdown((dd) =>
        dd
          .addOption('endOfNote', t('set.stampScope.end'))
          .addOption('anywhere', t('set.stampScope.anywhere'))
          .setValue(s.stampScope)
          .onChange(async (value) => {
            s.stampScope = value as 'endOfNote' | 'anywhere';
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName(t('set.stampThreshold.name'))
      .setDesc(t('set.stampThreshold.desc'))
      .addText((text) =>
        text.setValue(String(s.stampThresholdHours)).onChange(async (value) => {
          const n = Number.parseFloat(value);
          if (Number.isFinite(n) && n > 0) {
            s.stampThresholdHours = n;
            await this.plugin.saveSettings();
            this.updateStampPreview();
          }
        }),
      );

    new Setting(containerEl)
      .setName(t('set.stampSegment.name'))
      .setDesc(t('set.stampSegment.desc'))
      .addToggle((toggle) =>
        toggle.setValue(s.stampOnSegmentChange).onChange(async (value) => {
          s.stampOnSegmentChange = value;
          await this.plugin.saveSettings();
        }),
      );

    const preview = new Setting(containerEl)
      .setName(t('set.stampPreview.name'))
      .setDesc(t('set.stampPreview.desc'));
    preview.settingEl.addClass('ai-ns-stamp-preview');
    this.previewEl = preview.descEl.createEl('div', { cls: 'ai-ns-stamp-preview-box' });

    new Setting(containerEl)
      .setName(t('set.stampTemplate.name'))
      .setDesc(t('set.stampTemplate.desc'))
      .addText((text) => {
        text
          .setPlaceholder(DEFAULT_STAMP_TEMPLATE)
          .setValue(s.stampTemplate)
          .onChange(async (value) => {
            s.stampTemplate = value;
            await this.plugin.saveSettings();
            this.updateStampPreview();
          });
        text.inputEl.addClass('ai-ns-mono-input');
        text.inputEl.style.width = '100%';
      });

    new Setting(containerEl)
      .setName(t('set.stampDateFmt.name'))
      .setDesc(t('set.stampDateFmt.desc'))
      .addText((text) => {
        text
          .setPlaceholder('YYYY-MM-DD')
          .setValue(s.stampDateFormat)
          .onChange(async (value) => {
            s.stampDateFormat = value;
            await this.plugin.saveSettings();
            this.updateStampPreview();
          });
        text.inputEl.addClass('ai-ns-mono-input');
      });

    new Setting(containerEl)
      .setName(t('set.stampTimeFmt.name'))
      .setDesc(t('set.stampTimeFmt.desc'))
      .addText((text) => {
        text
          .setPlaceholder('HH:mm')
          .setValue(s.stampTimeFormat)
          .onChange(async (value) => {
            s.stampTimeFormat = value;
            await this.plugin.saveSettings();
            this.updateStampPreview();
          });
        text.inputEl.addClass('ai-ns-mono-input');
      });

    new Setting(containerEl)
      .setName(t('set.stampSegments.name'))
      .setDesc(t('set.stampSegments.desc'))
      .addText((text) => {
        text
          .setPlaceholder(DEFAULT_SEGMENTS_ZH)
          .setValue(s.stampSegments)
          .onChange(async (value) => {
            s.stampSegments = value;
            await this.plugin.saveSettings();
            this.updateStampPreview();
          });
        text.inputEl.addClass('ai-ns-mono-input');
        text.inputEl.style.width = '100%';
      });

    new Setting(containerEl)
      .setName(t('set.stampBlank.name'))
      .setDesc(t('set.stampBlank.desc'))
      .addToggle((toggle) =>
        toggle.setValue(s.stampBlankLineAfter).onChange(async (value) => {
          s.stampBlankLineAfter = value;
          await this.plugin.saveSettings();
        }),
      );

    this.previewEl.createEl('div', { cls: 'ai-ns-hint', text: dateFormatHelp() });
    this.updateStampPreview();
  }

  private updateStampPreview(): void {
    if (!this.previewEl) return;
    const s = this.plugin.settings;
    const cfg = {
      template: s.stampTemplate,
      dateFormat: s.stampDateFormat,
      timeFormat: s.stampTimeFormat,
      segments: s.stampSegments,
      lang: this.plugin.currentLang(),
    };
    const evening = new Date();
    evening.setHours(20, 41, 0, 0);
    const morning = new Date(evening);
    morning.setHours(8, 5, 0, 0);
    this.previewEl.setText([buildStamp(evening, cfg), buildStamp(morning, cfg)].join('\n'));
  }

  // ----------------------------------------------------------------- timeline

  private renderTimelineSection(containerEl: HTMLElement): void {
    const s = this.plugin.settings;

    new Setting(containerEl).setName(t('set.tlTitle')).setHeading();

    new Setting(containerEl)
      .setName(t('set.tlOpen.name'))
      .setDesc(t('set.tlOpen.desc'))
      .addButton((btn) =>
        btn
          .setButtonText(t('set.tlOpen.btn'))
          .setCta()
          .onClick(() => void this.plugin.activateTimeline()),
      );

    new Setting(containerEl)
      .setName(t('set.tlStrict.name'))
      .setDesc(t('set.tlStrict.desc'))
      .addDropdown((dd) =>
        dd
          .addOption('strict', t('set.tlStrict.strict'))
          .addOption('normal', t('set.tlStrict.normal'))
          .addOption('loose', t('set.tlStrict.loose'))
          .setValue(s.tlStrictness)
          .onChange(async (value) => {
            s.tlStrictness = value as Strictness;
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName(t('set.tlPartial.name'))
      .setDesc(t('set.tlPartial.desc'))
      .addToggle((toggle) =>
        toggle.setValue(s.tlAllowPartialDates).onChange(async (value) => {
          s.tlAllowPartialDates = value;
          await this.plugin.saveSettings();
        }),
      );

    new Setting(containerEl)
      .setName(t('set.tlTimeOnly.name'))
      .setDesc(t('set.tlTimeOnly.desc'))
      .addToggle((toggle) =>
        toggle.setValue(s.tlIncludeTimeOnly).onChange(async (value) => {
          s.tlIncludeTimeOnly = value;
          await this.plugin.saveSettings();
        }),
      );

    new Setting(containerEl)
      .setName(t('set.tlFilename.name'))
      .setDesc(t('set.tlFilename.desc'))
      .addToggle((toggle) =>
        toggle.setValue(s.tlUseFilenameDate).onChange(async (value) => {
          s.tlUseFilenameDate = value;
          await this.plugin.saveSettings();
        }),
      );

    new Setting(containerEl)
      .setName(t('set.tlHeadings.name'))
      .setDesc(t('set.tlHeadings.desc'))
      .addToggle((toggle) =>
        toggle.setValue(s.tlBreakAtHeadings).onChange(async (value) => {
          s.tlBreakAtHeadings = value;
          await this.plugin.saveSettings();
        }),
      );

    new Setting(containerEl)
      .setName(t('set.tlEmpty.name'))
      .setDesc(t('set.tlEmpty.desc'))
      .addToggle((toggle) =>
        toggle.setValue(s.tlHideEmpty).onChange(async (value) => {
          s.tlHideEmpty = value;
          await this.plugin.saveSettings();
        }),
      );

    new Setting(containerEl)
      .setName(t('set.tlOnlyTasks.name'))
      .setDesc(t('set.tlOnlyTasks.desc'))
      .addToggle((toggle) =>
        toggle.setValue(s.tlOnlyTasks).onChange(async (value) => {
          s.tlOnlyTasks = value;
          await this.plugin.saveSettings();
          this.plugin.applyOnlyTasksSetting();
        }),
      );

    new Setting(containerEl)
      .setName(t('set.tlIgnore.name'))
      .setDesc(t('set.tlIgnore.desc'))
      .addText((text) => {
        text
          .setPlaceholder('*')
          .setValue(s.tlIgnoreMarkers)
          .onChange(async (value) => {
            s.tlIgnoreMarkers = value;
            await this.plugin.saveSettings();
          });
        text.inputEl.addClass('ai-ns-mono-input');
      });

    new Setting(containerEl)
      .setName(t('set.tlLines.name'))
      .setDesc(t('set.tlLines.desc'))
      .addText((text) =>
        text.setValue(String(s.tlCollapsedLines)).onChange(async (value) => {
          const n = Number.parseInt(value, 10);
          if (Number.isFinite(n) && n >= 0) {
            s.tlCollapsedLines = n;
            await this.plugin.saveSettings();
          }
        }),
      );

    new Setting(containerEl)
      .setName(t('set.tlCollapseAll.name'))
      .setDesc(t('set.tlCollapseAll.desc'))
      .addToggle((toggle) =>
        toggle.setValue(s.tlCollapseAll).onChange(async (value) => {
          s.tlCollapseAll = value;
          await this.plugin.saveSettings();
          this.plugin.applyCollapseSetting();
        }),
      );

    new Setting(containerEl)
      .setName(t('set.tlRender.name'))
      .setDesc(t('set.tlRender.desc'))
      .addToggle((toggle) =>
        toggle.setValue(s.tlRenderMarkdown).onChange(async (value) => {
          s.tlRenderMarkdown = value;
          await this.plugin.saveSettings();
          this.plugin.refreshTimeline();
        }),
      );

    new Setting(containerEl)
      .setName(t('set.tlPage.name'))
      .setDesc(t('set.tlPage.desc'))
      .addText((text) =>
        text.setValue(String(s.tlPageSize)).onChange(async (value) => {
          const n = Number.parseInt(value, 10);
          if (Number.isFinite(n) && n >= 10) {
            s.tlPageSize = n;
            await this.plugin.saveSettings();
          }
        }),
      );

    new Setting(containerEl)
      .setName(t('set.tlSort.name'))
      .setDesc(t('set.tlSort.desc'))
      .addDropdown((dd) =>
        dd
          .addOption('desc', t('set.tlSort.new'))
          .addOption('asc', t('set.tlSort.old'))
          .setValue(s.tlSort)
          .onChange(async (value) => {
            s.tlSort = value as 'desc' | 'asc';
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName(t('set.tlGroup.name'))
      .setDesc(t('set.tlGroup.desc'))
      .addDropdown((dd) =>
        dd
          .addOption('day', t('set.tlGroup.day'))
          .addOption('file', t('set.tlGroup.file'))
          .addOption('none', t('set.tlGroup.none'))
          .setValue(s.tlGroupBy)
          .onChange(async (value) => {
            s.tlGroupBy = value as 'day' | 'file' | 'none';
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName(t('set.tlExclude.name'))
      .setDesc(t('set.tlExclude.desc'))
      .addText((text) =>
        text
          .setPlaceholder('Templates, 归档')
          .setValue(s.tlExcludeFolders)
          .onChange(async (value) => {
            s.tlExcludeFolders = value;
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName(t('set.tlScan.name'))
      .setDesc(t('set.tlScan.desc'))
      .addButton((btn) =>
        btn.setButtonText(t('set.tlScan.btn')).onClick(async () => {
          btn.setDisabled(true).setButtonText('…');
          try {
            const result = await scanVault(this.app, this.plugin.scanSettings());
            new Notice(
              `${result.blocks.length} ${t('tl.count')} · ${result.stampedFileCount}/${result.fileCount} ${t('tl.files')} · ${result.durationMs}ms`,
              8000,
            );
          } catch (err) {
            new Notice(`${t('msg.error')}${(err as Error).message}`, 10000);
          } finally {
            btn.setDisabled(false).setButtonText(t('set.tlScan.btn'));
          }
        }),
      );
  }
}
