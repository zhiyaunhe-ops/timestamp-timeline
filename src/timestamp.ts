/**
 * Timestamp parsing + formatting.
 *
 * Deliberately free of any Obsidian import so the whole module is unit-testable
 * in plain Node (see tests/smoke.ts).
 *
 * Real-world shapes this must swallow (all of these appear in the author's vault):
 *
 *   20260728                        compact 8-digit, on its own line
 *   20260728 会议结果                compact + trailing label
 *   20260710/12 , 20260720-22        compact day ranges
 *   ### 2026年6月2日                 Chinese date used as a heading
 *   - **会议时间**：2026-06-04 12:40:54
 *   **报告周期**：2026年6月2日 - 6月8日（第23周）
 *   元宝会议助手17:14                time only (meeting-transcript tool watermark)
 *   [[2026-09-14]]                  daily-note link
 */

// --------------------------------------------------------------------- types

export type Lang2 = 'zh' | 'en';

export interface DaySegment {
  /** Inclusive start hour, 0-23. */
  startHour: number;
  label: string;
}

export type TokenKind = 'compact-range' | 'iso' | 'compact' | 'cn' | 'cn-md' | 'time';

export interface StampToken {
  kind: TokenKind;
  /** Raw matched text. */
  raw: string;
  /** Offset inside the line. */
  start: number;
  end: number;
  hasDate: boolean;
  hasTime: boolean;
  year?: number;
  month?: number;
  day?: number;
  /** Last day of a range such as `20260720-22`. */
  endDay?: number;
  hour?: number;
  minute?: number;
}

/** One parsed timestamp found on a line, plus the context used to score it. */
export interface LineStamp {
  /** 0-based line index. */
  line: number;
  token: StampToken;
  /** Text after the token, markdown decoration stripped. */
  label: string;
  atLineStart: boolean;
  inHeading: boolean;
  inBold: boolean;
  hasLabelHint: boolean;
  lineLength: number;
  timeOnly: boolean;
  confidence: number;
}

export interface ParseOptions {
  /**
   * Bare `月日` / `M/D` without a year are extremely common in prose
   * ("6月30日前能看到财务报表"). When false they are ignored entirely.
   * Default true, but they score low so normal strictness filters them out.
   */
  allowPartialDates?: boolean;
  /** Bare `HH:mm` tokens. Default true (still scored low). */
  allowTimeOnly?: boolean;
  /**
   * Opt-out markers. A timestamp written as `*2026年12月31日` is skipped so a
   * date that is only a template placeholder never lands on the timeline.
   * Matched by strict adjacency, see `hasIgnoreMarker`.
   */
  ignoreMarkers?: string[];
}

/**
 * Does an opt-out marker sit immediately before the timestamp?
 *
 * Strictly adjacent on purpose: `*2026年12月31日` opts out, while a markdown
 * bullet `* 20260626` and emphasis `**报表日期：** 2026年12月31日` do not.
 * The trailing run length is compared against the marker so that `**` never
 * counts as a single `*`.
 */
export function hasIgnoreMarker(line: string, tokenStart: number, markers: string[]): boolean {
  if (markers.length === 0 || tokenStart <= 0) return false;
  const before = line.slice(0, tokenStart);
  const last = before[before.length - 1];
  if (last === undefined || /\s/.test(last)) return false;

  let run = 0;
  for (let i = before.length - 1; i >= 0 && before[i] === last; i -= 1) run += 1;

  return markers.some((m) => m.length > 0 && before.endsWith(m) && run <= m.length);
}

// -------------------------------------------------------------------- tokens

const NUMBER = '(\\d{4})';

interface PatternDef {
  kind: TokenKind;
  re: RegExp;
  build(m: RegExpExecArray): Partial<StampToken>;
}

const PATTERNS: PatternDef[] = [
  // 20260710/12 — compact range, same month
  {
    kind: 'compact-range',
    re: /(?<!\d)(\d{4})(\d{2})(\d{2})\s*[-~/]\s*(\d{1,2})(?!\d)/g,
    build: (m) => ({
      hasDate: true,
      hasTime: false,
      year: num(m[1]),
      month: num(m[2]),
      day: num(m[3]),
      endDay: num(m[4]),
    }),
  },
  // 2026-06-04 / 2026/6/4 / 2026.06.04, optionally followed by 12:40[:54]
  {
    kind: 'iso',
    re: /(?<!\d)(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?!\d)(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?/g,
    build: (m) => ({
      hasDate: true,
      hasTime: m[4] !== undefined,
      year: num(m[1]),
      month: num(m[2]),
      day: num(m[3]),
      hour: m[4] === undefined ? undefined : num(m[4]),
      minute: m[5] === undefined ? undefined : num(m[5]),
    }),
  },
  // 20260710 (a `T12:40` / ` 12:40` suffix must carry a colon so that
  // "20260731 - 0803" is not read as 08:03)
  {
    kind: 'compact',
    re: /(?<!\d)(\d{4})(\d{2})(\d{2})(?!\d)(?:[ T](\d{1,2}):(\d{2}))?/g,
    build: (m) => ({
      hasDate: true,
      hasTime: m[4] !== undefined,
      year: num(m[1]),
      month: num(m[2]),
      day: num(m[3]),
      hour: m[4] === undefined ? undefined : num(m[4]),
      minute: m[5] === undefined ? undefined : num(m[5]),
    }),
  },
  // 2026年6月2日
  {
    kind: 'cn',
    re: /(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日?/g,
    build: (m) => ({
      hasDate: true,
      hasTime: false,
      year: num(m[1]),
      month: num(m[2]),
      day: num(m[3]),
    }),
  },
  // 6月2日 (no year — resolved against the surrounding context)
  {
    kind: 'cn-md',
    re: /(?<!\d)(\d{1,2})\s*月\s*(\d{1,2})\s*日/g,
    build: (m) => ({
      hasDate: true,
      hasTime: false,
      month: num(m[1]),
      day: num(m[2]),
    }),
  },
];

const TIME_RE = /(?<![\d:])(\d{1,2}):(\d{2})(?::(\d{2}))?(?![\d:])/g;

/** Words right before a date that make it a *marker* rather than prose. */
const LABEL_HINT_RE = /(日期|时间|周期|报告期|更新|发布|创建|记录|date|time|datetime|period|updated|created)/i;

const HEADING_RE = /^\s{0,3}#{1,6}\s/;

/** Characters that may precede a timestamp while still counting as "line start". */
const LEADING_NOISE_RE = /^[\s>*+\-#•·|]*/;

function num(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) ? n : undefined;
}

function validDate(year: number | undefined, month: number | undefined, day: number | undefined): boolean {
  if (month !== undefined && (month < 1 || month > 12)) return false;
  if (day !== undefined && (day < 1 || day > 31)) return false;
  if (year !== undefined && (year < 1900 || year > 2200)) return false;
  if (year !== undefined && month !== undefined && day !== undefined) {
    const probe = new Date(year, month - 1, day);
    return probe.getFullYear() === year && probe.getMonth() === month - 1 && probe.getDate() === day;
  }
  return true;
}

// -------------------------------------------------------------- token search

/** Find every date token on a line, longest patterns first, no overlaps. */
export function findDateTokens(line: string, opts: ParseOptions = {}): StampToken[] {
  const allowPartial = opts.allowPartialDates !== false;
  const found: StampToken[] = [];

  for (const def of PATTERNS) {
    if (!allowPartial && (def.kind === 'cn-md')) continue;
    def.re.lastIndex = 0;
    let m = def.re.exec(line);
    while (m) {
      const built = def.build(m);
      const start = m.index;
      const end = m.index + m[0].length;
      m = def.re.exec(line);
      if (!validDate(built.year, built.month, built.day)) continue;
      if (found.some((t) => start < t.end && end > t.start)) continue;
      found.push({ ...built, kind: def.kind, raw: line.slice(start, end), start, end } as StampToken);
    }
  }

  return found.sort((a, b) => a.start - b.start);
}

export function findTimeTokens(line: string): StampToken[] {
  const out: StampToken[] = [];
  TIME_RE.lastIndex = 0;
  let m = TIME_RE.exec(line);
  while (m) {
    const hour = num(m[1]);
    const minute = num(m[2]);
    const start = m.index;
    const end = m.index + m[0].length;
    m = TIME_RE.exec(line);
    if (hour === undefined || minute === undefined || hour > 23 || minute > 59) continue;
    out.push({
      kind: 'time',
      raw: line.slice(start, end),
      start,
      end,
      hasDate: false,
      hasTime: true,
      hour,
      minute,
    });
  }
  return out;
}

/** Strip the markdown noise a label may carry. */
function cleanLabel(text: string): string {
  return text
    .replace(/\[\[([^\]|]+)(\|[^\]]+)?\]\]/g, '$1')
    .replace(/[*_`~]/g, '')
    .replace(/^\s*[-–—:：·|]+\s*/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// --------------------------------------------------------------- line scoring

export interface AnalyzeResult {
  stamp: LineStamp | null;
  /** A date token exists but no time was attached. */
  dateOnly: StampToken | null;
}

/**
 * Pick the most plausible timestamp on a line and score how much it looks like
 * a *marker* rather than a date mentioned inside a sentence.
 */
export function analyzeLine(line: string, lineIndex: number, opts: ParseOptions = {}): LineStamp | null {
  const ignore = opts.ignoreMarkers ?? [];
  const dates = findDateTokens(line, opts).filter((t) => !hasIgnoreMarker(line, t.start, ignore));
  const times = (opts.allowTimeOnly === false ? [] : findTimeTokens(line)).filter(
    (t) => !hasIgnoreMarker(line, t.start, ignore),
  );

  let primary: StampToken | undefined = dates[0];
  if (!primary) {
    // A lone time only counts when the line is nothing but a time/watermark,
    // e.g. "元宝会议助手17:14".
    if (times.length === 0) return null;
    primary = times[0];
  }

  // Attach a nearby time to a date-only token (`2026-09-14 周一 · 晚上 22:01`).
  if (primary.hasDate && !primary.hasTime) {
    const partner = times.find((t) => Math.abs(t.start - primary!.end) < 40 || t.start > primary!.end);
    if (partner) {
      primary = { ...primary, hasTime: true, hour: partner.hour, minute: partner.minute };
    }
  }

  const timeOnly = !primary.hasDate;

  const lead = LEADING_NOISE_RE.exec(line)?.[0].length ?? 0;
  const atLineStart = primary.start <= lead;
  const inHeading = HEADING_RE.test(line);
  const around = line.slice(Math.max(0, primary.start - 2), Math.min(line.length, primary.end + 2));
  const inBold = /\*\*/.test(around);
  const beforeToken = line.slice(Math.max(0, primary.start - 14), primary.start);
  const hasLabelHint = LABEL_HINT_RE.test(beforeToken);
  const label = cleanLabel(line.slice(primary.end));
  const lineLength = line.length;

  let confidence = 0;
  if (timeOnly) {
    // A lone `HH:mm` is only a marker when the line around it is short, e.g.
    // the "元宝会议助手17:14" transcript watermark.
    if (atLineStart) confidence += 3;
    if (lineLength <= 24) confidence += 2;
    if (lineLength <= 12) confidence += 1;
    if (line.slice(0, primary.start).trim().length <= 12) confidence += 1;
    if (inHeading) confidence += 2;
    if (inBold) confidence += 1;
    if (label.length > 30) confidence -= 2;
  } else {
    if (atLineStart) confidence += 3;
    if (inHeading) confidence += 2;
    if (inBold) confidence += 1;
    if (hasLabelHint) confidence += 3;
    if (lineLength <= 30) confidence += 1;
    // A date buried in a long paragraph is usually prose, not a marker — but an
    // explicit "时间戳：20260908" inside one is a deliberate declaration, so go
    // easier on it (the loose level then picks it up).
    else if (lineLength > 50 && !atLineStart) confidence -= hasLabelHint ? 1 : 3;
    if (label.length === 0) confidence += 0.5;
    else if (label.length <= 20) confidence += 0.5;
    else if (label.length > 60) confidence -= 1;
    if (primary.hasDate && primary.hasTime) confidence += 0.5;
    if (primary.kind === 'cn-md') confidence -= 1;
  }

  return {
    line: lineIndex,
    token: primary,
    label,
    atLineStart,
    inHeading,
    inBold,
    hasLabelHint,
    lineLength,
    timeOnly,
    confidence,
  };
}

/**
 * Parse a whole document. Stamps come back in source order with line indices.
 * `minConfidence` filters prose mentions of dates.
 */
export function parseStamps(text: string, opts: ParseOptions & { minConfidence?: number } = {}): LineStamp[] {
  const min = opts.minConfidence ?? 3;
  const lines = text.split(/\r?\n/);
  const out: LineStamp[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    const stamp = analyzeLine(lines[i], i, opts);
    if (stamp && stamp.confidence >= min) out.push(stamp);
  }
  return out;
}

// -------------------------------------------------------------- date resolution

export interface ResolveContext {
  /** Year to assume for `6月2日` style stamps. */
  fallbackYear: number;
  /** Date to assume for time-only stamps. */
  fallbackDate?: Date;
}

export function isComplete(token: StampToken): boolean {
  return token.year !== undefined && token.month !== undefined && token.day !== undefined;
}

/**
 * Turn a token into a concrete local Date, borrowing the year from the nearest
 * preceding complete stamp when the token has none.
 */
export function resolveToken(token: StampToken, ctx: ResolveContext): Date | null {
  const month = token.month;
  const day = token.day;
  const hour = token.hour ?? 0;
  const minute = token.minute ?? 0;

  if (!token.hasDate) {
    if (!ctx.fallbackDate) return null;
    const base = new Date(ctx.fallbackDate);
    base.setHours(hour, minute, 0, 0);
    return base;
  }

  if (month === undefined || day === undefined) return null;
  const year = token.year ?? ctx.fallbackYear;
  const probe = new Date(year, month - 1, day, hour, minute, 0, 0);
  // A partial stamp dated in the "future" almost always belongs to last year.
  if (token.year === undefined && probe.getTime() - Date.now() > 30 * 86400_000) {
    probe.setFullYear(year - 1);
  }
  return probe;
}

/**
 * Walk a stamp list in order, filling in the context needed to resolve
 * year-less and date-less stamps.
 */
export function resolveAll(stamps: LineStamp[], fallbackYear: number, fallbackDate?: Date): Array<LineStamp & { date: Date | null }> {
  const out: Array<LineStamp & { date: Date | null }> = [];
  let lastComplete: Date | null = null;
  for (const stamp of stamps) {
    const ctx: ResolveContext = {
      fallbackYear: lastComplete?.getFullYear() ?? fallbackYear,
      fallbackDate: lastComplete ?? fallbackDate,
    };
    const date = resolveToken(stamp.token, ctx);
    if (date && isComplete(stamp.token)) lastComplete = date;
    out.push({ ...stamp, date });
  }
  return out;
}

// ------------------------------------------------------------------ formatting

const WEEKDAY_ZH_SHORT = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
const WEEKDAY_ZH_LONG = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];
const WEEKDAY_EN_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const WEEKDAY_EN_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTH_EN_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTH_EN_LONG = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

const pad = (n: number, width = 2): string => String(n).padStart(width, '0');

/**
 * Tiny `moment`-style formatter. Only the tokens listed below are supported —
 * intentionally, so a typo in the settings shows up as literal text instead of
 * silently producing something odd.
 *
 *   YYYY YY | MMMM MMM MM M | DD D | HH H hh h | mm ss | dddd ddd | A a
 */
export function formatDate(date: Date, pattern: string, lang: Lang2 = 'zh'): string {
  const h24 = date.getHours();
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  const zh = lang === 'zh';

  const map: Record<string, () => string> = {
    YYYY: () => pad(date.getFullYear(), 4),
    YY: () => pad(date.getFullYear() % 100),
    MMMM: () => (zh ? `${date.getMonth() + 1}月` : MONTH_EN_LONG[date.getMonth()]),
    MMM: () => (zh ? `${date.getMonth() + 1}月` : MONTH_EN_SHORT[date.getMonth()]),
    MM: () => pad(date.getMonth() + 1),
    M: () => String(date.getMonth() + 1),
    DD: () => pad(date.getDate()),
    D: () => String(date.getDate()),
    dddd: () => (zh ? WEEKDAY_ZH_LONG[date.getDay()] : WEEKDAY_EN_LONG[date.getDay()]),
    ddd: () => (zh ? WEEKDAY_ZH_SHORT[date.getDay()] : WEEKDAY_EN_SHORT[date.getDay()]),
    HH: () => pad(h24),
    H: () => String(h24),
    hh: () => pad(h12),
    h: () => String(h12),
    mm: () => pad(date.getMinutes()),
    ss: () => pad(date.getSeconds()),
    A: () => (h24 < 12 ? 'AM' : 'PM'),
    a: () => (h24 < 12 ? 'am' : 'pm'),
  };

  const keys = Object.keys(map).sort((a, b) => b.length - a.length);
  const re = new RegExp(keys.join('|'), 'g');
  return pattern.replace(re, (token) => map[token]?.() ?? token);
}

// ---------------------------------------------------------------- day segments

export const DEFAULT_SEGMENTS_ZH = '05:早上,11:中午,13:下午,18:晚上,23:凌晨';
export const DEFAULT_SEGMENTS_EN = '05:morning,11:noon,13:afternoon,18:evening,23:late night';

const SEGMENT_TRANSLATIONS: Record<string, string> = {
  早上: 'morning',
  早晨: 'morning',
  上午: 'morning',
  中午: 'noon',
  下午: 'afternoon',
  晚上: 'evening',
  傍晚: 'evening',
  凌晨: 'late night',
  深夜: 'late night',
  夜间: 'night',
};

/** `"05:早上,11:中午,13:下午,18:晚上,23:凌晨"` → sorted segment list. */
export function parseDaySegments(spec: string): DaySegment[] {
  const out: DaySegment[] = [];
  for (const piece of spec.split(/[,，;；\n]/)) {
    const m = /^\s*(\d{1,2})\s*[:：=]\s*(.+?)\s*$/.exec(piece);
    if (!m) continue;
    const hour = Number.parseInt(m[1], 10);
    if (!Number.isFinite(hour) || hour < 0 || hour > 23) continue;
    out.push({ startHour: hour, label: m[2] });
  }
  out.sort((a, b) => a.startHour - b.startHour);
  if (out.length === 0) out.push({ startHour: 0, label: '' });
  return out;
}

/** Which segment an hour falls into. Hours before the first boundary wrap to the last one. */
export function segmentFor(hour: number, segments: DaySegment[]): DaySegment {
  let chosen = segments[segments.length - 1];
  for (const seg of segments) {
    if (hour >= seg.startHour) chosen = seg;
    else break;
  }
  return chosen;
}

export function segmentLabel(label: string, lang: Lang2): string {
  if (lang === 'zh') return label;
  return SEGMENT_TRANSLATIONS[label] ?? label;
}

/**
 * Does a piece of text (usually a stamp's own label, e.g. `周二 · 早上`) name one
 * of the configured day segments?
 *
 * Longest label first, so a vault using both `午` and `上午` picks the specific
 * one. English templates produce the translated word (`morning`), so that
 * spelling is accepted too.
 */
export function segmentMatchingLabel(text: string, segments: DaySegment[]): DaySegment | null {
  if (!text) return null;
  const candidates = [...segments].sort((a, b) => b.label.length - a.label.length);
  for (const seg of candidates) {
    if (!seg.label) continue;
    if (text.includes(seg.label) || text.includes(segmentLabel(seg.label, 'en'))) return seg;
  }
  return null;
}

function sameCalendarDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
  );
}

// -------------------------------------------------------------- stamp building

export interface StampFormatConfig {
  template: string;
  dateFormat: string;
  timeFormat: string;
  segments: string;
  lang: Lang2;
}

export const DEFAULT_STAMP_TEMPLATE = '### {date} {weekday} · {part} {time}';

export function buildStamp(date: Date, cfg: StampFormatConfig): string {
  const segments = parseDaySegments(cfg.segments);
  const part = segmentLabel(segmentFor(date.getHours(), segments).label, cfg.lang);
  const out = cfg.template
    .replace(/\{date\}/g, formatDate(date, cfg.dateFormat, cfg.lang))
    .replace(/\{time\}/g, formatDate(date, cfg.timeFormat, cfg.lang))
    .replace(/\{weekday-long\}/g, formatDate(date, 'dddd', cfg.lang))
    .replace(/\{weekday\}/g, formatDate(date, 'ddd', cfg.lang))
    .replace(/\{part\}/g, part)
    .replace(/\{iso\}/g, formatDate(date, 'YYYY-MM-DD HH:mm', 'zh'))
    .replace(/\{year\}/g, formatDate(date, 'YYYY', cfg.lang))
    .replace(/\{month\}/g, formatDate(date, 'MM', cfg.lang))
    .replace(/\{day\}/g, formatDate(date, 'DD', cfg.lang));
  return out.replace(/\s+/g, ' ').trim();
}

// ------------------------------------------------ "is the last stamp recent?" 

export interface RecentnessVerdict {
  /** A fresh stamp already exists, nothing to do. */
  skip: boolean;
  /** Reason, handy for the settings preview and for tests. */
  reason: 'no-stamp' | 'fresh' | 'stale' | 'segment-changed';
  last?: LineStamp & { date: Date };
  /** Hours since the newest stamp found before the cursor. For a time-less stamp this is an estimate — see `timelessAnchor`. */
  ageHours?: number;
}

/**
 * When a stamp carries no clock time, `resolveToken` parks it at 00:00 of its
 * day. Read literally that is a lie: a stamp written one minute ago looks ten
 * hours old, and `segmentFor(0)` wraps to the *last* segment, so the stamp also
 * appears to sit in the wrong part of the day. The result was a fresh stamp on
 * every pause while typing.
 *
 * Recover the truth as far as the text allows: a same-day stamp that names its
 * segment is anchored at that segment's first hour, and anything else from
 * today is treated as "written just now" — the only reading that cannot double
 * stamp. Stamps from an earlier day keep the midnight anchor, which is stale
 * whatever happens.
 */
function timelessAnchor(
  last: LineStamp & { date: Date },
  now: Date,
  segments: DaySegment[],
): { at: Date; segment: DaySegment | null } {
  const named = segmentMatchingLabel(last.label, segments);

  if (!sameCalendarDay(last.date, now)) return { at: last.date, segment: named };

  if (named && named.startHour <= now.getHours()) {
    const at = new Date(last.date);
    at.setHours(named.startHour, 0, 0, 0);
    return { at, segment: named };
  }

  return { at: now, segment: segmentFor(now.getHours(), segments) };
}

/**
 * Decide whether the text *before the cursor* still has a recent timestamp.
 * This is the whole "don't double-stamp while writing" rule.
 *
 * Works with a time-less template too (an empty time format): such a stamp is
 * judged on its day and, when it names one, its day segment — one stamp per
 * segment instead of one per keystroke pause.
 */
export function verdictForText(
  before: string,
  now: Date,
  cfg: StampFormatConfig & {
    thresholdHours: number;
    stampOnSegmentChange: boolean;
    minConfidence?: number;
    allowTimeOnly?: boolean;
  },
): RecentnessVerdict {
  const stamps = parseStamps(before, {
    minConfidence: cfg.minConfidence ?? 3,
    allowTimeOnly: cfg.allowTimeOnly !== false,
  });
  const resolved = resolveAll(stamps, now.getFullYear(), now);
  const dated = resolved.filter((s): s is LineStamp & { date: Date } => s.date !== null);
  if (dated.length === 0) return { skip: false, reason: 'no-stamp' };

  const last = dated[dated.length - 1];
  const segments = parseDaySegments(cfg.segments);
  const nowSegment = segmentFor(now.getHours(), segments);

  const clocked = last.token.hasTime && last.token.hour !== undefined;
  const anchor = clocked ? null : timelessAnchor(last, now, segments);
  const at = anchor ? anchor.at : last.date;
  const lastSegment = clocked ? segmentFor(last.token.hour as number, segments) : anchor!.segment;
  const ageHours = (now.getTime() - at.getTime()) / 3600_000;

  // A stamp that cannot name its segment (no clock time, unlabelled) is judged
  // on age alone — guessing a segment would only produce false positives.
  if (cfg.stampOnSegmentChange && lastSegment && lastSegment.label !== nowSegment.label) {
    return { skip: false, reason: 'segment-changed', last, ageHours };
  }
  if (ageHours >= cfg.thresholdHours) return { skip: false, reason: 'stale', last, ageHours };
  return { skip: true, reason: 'fresh', last, ageHours };
}
