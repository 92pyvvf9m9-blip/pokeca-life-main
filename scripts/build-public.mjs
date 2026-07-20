import fs from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const dist = path.join(root, 'dist');

async function readJson(file, fallback = {}) {
  try { return JSON.parse(await fs.readFile(path.join(root, file), 'utf8')); }
  catch { return fallback; }
}

async function writeJson(file, value) {
  const target = path.join(dist, file);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function omit(object, keys) {
  const output = { ...object };
  for (const key of keys) delete output[key];
  return output;
}

function publicLottery(item = {}) {
  return omit(item, [
    'sourceUrl', 'sourceType', 'sourceKind', 'sourceKinds', 'intelligenceSource',
    'privateSources', 'evidenceCount', 'destinationHost', 'destinationVerified',
    'destinationVerificationReason', 'verificationChecks', 'rawApplyText',
    'rawResultText', 'xAuthor', 'xPostId'
  ]);
}

function normalizedHost(value = '') {
  try { return new URL(value).hostname.toLowerCase().replace(/^www\./, ''); }
  catch { return ''; }
}

function isBlockedDestination(item, blockedDomains) {
  const host = normalizedHost(item?.url || '');
  return Boolean(host && blockedDomains.some((domain) => host === domain || host.endsWith(`.${domain}`)));
}

function publicStore(store = {}) {
  return omit(store, ['sourceUrl', 'sourceName', 'verificationStatus']);
}

function publicProduct(product = {}) {
  return omit(product, [
    'source', 'sourceUrl', 'imageSource', 'imageSourceUrl', 'imageSourceType',
    'sourceFingerprint', 'imageInfo', 'lastSeenAt', 'discoveredAt'
  ]);
}

await fs.rm(dist, { recursive: true, force: true });
await fs.mkdir(dist, { recursive: true });

const privateRegistry = await readJson('.private/sources.json', { blockedDestinationDomains: [] });
const blockedDestinationDomains = (privateRegistry.blockedDestinationDomains || [])
  .map((value) => String(value || '').toLowerCase().replace(/^www\./, ''))
  .filter(Boolean);

for (const file of ['index.html', 'ocr-import-core.js', 'app-destination-core.js', 'lottery-identity-core.js']) {
  const source = path.join(root, file);
  try { await fs.copyFile(source, path.join(dist, file)); }
  catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
}
await fs.cp(path.join(root, 'assets'), path.join(dist, 'assets'), { recursive: true });

const feed = await readJson('lottery-feed.json', { version: 1, lotteries: [] });
const feedMeta = omit(feed.meta || {}, ['sourceResults', 'x', 'sourceCount', 'successCount', 'failedCount']);
await writeJson('lottery-feed.json', {
  version: feed.version || 1,
  updatedAt: feed.updatedAt || new Date().toISOString(),
  meta: feedMeta,
  lotteries: (feed.lotteries || []).filter((item) => !isBlockedDestination(item, blockedDestinationDomains)).map(publicLottery),
});

const status = await readJson('collector-status.json', {});
await writeJson('collector-status.json', omit(status, ['sourceResults', 'x', 'sourceCount', 'successCount', 'failedCount']));
await writeJson('data-quality-status.json', await readJson('data-quality-status.json', {}));

const stores = await readJson('store-master.json', { version: 1, stores: [] });
const coverage = Object.fromEntries(Object.entries(stores.coverage || {}).map(([key, value]) => [key, omit(value, ['sourceName'])]));
await writeJson('store-master.json', {
  ...omit(stores, ['sourceName']),
  coverage,
  stores: (stores.stores || []).map(publicStore),
});

const catalog = await readJson('product-catalog.json', { version: 1, products: [] });
const automation = omit(catalog.automation || {}, ['sourceIds']);
await writeJson('product-catalog.json', {
  ...omit(catalog, ['sourceName']),
  automation,
  products: (catalog.products || []).map(publicProduct),
});

const catalogStatus = await readJson('product-catalog-status.json', {});
await writeJson('product-catalog-status.json', omit(catalogStatus, ['sourceResults', 'sourceCount', 'successCount', 'failedCount']));

console.log('Public deployment built without private provenance fields.');
