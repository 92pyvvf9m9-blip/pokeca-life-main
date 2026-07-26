import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('manual lottery save defines canonicalInputUrl before use', () => {
  const html = fs.readFileSync(new URL('../../index.html', import.meta.url), 'utf8');
  const definition = html.indexOf("const canonicalInputUrl=canonicalLotteryStateUrl(o.url||'')||o.url||'';");
  const firstUse = html.indexOf('externalId:canonicalInputUrl');
  assert.notEqual(definition, -1, 'canonicalInputUrl definition is missing');
  assert.notEqual(firstUse, -1, 'canonicalInputUrl use is missing');
  assert.ok(definition < firstUse, 'canonicalInputUrl must be defined before it is used');
});
