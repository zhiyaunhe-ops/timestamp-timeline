/**
 * Timestamp Timeline tests: stamp formatting, marker detection, the stale
 * verdict, vault scanning, block extraction and filtering.
 *
 *   node tests/run.mjs tests/smoke.ts
 */

import {
  DEFAULT_STAMP_TEMPLATE,
  DEFAULT_SEGMENTS_ZH,
  analyzeLine,
  buildStamp,
  formatDate,
  hasIgnoreMarker,
  parseDaySegments,
  segmentFor,
  segmentLabel,
  verdictForText,
} from '../src/timestamp';
import {
  DEFAULT_SCAN_SETTINGS,
  blockDigest,
  blocksToMarkdown,
  confidenceThreshold,
  dayKey,
  extractBlocks,
  filenameDate,
  filterBlocks,
  groupByDay,
  hasOpenTask,
  inFolder,
  plainLine,
  sortBlocks,
  taskState,
  type TimelineBlock,
} from '../src/scan';
import { check, eq, finish } from './assert';

/** Handy factory for the filtering tests — mirrors what `extractBlocks` emits. */
function mkBlock(path: string, y: number, m: number, d: number, content: string, empty = false): TimelineBlock {
  const parts = path.split('/');
  return {
    filePath: path,
    fileBasename: parts[parts.length - 1].replace(/\.md$/, ''),
    folder: parts.slice(0, -1).join('/'),
    stamp: {
      line: 0,
      date: new Date(y, m - 1, d, 9, 0, 0),
      hasTime: true,
      raw: `${y}${String(m).padStart(2, '0')}${String(d).padStart(2, '0')}`,
      label: '',
      confidence: 5,
      timeOnly: false,
      kind: 'compact',
    },
    startLine: 1,
    endLine: 2,
    content: empty ? '' : content,
    heading: '',
    fromFilename: false,
  };
}

// ------------------------------------------------------------- timestamp utils

console.log('\n[1] Timestamp formatting');
const monday = new Date(2026, 8, 14, 22, 1, 0);
eq('YYYY-MM-DD HH:mm', formatDate(monday, 'YYYY-MM-DD HH:mm', 'zh'), '2026-09-14 22:01');
eq('weekday zh short', formatDate(monday, 'ddd', 'zh'), '周一');
eq('weekday zh long', formatDate(monday, 'ddd', 'zh').length, 2);
eq('weekday en short', formatDate(monday, 'ddd', 'en'), 'Mon');
eq('single-digit not padded', formatDate(monday, 'M/D', 'zh'), '9/14');
eq('Chinese date pattern', formatDate(monday, 'YYYY年M月D日', 'zh'), '2026年9月14日');
eq('12h clock + meridiem', formatDate(monday, 'h:mm A', 'en'), '10:01 PM');
eq('unknown tokens pass through', formatDate(monday, 'YYYY QQ', 'zh'), '2026 QQ');
eq('compacted filename stamp', formatDate(monday, 'YYYY-MM-DD HHmm', 'zh'), '2026-09-14 2201');

const segments = parseDaySegments('05:早上,11:中午,13:下午,18:晚上,23:凌晨');
eq('segments parsed', segments.length, 5);
eq('segment morning', segmentFor(8, segments).label, '早上');
eq('segment evening', segmentFor(20, segments).label, '晚上');
eq('segment wraps past midnight', segmentFor(2, segments).label, '凌晨');
eq('segment boundary inclusive', segmentFor(5, segments).label, '早上');
eq('bad spec falls back', parseDaySegments('nonsense').length, 1);
eq('segment label translated', segmentLabel('早上', 'en'), 'morning');

const stampCfg = {
  template: DEFAULT_STAMP_TEMPLATE,
  dateFormat: 'YYYY-MM-DD',
  timeFormat: 'HH:mm',
  segments: DEFAULT_SEGMENTS_ZH,
  lang: 'zh' as const,
};
eq('default stamp', buildStamp(monday, stampCfg), '### 2026-09-14 周一 · 晚上 22:01');
eq(
  'custom stamp template',
  buildStamp(monday, { ...stampCfg, template: '{date} {part}' }),
  '2026-09-14 晚上',
);
eq(
  'stamp in english',
  buildStamp(monday, { ...stampCfg, lang: 'en' }),
  '### 2026-09-14 Mon · evening 22:01',
);

// ------------------------------------------------------------ line confidence

console.log('\n[2] Marker detection (real vault samples)');
const markerLines: Array<[string, boolean]> = [
  ['20260728', true],
  ['20260728 会议结果', true],
  ['20260710/12', true],
  ['20260720-22', true],
  ['### 2026年6月2日', true],
  ['### 2026年6月8日周总结', true],
  ['- **会议时间**：2026年7月31日', true],
  ['**报告周期**：2026年6月2日 - 6月8日（第23周）', true],
  ['**最后更新**: 2026年6月8日', true],
  ['  5. 关键目标：6月30日前能看到财务报表', false],
  ['  - 不希望6月30日草草"上线"总账报表', false],
  ['- **上线目标**：6月30日（紧急）', false],
  ['**关键节点**：2026年6月30日（切换并能看到财务报表）', false],
  ['### 本周（6月2日 - 6月8日）', false],
];
for (const [line, expected] of markerLines) {
  const found = analyzeLine(line, 0, {});
  const hit = !!found && found.confidence >= 3;
  check(`marker ${hit === expected ? '✓' : '✗'} ${JSON.stringify(line)}`, hit === expected,
    found ? `confidence ${found.confidence}` : 'null');
}

const rangeToken = analyzeLine('20260710/12', 0, {})!.token;
eq('range keeps the first day', `${rangeToken.year}-${rangeToken.month}-${rangeToken.day}`, '2026-7-10');
eq('range keeps the end day', rangeToken.endDay, 12);

const labelled = analyzeLine('20260728 会议结果', 0, {})!;
eq('trailing label captured', labelled.label, '会议结果');
check('compact + label is at line start', labelled.atLineStart);

const timed = analyzeLine('2026-06-04 12:40:54 会议', 0, {})!;
eq('iso + time hour', timed.token.hour, 12);
eq('iso + time minute', timed.token.minute, 40);

const headingLine = analyzeLine('### 2026年6月2日', 0, {})!;
check('heading marker detected', headingLine.inHeading);
eq('heading marker year', headingLine.token.year, 2026);
eq('heading marker day', headingLine.token.day, 2);

const merged = analyzeLine('### 2026-09-14 周一 · 晚上 22:01', 0, {})!;
check('time merged into a date-only marker', merged.token.hasTime && merged.token.hour === 22);

const watermark = analyzeLine('元宝会议助手17:14', 0, { allowTimeOnly: true })!;
check('transcript watermark recognised', !!watermark && watermark.timeOnly && watermark.confidence >= 3);
eq('watermark hour', watermark.token.hour, 17);

// ------------------------------------------------------------------- 8h rule

console.log('\n[3] Stale-timestamp verdict');
const fresh = new Date(2026, 8, 14, 9, 0, 0);
const within8h = new Date(2026, 8, 14, 13, 0, 0);
const stale = new Date(2026, 8, 14, 20, 0, 0);

const mk = (now: Date, extra: Partial<{ thresholdHours: number; stampOnSegmentChange: boolean }> = {}) => ({
  ...stampCfg,
  thresholdHours: extra.thresholdHours ?? 8,
  stampOnSegmentChange: extra.stampOnSegmentChange ?? false,
});

const s1 = new Date(2026, 8, 14, 9, 0, 0);
const verdictFresh = verdictForText('20260914 09:00 记录\n- 写了一点东西\n', within8h, mk(within8h));
check('recent stamp is respected', verdictFresh.skip, JSON.stringify(verdictFresh));
eq('fresh reason', verdictFresh.reason, 'fresh');

const verdictStale = verdictForText('20260914 09:00 记录\n- 写了一点东西\n', stale, mk(stale));
check('stale stamp triggers a new one', !verdictStale.skip);
eq('stale reason', verdictStale.reason, 'stale');
eq('stale age in hours', Math.round(verdictStale.ageHours ?? 0), 11);

const verdictNone = verdictForText('# 标题\n\n正文\n', stale, mk(stale));
eq('no stamp at all', verdictNone.reason, 'no-stamp');

const segmentText = '20260914 08:00 早上\n- 记了一笔\n';
const verdictSegment = verdictForText(segmentText, stale, mk(stale, { thresholdHours: 24, stampOnSegmentChange: true }));
eq('segment change wins over the 8h window', verdictSegment.reason, 'segment-changed');

const sameMorning = new Date(2026, 8, 14, 10, 0, 0);
const verdictSameSegment = verdictForText(segmentText, sameMorning, mk(sameMorning, { stampOnSegmentChange: true }));
eq('same segment inside the window stays quiet', verdictSameSegment.reason, 'fresh');

const chineseStamp = verdictForText('### 2026年9月14日\n昨天写的东西\n', stale, mk(stale));
eq('a same-day date heading counts as a record', chineseStamp.reason, 'fresh');
check('a same-day date heading is not ignored', chineseStamp.last !== undefined);

eq(
  'a date heading from another day is stale',
  verdictForText('### 2026年9月13日\n前天写的东西\n', stale, mk(stale)).reason,
  'stale',
);

// A template with `{time}` left empty (empty time format) — the reported
// double-stamp case: "2026-09-15 周二 · 早上" twice, one minute apart.
console.log('\n[3b] Time-less stamps (empty time format)');
const noClock = { ...stampCfg, timeFormat: '', segments: '06:早上,12:中午,18:晚上' };
eq('time-less stamp text', buildStamp(new Date(2026, 8, 15, 9, 47), noClock), '### 2026-09-15 周二 · 早上');

const morning = new Date(2026, 8, 15, 9, 47, 0);
const mkv = (now: Date, extra: Partial<{ thresholdHours: number }> = {}) => ({
  ...noClock,
  thresholdHours: extra.thresholdHours ?? 8,
  stampOnSegmentChange: true,
  minConfidence: 3,
  allowTimeOnly: false,
});

const timelessAbove = verdictForText('### 2026-09-15 周二 · 早上\n\n', morning, mkv(morning));
check('time-less stamp from today is fresh', timelessAbove.skip, JSON.stringify(timelessAbove));
eq('time-less reason', timelessAbove.reason, 'fresh');
check('time-less age is not read as midnight', (timelessAbove.ageHours ?? 99) < 8);

const timelessTwo = verdictForText(
  '### 2026-09-15 周二 · 早上\n\n### 2026-09-15 周二 · 早上\n\n',
  morning,
  mkv(morning),
);
check('two identical time-less stamps still stay quiet', timelessTwo.skip);

const timelessNoon = new Date(2026, 8, 15, 13, 20, 0);
eq(
  'time-less stamp rolls over with its segment',
  verdictForText('### 2026-09-15 周二 · 早上\n\n', timelessNoon, mkv(timelessNoon)).reason,
  'segment-changed',
);

const timelessYesterday = new Date(2026, 8, 16, 9, 47, 0);
eq(
  'time-less stamp from another day is stale',
  verdictForText('### 2026-09-15 周二 · 早上\n\n', timelessYesterday, mkv(timelessYesterday)).reason,
  'stale',
);

const unlabelled = { ...noClock, template: '### {date}' };
const unlabelledSameDay = verdictForText('### 2026-09-15\n\n', morning, {
  ...unlabelled,
  thresholdHours: 8,
  stampOnSegmentChange: true,
});
check('unlabelled time-less stamp is judged on age only', unlabelledSameDay.skip);
eq(
  'unlabelled time-less stamp the next day',
  verdictForText('### 2026-09-15\n\n', timelessYesterday, {
    ...unlabelled,
    thresholdHours: 8,
    stampOnSegmentChange: true,
  }).reason,
  'stale',
);

void s1;
void fresh;

// -------------------------------------------------------------- block slicing

console.log('\n[4] Content-block extraction');
const sample = [
  '---',
  'tags: [erp]',
  '---',
  '# 项目进展',
  '',
  '## 每日进展记录',
  '',
  '### 2026年6月2日',
  '- **今日进展**:',
  '  1. 了解基本项目范围',
  '- **备注**: 图片无法读取',
  '',
  '### 2026年6月3日',
  '- **会议要点**: 货运公司急需6月30日上线',
  '',
  '## 每周总结',
  '',
  '20260626',
  '1. 有三个货运用户被港航录入了',
  '2. 把金鹿和新翔的部门、人、权限进生产环境搞定',
  '',
  '20260731',
  '1. ',
  '',
  '### 待安排会议',
  '- **日期**: 2026年6月10日',
  '',
].join('\n');

const blocks = extractBlocks({ path: '海航项目/-海航项目进展跟踪.md', basename: '-海航项目进展跟踪', content: sample }, DEFAULT_SCAN_SETTINGS);
const cnRaws = blocks.filter((b) => b.stamp.kind === 'cn').map((b) => b.stamp.raw);
check('Chinese day headings found', cnRaws.includes('2026年6月2日') && cnRaws.includes('2026年6月3日'), cnRaws.join(' | '));

const day2 = blocks.find((b) => b.stamp.raw === '2026年6月2日')!;
eq('first day block', dayKey(day2.stamp.date), '2026-06-02');
check('day block body starts right after the heading', day2.content.startsWith('- **今日进展**:'));
eq('day block heading context', day2.heading, '每日进展记录');

const compactBlocks = blocks.filter((b) => b.stamp.raw === '20260626' || b.stamp.raw === '20260731');
eq('compact markers found', compactBlocks.length, 2);
check('compact block body kept', compactBlocks[0].content.includes('港航'));
check(
  'block stops at the next heading',
  !compactBlocks[1].content.includes('待安排会议'),
  JSON.stringify(compactBlocks[1].content),
);
check(
  'marker line index is 1-based-correct to the source',
  sample.split('\n')[compactBlocks[0].stamp.line] === '20260626',
);
check('frontmatter is skipped', !blocks.some((b) => b.stamp.line <= 2));
eq('blocks carry their folder', compactBlocks[0].folder, '海航项目');

const unsorted = [...blocks];
eq('sortBlocks ascending', sortBlocks(unsorted, 'asc')[0].stamp.date.getTime() <= sortBlocks(unsorted, 'asc')[1].stamp.date.getTime(), true);
eq('sortBlocks descending', sortBlocks(unsorted, 'desc')[0].stamp.date.getTime() >= sortBlocks(unsorted, 'desc')[1].stamp.date.getTime(), true);
eq('day groups are ordered desc', groupByDay(unsorted, 'desc')[0].key, '2026-07-31');

const md = blocksToMarkdown(blocks, {
  title: 'Timeline',
  order: 'asc',
  timeFormat: 'HH:mm',
  lang: 'zh',
  includeSource: true,
  maxChars: 0,
});
check('markdown has a day heading', md.includes('## 2026-06-02'));
check('markdown names the source note', md.includes('[[-海航项目进展跟踪]]'));
check('markdown keeps the body', md.includes('了解基本项目范围'));

console.log('\n[5] File-name fallback');
eq('compact file name', dayKey(filenameDate('20260903')!), '2026-09-03');
eq('file name with a title', dayKey(filenameDate('20260731 - 0803 大家乐采购流程图')!), '2026-07-31');
eq('iso file name', dayKey(filenameDate('2026-09-14 会议记录')!), '2026-09-14');
eq('Chinese file name', dayKey(filenameDate('2026年9月1日 白帝城托孤')!), '2026-09-01');
eq('week-coded name has no date', filenameDate('-海航周报_2026W23(0602-0608)'), null);
eq('plain name has no date', filenameDate('专线转发服务器'), null);
eq('impossible date rejected', filenameDate('20261332'), null);

const fileless = extractBlocks(
  { path: '联合项目/20260903.md', basename: '20260903', content: '1. 做一个 code+name 两列的表\n2. 先在测试环境做测试\n' },
  DEFAULT_SCAN_SETTINGS,
);
eq('date-less body falls back to the file name', fileless.length, 1);
check('fallback block is flagged', fileless[0].fromFilename);
eq('fallback date', dayKey(fileless[0].stamp.date), '2026-09-03');
eq('fallback is disabled by the setting', extractBlocks(
  { path: 'a/20260903.md', basename: '20260903', content: '1. 测试\n' },
  { ...DEFAULT_SCAN_SETTINGS, useFilenameDate: false },
).length, 0);

console.log('\n[6] Time-only + strictness');
const timeOnlyBody = '20260901 开发接口相关会议\n1. OA 推 AP 单据\n\n元宝会议助手14:42\n\n对齐了期初数据导入方案\n';
eq('time-only ignored by default', extractBlocks(
  { path: 'a/x.md', basename: 'x', content: timeOnlyBody },
  DEFAULT_SCAN_SETTINGS,
).filter((b) => b.stamp.timeOnly).length, 0);

const withTimeOnly = extractBlocks(
  { path: 'a/x.md', basename: 'x', content: timeOnlyBody },
  { ...DEFAULT_SCAN_SETTINGS, includeTimeOnly: true },
).filter((b) => b.stamp.timeOnly);
eq('time-only picked up when enabled', withTimeOnly.length, 1);
eq('time-only borrows the date above it', dayKey(withTimeOnly[0].stamp.date), '2026-09-01');
eq('time-only keeps its clock time', withTimeOnly[0].stamp.date.getHours(), 14);

const prose = '这是一段正文，提到 2026年6月30日 要上线，还有 6月2日 的会议。\n';
eq('normal strictness filters prose', extractBlocks({ path: 'a/p.md', basename: 'p', content: prose }, DEFAULT_SCAN_SETTINGS).length, 0);
eq('strict is stricter than normal', confidenceThreshold('strict') > confidenceThreshold('normal'), true);
eq('loose is looser than normal', confidenceThreshold('loose') < confidenceThreshold('normal'), true);

const declared = [
  '本文记录香港货运项目由金蝶迁移至新 ERP 的关键沟通与结论（时间戳：20260908），涵盖 COA 辅助核算与接口对照、数据导入与准备问题、ARAP 期初导入方法确认以及后续会议安排。',
  '## 关键沟通与结论（20260908）',
  '- 正文',
].join('\n');
eq('declared stamp in prose is ignored at normal', extractBlocks(
  { path: 'a/d.md', basename: 'd', content: declared },
  DEFAULT_SCAN_SETTINGS,
).length, 1);
eq('declared stamp in prose is caught at loose', extractBlocks(
  { path: 'a/d.md', basename: 'd', content: declared },
  { ...DEFAULT_SCAN_SETTINGS, strictness: 'loose' },
).length, 2);

const excluded = extractBlocks(
  { path: 'Templates/tpl.md', basename: 'tpl', content: '20260101\n正文\n' },
  DEFAULT_SCAN_SETTINGS,
);
eq('folder exclusion happens in scanVault, not extractBlocks', excluded.length, 1);

console.log('\n[7] Opt-out markers');
const IGN = { ignoreMarkers: ['*'] };
eq('star glued to the date opts out', analyzeLine('**报表日期：** *2026年12月31日', 0, IGN), null);
eq('bare star opt-out', analyzeLine('*20260626', 0, IGN), null);
eq('star inside a bullet still opts out', analyzeLine('- *20260626', 0, IGN), null);
check('emphasis is not an opt-out', analyzeLine('**报表日期：** 2026年12月31日', 0, IGN) !== null);
check('bullet with a space is not an opt-out', analyzeLine('* 20260626', 0, IGN) !== null);
check('closing bold is not an opt-out', analyzeLine('**最后更新**: 2026年6月8日', 0, IGN) !== null);
check('no marker configured means no filtering', analyzeLine('**报表日期：** *2026年12月31日', 0, {}) !== null);
check('multi-char marker works', analyzeLine('!!20260626', 0, { ignoreMarkers: ['!!'] }) === null);
check('run length must match the marker', hasIgnoreMarker('***20260626', 0, ['*']) === false);
check('adjacent star is detected', hasIgnoreMarker('*20260626', 1, ['*']));
check('nothing before the token', hasIgnoreMarker('20260626', 0, ['*']) === false);

const sheet = [
  '**编制单位：** 示例公司',
  '',
  '**报表日期：** *2026年12月31日',
  '',
  '#### **资产负债表（Statement of Financial Position）**',
  '',
  '| 项目 | 行号 | 期末余额 |',
  '| --- | --- | --- |',
  '| 货币资金 | 1 | 1,250,000 |',
].join('\n');
eq('template placeholder date is skipped', extractBlocks(
  { path: '学习/香港财务报表 - 资产负债表.md', basename: '香港财务报表 - 资产负债表', content: sheet },
  DEFAULT_SCAN_SETTINGS,
).length, 0);
eq('removing the marker brings it back', extractBlocks(
  { path: '学习/x.md', basename: 'x', content: sheet },
  { ...DEFAULT_SCAN_SETTINGS, ignoreMarkers: [] },
).length, 1);

const boldHeading = extractBlocks(
  { path: 'a/h.md', basename: 'h', content: '#### **资产负债表（X）**\n\n20260626\n正文\n' },
  DEFAULT_SCAN_SETTINGS,
);
eq('bold heading renders without asterisks', boldHeading[0].heading, '资产负债表（X）');

console.log('\n[8] Scope filtering');
check('folder matches its own files', inFolder('海航项目/a.md', '海航项目'));
check('folder matches sub-folders', inFolder('海航项目/子目录/b.md', '海航项目'));
check('folder does not match siblings', inFolder('大家乐采购/c.md', '海航项目') === false);
check('folder does not match a name prefix', inFolder('海航项目2/d.md', '海航项目') === false);
check('root scope matches only root files', inFolder('顶层.md', '') && inFolder('海航项目/a.md', '') === false);
check('nested scope is exact', inFolder('海航项目/子目录/b.md', '海航项目/子目录'));

const filterFixture: TimelineBlock[] = [
  mkBlock('海航项目/-海航项目进展跟踪.md', 2026, 6, 2, '- 今日进展：了解基本项目范围'),
  mkBlock('海航项目/香港货运会议 0728 - 0903.md', 2026, 8, 20, '1. 预计培训 系统登入'),
  mkBlock('大家乐采购/20260731 调研.md', 2026, 7, 31, '- 参会人员：用友团队顾问'),
  mkBlock('顶层笔记.md', 2026, 9, 1, '1. 做一个 code+name 两列的表', true),
];

eq('all scope keeps everything', filterBlocks(filterFixture, { query: '', hideEmpty: false }).length, 4);
eq('folder scope keeps the folder and its children', filterBlocks(filterFixture, {
  query: '',
  hideEmpty: false,
  folderPath: '海航项目',
}).length, 2);
eq('root scope keeps only root files', filterBlocks(filterFixture, {
  query: '',
  hideEmpty: false,
  folderPath: '',
}).length, 1);
eq('file scope keeps one note', filterBlocks(filterFixture, {
  query: '',
  hideEmpty: false,
  filePath: '大家乐采购/20260731 调研.md',
}).length, 1);
eq('folder + query combine', filterBlocks(filterFixture, {
  query: '培训',
  hideEmpty: false,
  folderPath: '海航项目',
}).length, 1);
eq('hideEmpty drops bodyless blocks', filterBlocks(filterFixture, { query: '', hideEmpty: true }).length, 3);
eq('filePath and folderPath are exclusive in practice', filterBlocks(filterFixture, {
  query: '',
  hideEmpty: false,
  filePath: '海航项目/-海航项目进展跟踪.md',
  folderPath: '大家乐采购',
}).length, 0);

console.log('\n[9] Task detection + only-unfinished filtering');
eq('unchecked task is todo', taskState('- [ ] 写周报'), 'todo');
eq('checked lowercase is done', taskState('- [x] 写周报'), 'done');
eq('checked uppercase is done', taskState('- [X] 写周报'), 'done');
eq('star bullet task', taskState('* [ ] 写周报'), 'todo');
eq('indented task', taskState('    - [ ] 子任务'), 'todo');
eq('no checkbox at all', taskState('- 普通列表项'), 'none');
eq('checkbox mid-line is not a task', taskState('正文里提到 - [ ] 但不是行首任务'), 'none');

check('block with an open task counts', hasOpenTask('- [ ] 未完成\n- [x] 已完成'));
check('block of only done tasks does not', hasOpenTask('- [x] 已完成\n- [x] 也完成了') === false);
check('block with no task does not', hasOpenTask('- 只是普通文本') === false);

const taskFixture: TimelineBlock[] = [
  mkBlock('a/1.md', 2026, 9, 10, '- [ ] 未完成任务一'),
  mkBlock('a/2.md', 2026, 9, 11, '- [x] 已完成任务'),
  mkBlock('a/3.md', 2026, 9, 12, '- [x] 已完成\n- [ ] 还有一个没做'),
  mkBlock('a/4.md', 2026, 9, 13, '纯正文，没有任务'),
];
eq('onlyTasks keeps open tasks incl. mixed blocks', filterBlocks(taskFixture, {
  query: '',
  hideEmpty: false,
  onlyTasks: true,
}).length, 2);
eq('onlyTasks drops the all-done block', filterBlocks(taskFixture, {
  query: '',
  hideEmpty: false,
  onlyTasks: true,
}).map((b) => b.filePath).join(','), 'a/1.md,a/3.md');
eq('onlyTasks off keeps everything', filterBlocks(taskFixture, {
  query: '',
  hideEmpty: false,
  onlyTasks: false,
}).length, 4);
eq('onlyTasks combines with a query', filterBlocks(taskFixture, {
  query: '未完成',
  hideEmpty: false,
  onlyTasks: true,
}).length, 1);

console.log('\n[10] Day outline digest');
eq('plainLine strips heading + bullet + emphasis', plainLine('- **今日进展**：1. 了解范围'), '今日进展：1. 了解范围');
eq('plainLine strips a heading marker', plainLine('### ARAP 期初导入方法确认'), 'ARAP 期初导入方法确认');
eq('plainLine strips inline code', plainLine('- 剔除 `docdate > 6.30`'), '剔除 docdate > 6.30');

const digestBlock = mkBlock(
  '海航项目/香港货运0908 - 之后.md',
  2026,
  9,
  14,
  '- 还是确认了一下 ARAP 的期初导法：\n  - 发现 Prepayment 和 AP 是分开的两个界面。',
);
eq(
  'digest carries time, label, source and first line',
  blockDigest({ ...digestBlock, stamp: { ...digestBlock.stamp, label: '会议' } }, 'HH:mm', 'zh'),
  '09:00 · 会议 · 香港货运0908 - 之后 · 还是确认了一下 ARAP 的期初导法：',
);
eq(
  'digest without a time starts at the label',
  blockDigest(
    { ...digestBlock, stamp: { ...digestBlock.stamp, hasTime: false } },
    'HH:mm',
    'zh',
  ),
  '香港货运0908 - 之后 · 还是确认了一下 ARAP 的期初导法：',
);
eq('digest of an empty block is time + source only', blockDigest(
  mkBlock('a/b.md', 2026, 9, 14, '', true),
  'HH:mm',
  'zh',
), '09:00 · b');

const longFirstLine = mkBlock('a/c.md', 2026, 9, 14, `- ${'长'.repeat(120)}`);
const longDigest = blockDigest(longFirstLine, 'HH:mm', 'zh');
check('digest truncates a very long first line', longDigest.includes('…') && longDigest.length < 120, longDigest);

finish();
