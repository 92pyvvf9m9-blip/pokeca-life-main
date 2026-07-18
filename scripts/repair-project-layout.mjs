import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

const root = process.cwd();
const operations = [];
const conflicts = [];

const mappings = [
  ['geo-parser.test.mjs', 'collector/tests/geo-parser.test.mjs'],
  ['hobby-station-furuichi-parser.test.mjs', 'collector/tests/hobby-station-furuichi-parser.test.mjs'],
  ['official-x-notice.test.mjs', 'collector/tests/official-x-notice.test.mjs'],
  ['x-collector-official-accounts.test.mjs', 'collector/tests/x-collector-official-accounts.test.mjs'],
];

async function exists(relativePath) {
  try {
    await fs.access(path.join(root, relativePath));
    return true;
  } catch {
    return false;
  }
}

async function digest(relativePath) {
  const data = await fs.readFile(path.join(root, relativePath));
  return crypto.createHash('sha256').update(data).digest('hex');
}

async function removeExactDuplicate(source, target) {
  if (!(await exists(source))) return;
  if (!(await exists(target))) {
    await fs.mkdir(path.dirname(path.join(root, target)), { recursive: true });
    await fs.rename(path.join(root, source), path.join(root, target));
    operations.push({ action: 'move', source, target });
    return;
  }
  if ((await digest(source)) !== (await digest(target))) {
    conflicts.push({ source, target, reason: '内容が異なる' });
    return;
  }
  await fs.rm(path.join(root, source));
  operations.push({ action: 'remove-duplicate', source, target });
}

for (const [source, target] of mappings) {
  await removeExactDuplicate(source, target);
}

const entries = await fs.readdir(root, { withFileTypes: true });
for (const entry of entries) {
  if (!entry.isFile()) continue;
  if (!/^index(?:\s+\d+|\s*\(\d+\)|[-_]\d+)\.html$/i.test(entry.name)) continue;
  if (!(await exists('index.html'))) continue;
  if ((await digest(entry.name)) === (await digest('index.html'))) {
    await fs.rm(path.join(root, entry.name));
    operations.push({ action: 'remove-duplicate', source: entry.name, target: 'index.html' });
  } else {
    conflicts.push({ source: entry.name, target: 'index.html', reason: '内容が異なる' });
  }
}

const result = {
  version: 1,
  repairedAt: new Date().toISOString(),
  ok: conflicts.length === 0,
  operationCount: operations.length,
  operations,
  conflicts,
};

await fs.writeFile(path.join(root, 'project-layout-status.json'), `${JSON.stringify(result, null, 2)}\n`, 'utf8');

for (const operation of operations) {
  console.log(`${operation.action}: ${operation.source}${operation.target ? ` -> ${operation.target}` : ''}`);
}

if (conflicts.length) {
  for (const conflict of conflicts) {
    console.error(`::error file=${conflict.source}::${conflict.target} と内容が異なるため自動修復を停止しました`);
  }
  process.exit(1);
}

console.log(`Repository layout repair completed: ${operations.length} operation(s)`);
