import test from 'node:test';
import assert from 'node:assert/strict';
import { expandCatalogGroupCandidates } from '../lib/product-group-expander.mjs';

test('expanded product members receive unique external IDs', () => {
  const catalog = [
    { id:'group', name:'スターターセットex 3種', category:'商品グループ', releaseDate:'2026-07-31' },
    { id:'evee', name:'スターターセットex イーブイex', category:'構築済みデッキ', releaseDate:'2026-07-31' },
    { id:'zoro', name:'スターターセットex ゾロア＆ゾロアークex', category:'構築済みデッキ', releaseDate:'2026-07-31' },
    { id:'nya', name:'スターターセットex ニャオハ＆マスカーニャex', category:'構築済みデッキ', releaseDate:'2026-07-31' },
  ];
  const result = expandCatalogGroupCandidates([{ externalId:'source-1', product:'スターターセットex 3種', expandCatalogGroup:true }], catalog);
  assert.equal(result.items.length, 3);
  assert.equal(new Set(result.items.map(x=>x.externalId)).size, 3);
  assert.ok(result.items.every(x=>x.externalId.startsWith('source-1::')));
});
