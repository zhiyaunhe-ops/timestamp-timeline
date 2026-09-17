#!/usr/bin/env node
/**
 * Build, tag and publish a GitHub release in one step.
 *
 *   node release.mjs            → release the version currently in manifest.json
 *   node release.mjs 1.2.1      → bump manifest.json/package.json/versions.json, then release
 *
 * The release carries main.js, manifest.json and styles.css, which is what both a
 * manual install and BRAT download. Auth reuses the token already in Git Credential
 * Manager — no `gh auth login` needed.
 *
 * This exists instead of a GitHub Actions workflow because pushing a workflow file
 * requires the `workflow` token scope, which a plain `repo` token does not have.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';

const ARTIFACTS = ['main.js', 'manifest.json', 'styles.css'];
const GH = 'C:/Program Files/GitHub CLI/gh.exe';

const bump = process.argv[2];
if (bump) {
  const manifest = JSON.parse(fs.readFileSync('manifest.json', 'utf8'));
  manifest.version = bump;
  fs.writeFileSync('manifest.json', JSON.stringify(manifest, null, 2) + '\n');
  fs.copyFileSync('manifest.json', 'src/manifest.json');

  const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
  pkg.version = bump;
  fs.writeFileSync('package.json', JSON.stringify(pkg, null, 2) + '\n');

  fs.writeFileSync(
    'versions.json',
    JSON.stringify({ ...JSON.parse(fs.readFileSync('versions.json', 'utf8')), [bump]: manifest.minAppVersion }, null, 2) + '\n',
  );
  console.log(`version bumped to ${bump}`);
}

const version = JSON.parse(fs.readFileSync('manifest.json', 'utf8')).version;
const tag = version;

function sh(cmd, args, opts = {}) {
  console.log(`$ ${cmd} ${args.join(' ')}`);
  return execFileSync(cmd, args, { stdio: 'inherit', ...opts });
}

/** Run a script from node_modules/.bin without relying on PATH or npx. */
function bin(name, args) {
  const js = name === 'tsc' ? 'node_modules/typescript/bin/tsc' : `node_modules/${name}/bin/${name}`;
  return sh(process.execPath, [js, ...args]);
}

// --- checks -----------------------------------------------------------------
const status = execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim();
if (status) {
  console.error('工作区不干净，先提交 / working tree is dirty, commit first:\n' + status);
  process.exit(1);
}
const existing = spawnSync('git', ['tag', '--list', tag], { encoding: 'utf8' }).stdout.trim();
if (existing) {
  console.error(`tag ${tag} 已存在 / already exists`);
  process.exit(1);
}

// --- build ------------------------------------------------------------------
console.log('\n== typecheck ==');
bin('tsc', ['--noEmit']);
console.log('\n== test ==');
sh(process.execPath, ['tests/run.mjs']);
console.log('\n== build ==');
sh(process.execPath, ['esbuild.config.mjs', 'production']);

for (const file of ARTIFACTS) {
  if (!fs.existsSync(file)) {
    console.error(`缺少 ${file} / missing after build`);
    process.exit(1);
  }
}

// --- publish ----------------------------------------------------------------
console.log('\n== tag + push ==');
sh('git', ['add', 'main.js', 'manifest.json', 'styles.css', 'versions.json', 'package.json']);
const staged = execFileSync('git', ['diff', '--cached', '--name-only'], { encoding: 'utf8' }).trim();
if (staged) {
  sh('git', ['commit', '-m', `chore(release): ${tag}`]);
}
sh('git', ['tag', tag]);
sh('git', ['push', 'origin', 'HEAD', '--follow-tags']);

console.log('\n== github release ==');
const cred = spawnSync('git', ['credential', 'fill'], {
  input: 'protocol=https\nhost=github.com\n\n',
  encoding: 'utf8',
});
const token = (cred.stdout.match(/^password=(.*)$/m) || [])[1];
if (!token) {
  console.error('拿不到 GitHub token / could not read a token from Git Credential Manager');
  process.exit(1);
}

sh(GH, ['release', 'create', tag, '--title', tag, '--generate-notes', ...ARTIFACTS], {
  env: { ...process.env, GH_TOKEN: token },
});

console.log(`\n完成 / done → https://github.com/zhiyaunhe-ops/timestamp-timeline/releases/tag/${tag}`);
