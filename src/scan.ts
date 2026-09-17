/**
 * Vault-wide timeline scan.
 *
 * Walks every markdown file, finds timestamp *markers* (deliberately lenient —
 * the author's older notes use `20260728`, `20260710/12`, honour the "检索范围
 * 大一点" requirement), slices the text that follows each marker into a content
 * block, and sorts everything by time.
 *
 * Only type-imports `obsidian`, so the pure parts stay unit-testable.
 */

import type { App, TFile } from 'obsidian';
import {
  analyzeLine,
  formatDate,
  isComplete,
  resolveToken,
  type LineStamp,
  type ResolveContext,
  type StampToken,
} from './timestamp';

// --------------------------------------------------------------------- types

export type Strictness = 'strict' | 'normal' | 'loose';

export interface ScanSettings {
  strictness: Strictness;
  /** Include `HH:mm`-only markers (transcript watermarks). Off by default. */
  includeTimeOnly: boolean;
  /** Fall back to a date inside the file name when the body has none. */
  useFilenameDate: boolean;
  /** Stop a block early when a heading of the same or higher level appears. */
  breakAtHeadings: boolean;
  /** `6月30日` / `9/14` without a year. Off = ignored entirely. */
  allowPartialDates: boolean;
  /** A timestamp written as `*2026年12月31日` is skipped. Default `['*']`. */
  ignoreMarkers: string[];
  /** Comma separated folder prefixes to skip. */
  excludeFolders: string;
}

export const DEFAULT_SCAN_SETTINGS: ScanSettings = {
  strictness: 'normal',
  includeTimeOnly: false,
  useFilenameDate: true,
  breakAtHeadings: true,
  allowPartialDates: true,
  ignoreMarkers: ['*'],
  excludeFolders: '',
};

export interface BlockStamp {
  /** 0-based line index of the marker. */
  line: number;
  date: Date;
  /** True when the marker carries a clock time. */
  hasTime: boolean;
  /** The matched text as it appears in the note. */
  raw: string;
  /** Trailing text on the marker line, e.g. "会议结果". */
  label: string;
  confidence: number;
  timeOnly: boolean;
  kind: StampToken['kind'];
}

export interface TimelineBlock {
  filePath: string;
  fileBasename: string;
  folder: string;
  stamp: BlockStamp;
  /** 0-based inclusive line range of the body (marker line excluded). */
  startLine: number;
  endLine: number;
  content: string;
  /** Nearest heading above the marker, for context. */
  heading: string;
  /** True when the whole file was dated from its name. */
  fromFilename: boolean;
}

export interface ScanResult {
  blocks: TimelineBlock[];
  fileCount: number;
  stampedFileCount: number;
  /** Files that failed to read or were excluded. */
  skipped: string[];
  durationMs: number;
}

// ------------------------------------------------------------------ helpers

export function confidenceThreshold(strictness: Strictness): number {
  if (strictness === 'strict') return 5;
  if (strictness === 'loose') return 0;
  return 3;
}

const HEADING_RE = /^\s{0,3}(#{1,6})\s+\S/;
const FENCE_RE = /^\s{0,3}(?:```|~~~)/;

function headingLevel(line: string): number {
  const m = HEADING_RE.exec(line);
  return m ? m[1].length : 0;
}

function headingText(line: string): string {
  return line
    .replace(/^\s{0,3}#{1,6}\s+/, '')
    .replace(/\s+#+\s*$/, '')
    // `#### **资产负债表（…）**` should not show its asterisks in the breadcrumb.
    .replace(/[*_`~]/g, '')
    .trim();
}

/** Peel leading YAML frontmatter; returns the line offset of the body. */
export function frontmatterLineCount(lines: string[]): number {
  if (lines[0]?.trim() !== '---') return 0;
  for (let i = 1; i < lines.length; i += 1) {
    if (lines[i].trim() === '---') return i + 1;
  }
  return 0;
}

/**
 * First full date inside a file name. Handles `20260903.md`,
 * `20260901 白帝城托孤.md`, `2026-09-14 会议.md`, `-海航周报_2026W23(0602-0608)`.
 */
export function filenameDate(basename: string): Date | null {
  const compact = /(?<!\d)(\d{4})(\d{2})(\d{2})(?!\d)/.exec(basename);
  if (compact) {
    const d = new Date(Number(compact[1]), Number(compact[2]) - 1, Number(compact[3]));
    if (validDate(d, Number(compact[1]), Number(compact[2]), Number(compact[3]))) return d;
  }
  const iso = /(?<!\d)(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?!\d)/.exec(basename);
  if (iso) {
    const y = Number(iso[1]);
    const mo = Number(iso[2]);
    const d0 = Number(iso[3]);
    const d = new Date(y, mo - 1, d0);
    if (validDate(d, y, mo, d0)) return d;
  }
  const cn = /(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日/.exec(basename);
  if (cn) {
    const y = Number(cn[1]);
    const mo = Number(cn[2]);
    const d0 = Number(cn[3]);
    const d = new Date(y, mo - 1, d0);
    if (validDate(d, y, mo, d0)) return d;
  }
  return null;
}

function validDate(d: Date, y: number, mo: number, day: number): boolean {
  return d.getFullYear() === y && d.getMonth() === mo - 1 && d.getDate() === day && y > 1900 && y < 2200;
}

export function folderOf(path: string): string {
  const idx = path.lastIndexOf('/');
  return idx < 0 ? '' : path.slice(0, idx);
}

function excluded(path: string, excludeFolders: string): boolean {
  if (!excludeFolders.trim()) return false;
  return excludeFolders
    .split(/[,，\n]/)
    .map((s) => s.trim().replace(/^\/+|\/+$/g, ''))
    .filter(Boolean)
    .some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
}

// ------------------------------------------------------------ block extraction

export interface FileSliceInput {
  path: string;
  basename: string;
  content: string;
}

/**
 * Pure core of the scanner: turn one file's text into timeline blocks.
 * Exported so tests can exercise it without a vault.
 */
export function extractBlocks(input: FileSliceInput, settings: ScanSettings, now = new Date()): TimelineBlock[] {
  const lines = input.content.split(/\r?\n/);
  const threshold = confidenceThreshold(settings.strictness);
  const bodyStart = frontmatterLineCount(lines);
  const folder = folderOf(input.path);

  const stamps: BlockStamp[] = [];
  let lastHeading = '';
  let lastComplete: Date | null = null;
  let inFence = false;

  for (let i = bodyStart; i < lines.length; i += 1) {
    const raw = lines[i];
    if (FENCE_RE.test(raw)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;

    const level = headingLevel(raw);
    if (level > 0) lastHeading = headingText(raw);

    if (raw.trim().length === 0) continue;

    const analysed: LineStamp | null = analyzeLine(raw, i, {
      allowPartialDates: settings.allowPartialDates,
      allowTimeOnly: settings.includeTimeOnly,
      ignoreMarkers: settings.ignoreMarkers,
    });
    if (!analysed) continue;
    if (analysed.timeOnly && !settings.includeTimeOnly) continue;
    if (analysed.confidence < threshold) continue;

    const ctx: ResolveContext = {
      fallbackYear: lastComplete?.getFullYear() ?? now.getFullYear(),
      fallbackDate: lastComplete ?? now,
    };
    const date = resolveToken(analysed.token, ctx);
    if (!date) continue;

    stamps.push({
      line: i,
      date,
      hasTime: analysed.token.hasTime,
      raw: analysed.token.raw,
      label: analysed.label,
      confidence: analysed.confidence,
      timeOnly: analysed.timeOnly,
      kind: analysed.token.kind,
    });
    if (isComplete(analysed.token)) lastComplete = date;
  }

  const blocks: TimelineBlock[] = [];

  if (stamps.length === 0) {
    if (!settings.useFilenameDate) return [];
    const fromName = filenameDate(input.basename);
    if (!fromName) return [];
    const content = trimBlank(lines.slice(bodyStart));
    if (content.text.length === 0) return [];
    blocks.push({
      filePath: input.path,
      fileBasename: input.basename,
      folder,
      stamp: {
        line: bodyStart,
        date: fromName,
        hasTime: false,
        raw: input.basename,
        label: '',
        confidence: 0,
        timeOnly: false,
        kind: 'compact',
      },
      startLine: bodyStart + content.start,
      endLine: content.end,
      content: content.text,
      heading: '',
      fromFilename: true,
    });
    return blocks;
  }

  for (let k = 0; k < stamps.length; k += 1) {
    const stamp = stamps[k];
    const startLine = stamp.line + 1;
    let endLine = k + 1 < stamps.length ? stamps[k + 1].line - 1 : lines.length - 1;

    if (settings.breakAtHeadings) {
      const own = headingLevel(lines[stamp.line]);
      const stampLevel = own > 0 ? own : 7;
      for (let j = startLine; j <= endLine; j += 1) {
        const lv = headingLevel(lines[j]);
        if (lv > 0 && lv <= stampLevel) {
          endLine = j - 1;
          break;
        }
      }
    }

    const slice = trimBlank(lines.slice(startLine, endLine + 1));
    blocks.push({
      filePath: input.path,
      fileBasename: input.basename,
      folder,
      stamp,
      startLine: startLine + slice.start,
      endLine: Math.max(startLine + slice.start - 1, startLine + slice.end),
      content: slice.text,
      heading: nearestHeadingAbove(lines, stamp.line, bodyStart, lastHeading),
      fromFilename: false,
    });
  }

  return blocks;
}

function nearestHeadingAbove(lines: string[], line: number, bodyStart: number, fallback: string): string {
  // Start above the marker itself — a `### 2026年6月2日` marker is a heading and
  // should not be reported as its own breadcrumb.
  for (let i = line - 1; i >= bodyStart; i -= 1) {
    if (headingLevel(lines[i]) > 0) return headingText(lines[i]);
  }
  return fallback;
}

function trimBlank(lines: string[]): { text: string; start: number; end: number } {
  let start = 0;
  let end = lines.length - 1;
  while (start <= end && lines[start].trim().length === 0) start += 1;
  while (end >= start && lines[end].trim().length === 0) end -= 1;
  if (start > end) return { text: '', start: 0, end: -1 };
  return { text: lines.slice(start, end + 1).join('\n'), start, end };
}

// ---------------------------------------------------------------- vault scan

export async function scanVault(app: App, settings: ScanSettings): Promise<ScanResult> {
  const started = Date.now();
  const files = app.vault.getMarkdownFiles();
  const blocks: TimelineBlock[] = [];
  const skipped: string[] = [];
  let stampedFileCount = 0;

  for (const file of files) {
    if (excluded(file.path, settings.excludeFolders)) continue;
    try {
      const content = await app.vault.cachedRead(file);
      const found = extractBlocks(
        { path: file.path, basename: file.basename, content },
        settings,
      );
      if (found.length > 0) {
        stampedFileCount += 1;
        blocks.push(...found);
      }
    } catch {
      skipped.push(file.path);
    }
  }

  return {
    blocks,
    fileCount: files.length,
    stampedFileCount,
    skipped,
    durationMs: Date.now() - started,
  };
}

// ------------------------------------------------------------- presentation

export type SortOrder = 'desc' | 'asc';
export type GroupMode = 'day' | 'file' | 'none';

export function sortBlocks(blocks: TimelineBlock[], order: SortOrder): TimelineBlock[] {
  const sorted = [...blocks].sort((a, b) => {
    const diff = a.stamp.date.getTime() - b.stamp.date.getTime();
    if (diff !== 0) return diff;
    if (a.filePath !== b.filePath) return a.filePath.localeCompare(b.filePath);
    return a.stamp.line - b.stamp.line;
  });
  return order === 'desc' ? sorted.reverse() : sorted;
}

export function dayKey(date: Date): string {
  return formatDate(date, 'YYYY-MM-DD', 'zh');
}

/** Strip the markdown decoration that would only add noise to a one-liner. */
export function plainLine(line: string): string {
  return line
    .replace(/^\s{0,3}#{1,6}\s+/, '')
    .replace(/^\s*[-*+>]\s+/, '')
    .replace(/\*\*?/g, '')
    .replace(/`/g, '')
    .trim();
}

/**
 * One-line digest of a block, used when a whole day is folded down to an
 * outline. Content never disappears — it only gets denser.
 */
export function blockDigest(block: TimelineBlock, timeFormat: string, lang: 'zh' | 'en'): string {
  const parts: string[] = [];
  if (block.stamp.hasTime) parts.push(formatDate(block.stamp.date, timeFormat, lang));
  if (block.stamp.label) parts.push(block.stamp.label);
  parts.push(block.fileBasename);
  const first = block.content
    .split('\n')
    .map(plainLine)
    .filter((line) => line.length > 0)[0];
  if (first) parts.push(first.length > 72 ? `${first.slice(0, 72)}…` : first);
  return parts.join(' · ');
}

export interface DayGroup {
  key: string;
  date: Date;
  blocks: TimelineBlock[];
}

export function groupByDay(blocks: TimelineBlock[], order: SortOrder): DayGroup[] {
  const map = new Map<string, DayGroup>();
  for (const block of sortBlocks(blocks, 'asc')) {
    const key = dayKey(block.stamp.date);
    let group = map.get(key);
    if (!group) {
      const date = new Date(block.stamp.date);
      date.setHours(0, 0, 0, 0);
      group = { key, date, blocks: [] };
      map.set(key, group);
    }
    group.blocks.push(block);
  }
  const out = [...map.values()].map((g) => ({ ...g, blocks: sortBlocks(g.blocks, order) }));
  return order === 'desc' ? out.reverse() : out;
}

export interface FileGroup {
  path: string;
  basename: string;
  blocks: TimelineBlock[];
}

export function groupByFile(blocks: TimelineBlock[], order: SortOrder): FileGroup[] {
  const map = new Map<string, FileGroup>();
  for (const block of blocks) {
    let group = map.get(block.filePath);
    if (!group) {
      group = { path: block.filePath, basename: block.fileBasename, blocks: [] };
      map.set(block.filePath, group);
    }
    group.blocks.push(block);
  }
  const out = [...map.values()].sort((a, b) => a.path.localeCompare(b.path));
  for (const group of out) group.blocks = sortBlocks(group.blocks, order);
  return out;
}

// ------------------------------------------------------------------ filtering

/** Is `filePath` inside `folderPath` (or any of its sub-folders)? `''` = vault root. */
export function inFolder(filePath: string, folderPath: string): boolean {
  if (folderPath === '') return !filePath.includes('/');
  return filePath.startsWith(`${folderPath}/`);
}

export interface BlockFilter {
  /** Free text, already lower-cased. Empty = everything. */
  query: string;
  /** Only blocks from this note. */
  filePath?: string;
  /** Only blocks under this folder, sub-folders included. */
  folderPath?: string;
  hideEmpty: boolean;
  /** Keep only blocks that still contain an unchecked `- [ ]` task. */
  onlyTasks?: boolean;
}

/** A markdown task checkbox: `- [ ]`, `* [x]`, `+ [X]`, with any indentation. */
const TASK_RE = /^\s*[-*+]\s+\[([ xX])\]\s+/;

/** Task state of the first checkbox found in a block, if any. */
export function taskState(content: string): 'todo' | 'done' | 'none' {
  for (const line of content.split('\n')) {
    const m = TASK_RE.exec(line);
    if (!m) continue;
    return m[1] === ' ' ? 'todo' : 'done';
  }
  return 'none';
}

/**
 * Does the block contain at least one unchecked task?
 *
 * Deliberately "any open task wins": a block holding both `- [x]` and `- [ ]`
 * is still work in progress, and hiding it would drop the open item.
 */
export function hasOpenTask(content: string): boolean {
  for (const line of content.split('\n')) {
    const m = TASK_RE.exec(line);
    if (m && m[1] === ' ') return true;
  }
  return false;
}

export function filterBlocks(blocks: TimelineBlock[], filter: BlockFilter): TimelineBlock[] {
  const query = filter.query.trim();
  return blocks.filter((block) => {
    if (filter.onlyTasks && !hasOpenTask(block.content)) return false;
    if (filter.hideEmpty && block.content.trim().length === 0) return false;
    if (filter.filePath && block.filePath !== filter.filePath) return false;
    if (filter.folderPath !== undefined && !inFolder(block.filePath, filter.folderPath)) return false;
    if (!query) return true;
    return (
      block.content.toLowerCase().includes(query) ||
      block.fileBasename.toLowerCase().includes(query) ||
      block.stamp.label.toLowerCase().includes(query) ||
      block.heading.toLowerCase().includes(query) ||
      block.stamp.raw.toLowerCase().includes(query)
    );
  });
}

// ------------------------------------------------------------- md rendering

export interface MarkdownOptions {
  title: string;
  order: SortOrder;
  timeFormat: string;
  lang: 'zh' | 'en';
  includeSource: boolean;
  /** Max characters of a block body. 0 = unlimited. */
  maxChars: number;
}

/**
 * Flatten blocks into one markdown document.
 *
 * Layout:
 *   # 时间线汇总
 *   ## 2026-06-02 周二          ← day
 *   ### 09:14 · [[笔记名]]      ← one heading per block
 *   …body…
 */
export function blocksToMarkdown(blocks: TimelineBlock[], opts: MarkdownOptions): string {
  const groups = groupByDay(blocks, opts.order);
  const lines: string[] = [`# ${opts.title}`, ''];

  const withTime = blocks.filter((b) => b.stamp.hasTime).length;
  const files = new Set(blocks.map((b) => b.filePath)).size;
  const range = blocks.length
    ? `${dayKey(groupByDay(blocks, 'asc')[0].date)} ~ ${dayKey(groupByDay(blocks, 'desc')[0].date)}`
    : '';

  lines.push(`> ${blocks.length} 个时间块 · ${files} 篇笔记 · ${withTime} 条带具体时刻${range ? ` · ${range}` : ''}`);
  lines.push('');

  for (const group of groups) {
    lines.push(`## ${group.key} ${formatDate(group.date, 'ddd', opts.lang)}`);
    lines.push('');
    for (const block of group.blocks) {
      const time = block.stamp.hasTime ? formatDate(block.stamp.date, opts.timeFormat, opts.lang) : '';
      const source = opts.includeSource ? ` · [[${block.fileBasename}]]` : '';
      const label = block.stamp.label ? ` ${block.stamp.label}` : '';
      lines.push(`### ${time ? `${time} ` : ''}${label.trim()}${source}`.replace(/\s{2,}/g, ' ').trim());
      lines.push('');
      if (block.content) {
        const body =
          opts.maxChars > 0 && block.content.length > opts.maxChars
            ? `${block.content.slice(0, opts.maxChars)}\n\n<!-- 已截断 -->`
            : block.content;
        lines.push(body);
      } else {
        lines.push('_(无正文)_');
      }
      lines.push('');
    }
  }

  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n';
}
