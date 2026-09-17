#!/usr/bin/env node
/**
 * Bundle a test entry with esbuild (aliasing `obsidian` to a local stub) and run it.
 *
 *   node tests/run.mjs                        → tests/smoke.ts
 *   node tests/run.mjs tests/vault-scan.ts    → scan a real vault
 *
 * The stub is what makes this work headlessly: at runtime a plugin only touches a
 * handful of value imports from `obsidian`, and everything else is types.
 */
import esbuild from 'esbuild';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const stub = path.join(here, 'obsidian-stub.ts');

const entry = process.argv[2] ?? 'tests/smoke.ts';
const abs = path.resolve(entry);
const out = path.join(here, `_${path.basename(entry, '.ts')}.mjs`);

await esbuild.build({
  entryPoints: [abs],
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  outfile: out,
  alias: { obsidian: stub },
  logLevel: 'warning',
});

// A child process keeps the test's process.exit() from tearing down this runner,
// and reaps anything the suite left open (e.g. a mock HTTP server).
const run = spawnSync(process.execPath, [out], { stdio: 'inherit' });
process.exit(run.status ?? 1);
