/**
 * Bilingual string table. Obsidian stores the UI language in localStorage
 * under the "language" key (e.g. "zh", "zh-TW", "en").
 */

export type LangMode = 'auto' | 'zh' | 'en';
export type Lang = 'zh' | 'en';

/** [zh-Hans, en] */
const STRINGS: Record<string, [string, string]> = {
  'ribbon.timeline': ['时间线', 'Timeline'],
  'panel.title': ['时间线', 'Timeline'],

  'set.lang': ['语言', 'Language'],
  'set.uiLang.name': ['界面语言', 'Interface language'],
  'set.uiLang.desc': ['默认跟随 Obsidian 界面语言。', 'Defaults to the Obsidian UI language.'],
  'set.uiLang.auto': ['跟随 Obsidian', 'Follow Obsidian'],

  // ------------------------------------------------------------- timestamps
  'set.stamp': ['时间戳（不依赖 AI）', 'Timestamps (no AI)'],
  'set.stampAuto.name': ['写文时自动补时间戳', 'Auto-stamp while writing'],
  'set.stampAuto.desc': [
    '停笔约 1.5 秒后检查：光标前最近的记录若超过设定时长，就自动补一个时间戳。只在你正在写的那一行上方插入，不会改动已有文字。',
    'About 1.5s after you stop typing, checks the text before the cursor. If the newest record is older than the window, a stamp is inserted above the line you are writing on.',
  ],
  'set.stampScope.name': ['触发范围', 'Trigger scope'],
  'set.stampScope.end': ['只在笔记末尾（安全）', 'Only at the end of the note (safe)'],
  'set.stampScope.anywhere': ['任意位置', 'Anywhere'],
  'set.stampScope.desc': [
    '「只在末尾」：光标在最后一行时才补，回头改旧文不会被打扰。',
    '"End of note": only fires on the last line, so editing older text is never interrupted.',
  ],
  'set.stampThreshold.name': ['多久算「陈旧」（小时）', 'Stale after (hours)'],
  'set.stampThreshold.desc': ['超过这个时长且没有新记录，就补一个时间戳。默认 8 小时。', 'Insert a stamp when the newest record is older than this. Default 8h.'],
  'set.stampSegment.name': ['时段变化时也补一条', 'Also stamp on segment change'],
  'set.stampSegment.desc': [
    '比如早上刚记过，晚上再写时即使不到 8 小时也补一条。',
    'e.g. after a morning entry, an evening entry gets its own stamp even within 8h.',
  ],
  'set.stampPreview.name': ['预览', 'Preview'],
  'set.stampPreview.desc': ['按当前设置生成的样子（晚上 / 早上各一条）。', 'How a stamp looks with the current settings (evening and morning).'],
  'set.stampTemplate.name': ['时间戳模板', 'Stamp template'],
  'set.stampTemplate.desc': [
    '含 {date} {weekday} {part} {time} 等占位符。保留 {time} 会写出具体时刻；留空则只按「日期 + 时段」判断是否该补一条（同一天同一时段只打一条）。',
    'Uses {date} {weekday} {part} {time}. Keep {time} to record the clock; leave it empty and freshness is judged by day + segment (one stamp per segment).',
  ],
  'set.stampDateFmt.name': ['日期格式', 'Date format'],
  'set.stampDateFmt.desc': ['如 YYYY-MM-DD、YYYY/M/D、YYYY年M月D日。', 'e.g. YYYY-MM-DD, YYYY/M/D, YYYY年M月D日.'],
  'set.stampTimeFmt.name': ['时间格式', 'Time format'],
  'set.stampTimeFmt.desc': ['如 HH:mm、HH:mm:ss。', 'e.g. HH:mm, HH:mm:ss.'],
  'set.stampSegments.name': ['时段划分', 'Day segments'],
  'set.stampSegments.desc': [
    '格式「起始小时:名称」，逗号分隔，自动跨夜。默认 05:早上,11:中午,13:下午,18:晚上,23:凌晨。',
    'Format "startHour:label", comma separated, wraps past midnight. Default 05:早上,11:中午,13:下午,18:晚上,23:凌晨.',
  ],
  'set.stampBlank.name': ['时间戳后空一行', 'Blank line under the stamp'],
  'set.stampBlank.desc': ['更利于 Markdown 渲染，也更好读。', 'Renders better and reads better.'],

  'cmd.insertStamp': ['时间戳：在光标处补一条（智能）', 'Timestamp: insert if stale (smart)'],
  'cmd.forceStamp': ['时间戳：强制插入一条', 'Timestamp: force insert'],
  'cmd.openTimeline': ['时间线：按时间汇总全库笔记', 'Timeline: gather notes by time'],
  'menu.stamp': ['插入时间戳', 'Insert timestamp'],
  'msg.stampInserted': ['已插入时间戳', 'Timestamp inserted'],
  'msg.stampFresh': ['前文已有近期时间戳，未重复插入。', 'A recent timestamp already exists; skipped.'],
  'msg.stampNoEditor': ['请先打开一篇笔记。', 'Open a note first.'],

  // --------------------------------------------------------------- timeline
  'set.tl': ['时间线（不依赖 AI）', 'Timeline (no AI)'],
  'set.tlOpen.name': ['打开时间线', 'Open the timeline'],
  'set.tlOpen.desc': [
    '在新标签页里把所有笔记按时间排出来。平时不用来这里：左边功能区有日历图标。',
    'Opens a tab listing every note block in time order. You rarely need this entry — the ribbon has a calendar icon.',
  ],
  'set.tlOpen.btn': ['打开时间线', 'Open timeline'],
  'set.tlStrict.name': ['匹配严格度', 'Match strictness'],
  'set.tlStrict.strict': ['严格：只认行首/标题里的日期', 'Strict: line-start or heading dates only'],
  'set.tlStrict.normal': ['标准：兼顾「会议日期：」这类写法', 'Normal: also matches "date: ..." style'],
  'set.tlStrict.loose': ['宽松：正文里提到日期也算', 'Loose: dates mentioned in prose too'],
  'set.tlStrict.desc': ['太宽松会把「6月30日上线」这类句子也当时间点。', 'Too loose pulls in sentences like "go live on 6/30".'],
  'set.tlPartial.name': ['识别无年份日期', 'Accept year-less dates'],
  'set.tlPartial.desc': ['如「6月2日」「6/2」，年份按上下文中最近一次完整日期推断。', 'e.g. 6月2日 / 6/2; the year is inferred from the nearest complete date.'],
  'set.tlTimeOnly.name': ['识别只有时刻的行', 'Recognise time-only lines'],
  'set.tlTimeOnly.desc': [
    '例如会议转写工具的「元宝会议助手17:14」。日期取同上文最近日期。',
    'e.g. transcript watermarks like "元宝会议助手17:14"; the date comes from the nearest date above.',
  ],
  'set.tlFilename.name': ['用文件名日期兜底', 'Fall back to the file name date'],
  'set.tlFilename.desc': ['正文里一个时间戳都没有时，用文件名里的日期（如 20260903.md）作为整篇的时间。', 'When the body has no stamp at all, use a date in the file name (e.g. 20260903.md).'],
  'set.tlHeadings.name': ['内容块遇标题断开', 'Break blocks at headings'],
  'set.tlHeadings.desc': ['否则一个时间点会一直吞到下一个时间点，可能把后面的章节也包含进来。', 'Otherwise a block swallows everything up to the next stamp, including later sections.'],
  'set.tlEmpty.name': ['隐藏没有正文的时间点', 'Hide stamps with no body'],
  'set.tlEmpty.desc': ['有些时间戳下面还没写东西，默认不显示。', 'Some stamps have nothing under them yet; hidden by default.'],
  'set.tlRender.name': ['渲染 Markdown', 'Render markdown'],
  'set.tlRender.desc': ['关闭后按纯文本显示，滚动更流畅。', 'Turn off for plain text — smoother scrolling.'],
  'set.tlPage.name': ['每批加载条数', 'Blocks per batch'],
  'set.tlPage.desc': ['列表分批渲染，避免笔记太多时卡顿。', 'The list renders in batches so a big vault stays responsive.'],
  'set.tlSort.name': ['默认排序', 'Default sort'],
  'set.tlSort.desc': ['', ''],
  'set.tlSort.new': ['新 → 旧', 'Newest first'],
  'set.tlSort.old': ['旧 → 新', 'Oldest first'],
  'set.tlGroup.name': ['默认分组', 'Default grouping'],
  'set.tlGroup.desc': ['', ''],
  'set.tlGroup.day': ['按日期', 'By day'],
  'set.tlGroup.file': ['按笔记', 'By note'],
  'set.tlGroup.none': ['平铺', 'Flat'],
  'set.tlExclude.name': ['排除文件夹', 'Excluded folders'],
  'set.tlExclude.desc': ['逗号分隔的文件夹路径，扫描时跳过。', 'Comma separated folder paths to skip.'],
  'set.tlIgnore.name': ['忽略标记', 'Opt-out markers'],
  'set.tlIgnore.desc': [
    '时间戳前**紧邻**该标记时整行跳过，用来排除模板里的占位日期。默认 * ：一行 `*2026年12月31日` 不进时间线；而 `**加粗** 2026-12-31` 和列表项 `* 2026-12-31`（星号后有空格）照常识别。多个用逗号分隔。',
    'A timestamp written with this marker glued to its left is skipped, handy for template placeholders. Default * : `*2026-12-31` is ignored, while `**bold** 2026-12-31` and the bullet `* 2026-12-31` (space after the star) still count. Comma separate several.',
  ],
  'set.tlLines.name': ['折叠时保留行数', 'Lines kept when folded'],
  'set.tlLines.desc': ['折叠后的块只显示前 N 行纯文本。设 0 关闭折叠功能。', 'A folded block shows its first N lines as plain text. 0 turns folding off.'],
  'set.tlCollapseAll.name': ['默认全折叠', 'Start fully folded'],
  'set.tlCollapseAll.desc': ['打开时间线时所有块都先折叠成两三行，需要时再逐个展开。', 'Every block starts folded to a few lines; expand the ones you need.'],
  'set.tlOnlyTasks.name': ['只看未完成任务', 'Only unfinished tasks'],
  'set.tlOnlyTasks.desc': [
    '打开时间线时只列出未打钩的 `- [ ]` 任务，已完成的 `- [x]` 自动隐藏。想按时间维度清点待办时用它。',
    'Lists only unchecked `- [ ]` tasks, hiding completed `- [x]` ones. Handy for reviewing what is still open, in time order.',
  ],
  'set.tlScan.name': ['扫描预览', 'Scan preview'],
  'set.tlScan.desc': ['先跑一遍看看命中数量，再决定要不要调严格度。', 'Run once to see how many blocks a setting yields.'],
  'set.tlScan.btn': ['扫描并统计', 'Scan & count'],

  'tl.title': ['时间线', 'Timeline'],
  'tl.search': ['搜索内容或笔记名…', 'Search content or note name…'],
  'tl.refresh': ['重新扫描', 'Rescan'],
  'tl.export': ['导出为笔记', 'Export as note'],
  'tl.copyAll': ['复制全部', 'Copy all'],
  'tl.scanning': ['正在扫描全库…', 'Scanning the vault…'],
  'tl.empty': ['没有找到任何时间块。试试放宽「匹配严格度」，或检查排除文件夹。', 'No blocks found. Try a looser strictness or check the excluded folders.'],
  'tl.emptyTasks': ['没有找到未完成的任务。', 'No unfinished tasks found.'],
  'tl.count': ['个时间块', 'blocks'],
  'tl.files': ['篇笔记', 'notes'],
  'tl.open': ['打开', 'Open'],
  'tl.copy': ['复制', 'Copy'],
  'tl.copied': ['已复制到剪贴板', 'Copied to clipboard'],
  'tl.collapse': ['折叠', 'Collapse'],
  'tl.expand': ['展开', 'Expand'],
  'tl.more': ['加载更多', 'Load more'],
  'tl.remaining': ['剩余', 'remaining'],
  'tl.foldAll': ['全折叠', 'Fold all'],
  'tl.unfoldAll': ['全展开', 'Unfold all'],
  'tl.onlyTasks': ['只看未完成', 'Only unfinished'],
  'tl.allTasks': ['显示全部', 'Show all'],
  'tl.onlyTasksOn': ['只看未完成任务：开', 'Only unfinished tasks: on'],
  'tl.onlyTasksOff': ['只看未完成任务：关', 'Only unfinished tasks: off'],
  'tl.taskTodo': ['未完成', 'open'],
  'tl.taskDone': ['已完成', 'done'],
  'tl.fold': ['折叠这一段', 'Fold this block'],
  'tl.unfold': ['展开这一段', 'Unfold this block'],
  'tl.foldDay': ['收起这一天（每块只留一行）', 'Collapse this day to one line per block'],
  'tl.unfoldDay': ['展开这一天', 'Expand this day'],
  'tl.foldedTag': ['已收起', 'collapsed'],
  'tl.linesOmitted': ['行未显示', 'lines hidden'],
  'tl.linesTotal': ['行', 'lines'],
  'tl.fromFilename': ['由文件名推断', 'from file name'],
  'tl.hiddenEmpty': ['已隐藏', 'hidden'],
  'tl.hiddenEmptySuffix': ['个无正文的时间点（可在设置里显示）', 'empty stamps (show them in settings)'],
  'tl.exported': ['已导出：', 'Exported: '],
  'tl.scope': ['范围', 'Scope'],
  'tl.scope.all': ['全库', 'Whole vault'],
  'tl.scope.file': ['当前笔记', 'Current note'],
  'tl.scope.folder': ['当前文件夹', 'Current folder'],
  'tl.rootFolder': ['库根目录', 'vault root'],
  'tl.noFile': ['未打开笔记', 'No note open'],
  'tl.sortLabel': ['排序', 'Sort'],
  'tl.groupLabel': ['分组', 'Group'],
  'tl.showMoreDetail': ['共', 'of'],
  'tl.exportTitle': ['时间线汇总', 'Timeline digest'],

  'msg.error': ['请求失败：', 'Request failed: '],
  'set.tlTitle': ['时间线', 'Timeline'],
};

let current: Lang = 'en';

export function detectLang(): Lang {
  const raw = (window.localStorage.getItem('language') || navigator.language || 'en').toLowerCase();
  return raw.startsWith('zh') ? 'zh' : 'en';
}

export function setLang(mode: LangMode): void {
  current = mode === 'auto' ? detectLang() : mode;
}

export function getLang(): Lang {
  return current;
}

export function t(key: string): string {
  const entry = STRINGS[key];
  if (!entry) return key;
  return current === 'zh' ? entry[0] : entry[1];
}
