import fs from 'node:fs/promises';

const files = [
  'lottery-feed.json',
  'collector-status.json',
  'product-catalog.json',
  'product-image-audit.json',
  'product-catalog-status.json',
  'index.html',
];
const forbiddenKeys = [
  'sourceUrl', 'sourceType', 'sourceKind', 'sourceKinds', 'intelligenceSource',
  'privateSources', 'destinationVerificationReason', 'sourceResults'
];

async function readJson(file, fallback = {}) {
  try { return JSON.parse(await fs.readFile(file, 'utf8')); }
  catch { return fallback; }
}

function normalizedHost(value = '') {
  try { return new URL(value).hostname.toLowerCase().replace(/^www\./, ''); }
  catch { return ''; }
}

const registry = await readJson('.private/sources.json', { blockedDestinationDomains: [] });
const blockedDomains = (registry.blockedDestinationDomains || [])
  .map((value) => String(value || '').toLowerCase().replace(/^www\./, ''))
  .filter(Boolean);

const failures = [];
for (const file of files) {
  let text = '';
  try { text = await fs.readFile(file, 'utf8'); } catch { continue; }
  for (const key of forbiddenKeys) {
    if (text.includes(`"${key}"`)) failures.push(`${file}: private field ${key}`);
  }
}

const feed = await readJson('lottery-feed.json', { lotteries: [] });
for (const [index, item] of (feed.lotteries || []).entries()) {
  const host = normalizedHost(item?.url || '');
  const blocked = host && blockedDomains.some((domain) => host === domain || host.endsWith(`.${domain}`));
  if (blocked) failures.push(`lottery-feed.json: non-direct destination at item ${index + 1}`);
}

if (failures.length) {
  console.error('Private provenance or non-direct destinations detected in public files:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}
console.log('Public privacy check passed.');
