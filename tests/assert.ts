/**
 * Shared assertion helpers for the split test entries.
 */

let passed = 0;
let failed = 0;

export function check(name: string, condition: boolean, detail = ''): void {
  if (condition) {
    passed += 1;
    console.log(`  PASS  ${name}`);
  } else {
    failed += 1;
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

export function eq(name: string, actual: unknown, expected: unknown): void {
  check(name, actual === expected, `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

/**
 * Report and exit with the right status. `run.mjs` gives every suite its own
 * process, so exiting here is safe and also kills any leftover handles (the AI
 * suite's HTTP server) instead of hanging the run.
 */
export function finish(): void {
  console.log(`\n${failed === 0 ? 'ALL GREEN' : 'FAILURES'} — ${passed} passed, ${failed} failed\n`);
  process.exit(failed === 0 ? 0 : 1);
}
