/**
 * 自作JavaScriptの構文を、配置に依存せず再帰的に検査します。
 * JSXの規則はESLintで確認し、第三者ライブラリーと生成物はこの検査の対象から除外します。
 */
import { readdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const excluded = new Set(['node_modules', '.build', 'dist', 'static', 'target']);
let count = 0;

async function check(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory() && !excluded.has(entry.name)) {
      await check(file);
    } else if (entry.isFile() && /\.(?:js|mjs|cjs)$/.test(entry.name)) {
      const result = spawnSync(process.execPath, ['--check', file], { stdio: 'inherit' });
      if (result.error) {
        throw result.error;
      }
      if (result.status !== 0) {
        process.exit(result.status || 1);
      }
      count++;
    }
  }
}

for (const directory of [
  'frontend',
  'shared',
  'cloudflare',
  'connectors',
  'legacy',
  'scripts',
  'tests',
]) {
  await check(path.join(root, directory));
}
console.log('JavaScript ' + count + 'ファイルの構文を確認しました。');
