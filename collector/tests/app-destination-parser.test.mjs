import test from 'node:test';
import assert from 'node:assert/strict';
import { enrichAppDestination } from '../lib/app-destination.mjs';

test('ゲオのアプリ抽選告知をアプリ応募として分類する', () => {
  const item = enrichAppDestination({ shop: 'ゲオ 広島店', product: 'ストームエメラルダ', url: 'https://geo-online.co.jp/' }, 'ゲオアプリから抽選に応募してください');
  assert.equal(item.destinationType, 'app');
  assert.equal(item.appId, 'geo');
  assert.equal(item.appName, 'ゲオアプリ');
  assert.match(item.iosAppStoreUrl, /id590190880$/);
});

test('アプリ記載のないゲオ公式Web抽選は勝手にアプリ化しない', () => {
  const original = { shop: 'ゲオ 広島店', destinationType: 'direct', url: 'https://geo-online.co.jp/campaign/' };
  const item = enrichAppDestination(original, '公式Webサイトの応募フォームから応募');
  assert.equal(item.destinationType, 'direct');
  assert.equal(item.appId, undefined);
});

test('ふるいちのLIFF URLをLINEミニアプリ起動先として保持する', () => {
  const item = enrichAppDestination({ shop: 'ふるいち', url: 'https://liff.line.me/abc' }, 'ふるいちアプリから抽選応募');
  assert.equal(item.destinationType, 'app');
  assert.equal(item.appUrl, 'https://liff.line.me/abc');
});

test('未知の店舗でもアプリ応募の明記があれば汎用アプリ応募として保持する', () => {
  const item = enrichAppDestination({ shop: '地域カードショップ', url: 'https://example.com/notice' }, '専用アプリから抽選に応募してください');
  assert.equal(item.destinationType, 'app');
  assert.equal(item.appName, '応募アプリ');
  assert.equal(item.url, 'https://example.com/notice');
});
