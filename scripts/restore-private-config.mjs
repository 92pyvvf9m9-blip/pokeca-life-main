import fs from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const encoded = String(process.env.POKECA_COLLECTOR_CONFIG_B64 || '').trim();
if (!encoded) {
  throw new Error('POKECA_COLLECTOR_CONFIG_B64 secret is not configured');
}

let bundle;
try {
  bundle = JSON.parse(Buffer.from(encoded, 'base64').toString('utf8'));
} catch (error) {
  throw new Error(`Invalid POKECA_COLLECTOR_CONFIG_B64: ${error.message}`);
}

const required = ['sources', 'xSources', 'productSources'];
for (const key of required) {
  if (!bundle[key] || typeof bundle[key] !== 'object') {
    throw new Error(`Private config is missing: ${key}`);
  }
}

const dir = path.join(root, '.private');
await fs.mkdir(dir, { recursive: true });
await Promise.all([
  fs.writeFile(path.join(dir, 'sources.json'), `${JSON.stringify(bundle.sources, null, 2)}\n`),
  fs.writeFile(path.join(dir, 'x-sources.json'), `${JSON.stringify(bundle.xSources, null, 2)}\n`),
  fs.writeFile(path.join(dir, 'product-sources.json'), `${JSON.stringify(bundle.productSources, null, 2)}\n`),
]);

console.log('Private collector configuration restored.');
