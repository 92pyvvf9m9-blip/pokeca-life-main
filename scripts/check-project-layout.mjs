import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

const root = process.cwd();
const strict = process.argv.includes('--strict');
const statusPath = path.join(root, 'project-layout-status.json');

const requiredFiles = [
  'index.html',
  'package.json',
  'collector/collector.mjs',
  'collector/lib/parser.mjs',
  'collector/tests/geo-parser.test.mjs',
  '.github/workflows/collect-lotteries.yml',
  '.github/workflows/deploy-pages.yml',
];

const misplacedMappings = new Map([
  ['geo-parser.test.mjs', 'collector/tests/geo-parser.test.mjs'],
  ['hobby-station-furuichi-parser.test.mjs', 'collector/tests/hobby-station-furuichi-parser.test.mjs'],
  ['official-x-notice.test.mjs', 'collector/tests/official-x-notice.test.mjs'],
  ['x-collector-official-accounts.test.mjs', 'collector/tests/x-collector-official-accounts.test.mjs'],
]);

async function exists(relativePath) {
  try {
    await fs.access(path.join(root, relativePath));
    return true;
  } catch {
    return false;
  }
}

async function sha256(relativePath) {
  const data = await fs.readFile(path.join(root, relativePath));
  return crypto.createHash('sha256').update(data).digest('hex');
}

async function rootFiles() {
  const entries = await fs.readdir(root, { withFileTypes: true });
  return entries.filter((entry) => entry.isFile()).map((entry) => entry.name);
}

function annotation(level, file, message) {
  const safe = String(message).replace(/\r?\n/g, ' ');
  console.log(`::${level} file=${file}::${safe}`);
}

const missing = [];
const warnings = [];
const errors = [];
const safeCleanup = [];

for (const file of requiredFiles) {
  if (!(await exists(file))) {
    missing.push(file);
    errors.push(`必須ファイルがありません: ${file}`);
    annotation('error', file, '必須ファイルがありません');
  }
}

const files = await rootFiles();
for (const file of files) {
  if (/^index(?:\s+\d+|\s*\(\d+\)|[-_]\d+)\.html$/i.test(file)) {
    if (await exists('index.html')) {
      const identical = (await sha256(file)) === (await sha256('index.html'));
      if (identical) {
        safeCleanup.push(file);
        warnings.push(`index.htmlと同一の余分なコピー: ${file}`);
        annotation('warning', file, 'index.htmlと同一の余分なコピーです。修復ワークフローで安全に削除できます');
      } else {
        errors.push(`内容が異なるindexコピーを検出: ${file}`);
        annotation('error', file, 'index.htmlと内容が異なるため自動削除できません');
      }
    }
  }

  const expected = misplacedMappings.get(file);
  if (!expected) continue;
  if (!(await exists(expected))) {
    errors.push(`テストファイルの配置が違います: ${file} → ${expected}`);
    annotation('error', file, `正しい場所は ${expected} です`);
    continue;
  }
  const identical = (await sha256(file)) === (await sha256(expected));
  if (identical) {
    safeCleanup.push(file);
    warnings.push(`正しい場所にも同一ファイルがあるためルート側は不要: ${file}`);
    annotation('warning', file, `同一ファイルが ${expected} にあります。修復ワークフローで安全に削除できます`);
  } else {
    errors.push(`ルート側と正規配置側の内容が異なります: ${file}`);
    annotation('error', file, `${expected} と内容が異なるため確認が必要です`);
  }
}

const status = {
  version: 1,
  checkedAt: new Date().toISOString(),
  ok: errors.length === 0,
  strict,
  requiredFileCount: requiredFiles.length,
  missing,
  warningCount: warnings.length,
  errorCount: errors.length,
  safeCleanup: [...new Set(safeCleanup)].sort(),
  warnings,
  errors,
};

await fs.writeFile(statusPath, `${JSON.stringify(status, null, 2)}\n`, 'utf8');

if (errors.length) {
  console.error(`Project layout check failed: ${errors.length} error(s), ${warnings.length} warning(s)`);
  process.exit(1);
}

if (strict && warnings.length) {
  console.error(`Project layout strict check failed: ${warnings.length} warning(s)`);
  process.exit(1);
}

console.log(`Project layout check passed: ${warnings.length} warning(s)`);
