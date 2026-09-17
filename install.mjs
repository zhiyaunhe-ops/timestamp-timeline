#!/usr/bin/env node
/**
 * Copy the built plugin into an Obsidian vault.
 *   node install.mjs "D:/path/to/MyVault"
 */
import fs from 'node:fs';
import path from 'node:path';

const ID = 'timestamp-timeline';
const ARTIFACTS = ['main.js', 'manifest.json', 'styles.css'];

const vault = process.argv[2];

if (!vault) {
  console.error('用法 / Usage:  node install.mjs "<VaultPath>"');
  process.exit(1);
}

if (!fs.existsSync(path.join(vault, '.obsidian'))) {
  console.error(`找不到 ${path.join(vault, '.obsidian')} —— 这个路径看起来不是 Obsidian 库根目录。`);
  console.error(`Not an Obsidian vault: ${vault}`);
  process.exit(1);
}

// Fail before touching the vault if the build is missing.
for (const file of ARTIFACTS) {
  if (!fs.existsSync(file)) {
    console.error(`缺少 ${file}，先运行:  npm run build`);
    process.exit(1);
  }
}

const target = path.join(vault, '.obsidian', 'plugins', ID);
fs.mkdirSync(target, { recursive: true });

for (const file of ARTIFACTS) {
  fs.copyFileSync(file, path.join(target, file));
  console.log(`  ✓ ${file}`);
}
console.log(`  → ${target}`);

console.log('\n在 Obsidian 里 / In Obsidian:');
console.log('  设置 → 第三方插件 → 刷新 → 启用插件');
console.log('  Settings → Community plugins → Reload → enable the plugin');
