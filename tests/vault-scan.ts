/**
 * Validate the timeline scanner against a real vault.
 *
 *   VAULT="<VaultPath>" node tests/run.mjs tests/vault-scan.ts
 *
 * Prints what each strictness level picks up, so false positives and misses are
 * obvious at a glance.
 */
import fs from 'node:fs';
import path from 'node:path';
import { DEFAULT_SCAN_SETTINGS, extractBlocks, type ScanSettings, type TimelineBlock } from '../src/scan';
import { formatDate } from '../src/timestamp';

const root = process.env.VAULT ?? process.argv[2];
if (!root) {
  console.error('usage: VAULT="<VaultPath>" node tests/run.mjs tests/vault-scan.ts');
  process.exit(1);
}

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.name.endsWith('.md')) out.push(full);
  }
  return out;
}

const files = walk(root);
const rel = (p: string) => path.relative(root, p).split(path.sep).join('/');

for (const strictness of ['strict', 'normal', 'loose'] as const) {
  const settings: ScanSettings = { ...DEFAULT_SCAN_SETTINGS, strictness };
  const all: TimelineBlock[] = [];
  let withStamps = 0;
  let fromName = 0;

  for (const file of files) {
    const content = fs.readFileSync(file, 'utf8');
    const base = path.basename(file, '.md');
    const found = extractBlocks({ path: rel(file), basename: base, content }, settings);
    if (found.length) {
      withStamps += 1;
      fromName += found.filter((b) => b.fromFilename).length;
      all.push(...found);
    }
  }

  console.log(`\n================ strictness = ${strictness} ================`);
  console.log(`${all.length} blocks · ${withStamps}/${files.length} files · ${fromName} from file name`);

  const byFile = new Map<string, TimelineBlock[]>();
  for (const b of all) {
    const list = byFile.get(b.filePath) ?? [];
    list.push(b);
    byFile.set(b.filePath, list);
  }
  for (const [file, list] of [...byFile.entries()].sort()) {
    console.log(`\n  ${file}  (${list.length})`);
    for (const b of list.slice().sort((x, y) => x.stamp.date.getTime() - y.stamp.date.getTime())) {
      const when = `${formatDate(b.stamp.date, 'YYYY-MM-DD HH:mm', 'zh')}`;
      const preview = b.content.replace(/\s+/g, ' ').slice(0, 56);
      const tag = b.fromFilename ? ' [name]' : '';
      console.log(
        `    L${String(b.stamp.line + 1).padStart(4)}  ${when}  conf=${String(b.stamp.confidence).padStart(4)}${tag}  "${b.stamp.raw}"${b.stamp.label ? ` +${b.stamp.label}` : ''}`,
      );
      console.log(`          ↳ ${preview || '(empty)'}`);
    }
  }

  const missed = files.filter((f) => !byFile.has(rel(f)));
  console.log(`\n  files with no block: ${missed.length}`);
  for (const m of missed) console.log(`    - ${rel(m)}`);
}
