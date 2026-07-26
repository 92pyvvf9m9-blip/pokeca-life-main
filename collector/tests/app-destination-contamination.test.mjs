import test from 'node:test';
import assert from 'node:assert/strict';
import { enrichAppDestination, normalizeAppDestinationFields } from '../lib/app-destination.mjs';

test('unrelated Google Form is not converted to GEO by page-wide evidence', () => {
  const item = { shop: 'ヤマシロヤ', product: 'スターターセットex イーブイex', destinationType: 'direct', url: 'https://docs.google.com/forms/d/e/example/viewform' };
  const out = enrichAppDestination(item, '別の欄にはゲオアプリから応募と書かれている');
  assert.equal(out.destinationType, 'direct');
  assert.equal(out.appId || '', '');
});

test('historical GEO contamination is removed from unrelated shop record', () => {
  const item = { shop: '全国のポケモンセンター', product: 'スターターセットex イーブイex', destinationType: 'app', appId: 'geo', appName: 'ゲオアプリ', instructions: 'ゲオアプリ内の抽選案内から応募してください。', fallbackUrl: 'https://geo-online.co.jp/', url: 'https://shop.pokemon.co.jp/ja/shop/common/news/example.html' };
  const out = normalizeAppDestinationFields(item);
  assert.equal(out.destinationType, 'direct');
  assert.equal(out.appId, '');
  assert.equal(out.appName, '');
  assert.equal(out.fallbackUrl, item.url);
});

test('Kojima app record resolves to Kojima and never GEO', () => {
  const item = { shop: 'コジマ（アプリ）', product: 'スターターセットex イーブイex', destinationType: 'app', appId: 'geo', appName: 'ゲオアプリ', url: 'https://www.kojima.net/shop/app/kojima_appli.html' };
  const out = enrichAppDestination(item, 'アプリ内から応募してください');
  assert.equal(out.destinationType, 'app');
  assert.equal(out.appId, 'kojima');
  assert.equal(out.appName, 'コジマアプリ');
});
