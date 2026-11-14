#!/usr/bin/env node
/**
 * エクスポートしたJSONを読み、取り込み時の件数・エラーをオフラインで確認します。
 * DBへの接続や保存は行わず、適用前の確認用に使います。
 */
import fs from 'node:fs';
import { importPreview } from '../cloudflare/core.mjs';
const [path, plan = 'free'] = process.argv.slice(2);
if (!path) {
  console.error('Usage: node scripts/preview-d1-import.mjs export.json [free|pro|enterprise]');
  process.exit(2);
}
try {
  const payload = JSON.parse(fs.readFileSync(path, 'utf8'));
  const result = importPreview(payload, {}, plan);
  const { state, ...report } = result;
  console.log(JSON.stringify(report, null, 2));
  if (!report.canApply) {
    process.exitCode = 1;
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
