import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSourceDocument } from '../lib/parser.mjs';

test('collectorがGoogleフォームを正式な抽選ソースとして解析する', () => {
  const html = `<!doctype html><html><head>
    <meta property="og:title" content="ブックオフ フォレオ広島東店 抽選販売のお知らせ">
    <title>ブックオフ フォレオ広島東店 抽選販売のお知らせ - Google Forms</title>
  </head><body>
    <h1>抽選販売のお知らせ</h1>
    <div>対象商品</div><div>ストームエメラルダ</div>
    <div>1BOX 6,000円</div>
    <div>応募期間 2026/7/18 10:00 ～ 7/28 23:59</div>
    <div>抽選結果 7/30 当選者のみDMにて連絡</div>
    <div>受取期間 7/31 ～ 8/2 営業時間内</div>
    <div>ブックオフ フォレオ広島東店</div>
  </body></html>`;
  const [item] = parseSourceDocument({
    id: 'google-form-example',
    name: 'Googleフォーム',
    url: 'https://docs.google.com/forms/d/e/1FAIpQLExample123/viewform',
    parser: 'google-form',
    type: '店舗',
    area: '広島県',
    publicSourceType: 'Googleフォーム',
  }, html, '2026-07-19T10:00:00+09:00');

  assert.ok(item);
  assert.equal(item.shop, 'ブックオフ フォレオ広島東店');
  assert.equal(item.product, 'ストームエメラルダ');
  assert.equal(item.applyEndDate, '2026-07-28');
  assert.equal(item.resultStartDate, '2026-07-30');
  assert.equal(item.purchaseEndDate, '2026-08-02');
  assert.equal(item.sourceType, 'Googleフォーム');
  assert.equal(item.destinationType, 'direct');
});
