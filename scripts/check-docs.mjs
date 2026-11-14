/** MarkdownとHTML画像のローカル参照先を検証します。外部サイトへは通信しません。 */
import { access, readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const excluded = new Set([
  'node_modules',
  'public',
  'vendor',
  '.git',
  '.runtime',
  '.deploy',
  '.wrangler',
  '.build',
  'target',
]);
const failures = [];
let checked = 0;

async function checkFile(file) {
  const text = await readFile(file, 'utf8');
  const links = [
    ...[...text.matchAll(/\]\(([^\s)]+)(?:\s+"[^"]*")?\)/g)].map((match) => match[1]),
    ...[...text.matchAll(/<img\b[^>]*\bsrc="([^"]+)"/g)].map((match) => match[1]),
  ];
  for (const link of links) {
    if (/^(?:https?:|mailto:|data:|#)/.test(link)) {
      continue;
    }
    const target = decodeURIComponent(link.split('#')[0].replace(/^<|>$/g, ''));
    if (!target) {
      continue;
    }
    checked++;
    try {
      await access(path.resolve(path.dirname(file), target));
    } catch {
      failures.push(path.relative(root, file) + ': ' + link);
    }
  }
}

async function walk(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (excluded.has(entry.name)) {
      continue;
    }
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      await walk(fullPath);
    } else if (entry.name.endsWith('.md')) {
      await checkFile(fullPath);
    }
  }
}

await walk(root);
if (failures.length) {
  console.error('参照先が見つかりません:\n' + failures.join('\n'));
  process.exitCode = 1;
} else {
  console.log('ドキュメントのローカル参照 ' + checked + '件を確認しました。');
}
