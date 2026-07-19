import test from 'node:test';
import assert from 'node:assert/strict';
import {
  canonicalGoogleFormUrl,
  parseGoogleFormFromText,
} from '../../pokeca-reader-worker.js';

test('GoogleフォームURLを追跡パラメータなしの正規URLへ統一する', () => {
  assert.equal(
    canonicalGoogleFormUrl('https://docs.google.com/forms/d/e/1FAIpQLExample123/viewform?usp=sharing&utm_source=x'),
    'https://docs.google.com/forms/d/e/1FAIpQLExample123/viewform',
  );
  assert.equal(
    canonicalGoogleFormUrl('https://forms.gle/AbCdEf123?utm_source=x'),
    'https://forms.gle/AbCdEf123',
  );
});

test('ブックオフのGoogleフォーム本文から商品・店舗・日程を取得する', () => {
  const text = `
ブックオフ フォレオ広島東店 抽選販売のお知らせ
対象商品
ストームエメラルダ
1BOX 6,000円
応募期間
2026年7月18日 10:00 ～ 7月28日 23:59
抽選結果
7月30日 当選者のみDMにて連絡
受取期間
7月31日 ～ 8月2日 営業時間内
店舗で購入可能な方のみ応募できます
`;
  const parsed = parseGoogleFormFromText(
    text,
    'https://docs.google.com/forms/d/e/1FAIpQLExample123/viewform',
    'ブックオフ フォレオ広島東店 抽選販売のお知らせ',
  );

  assert.equal(parsed.data.shop, 'ブックオフ フォレオ広島東店');
  assert.equal(parsed.data.product, 'ストームエメラルダ');
  assert.equal(parsed.data.applyStartDate, '2026-07-18');
  assert.equal(parsed.data.applyEndDate, '2026-07-28');
  assert.equal(parsed.data.resultStartDate, '2026-07-30');
  assert.equal(parsed.data.purchaseStartDate, '2026-07-31');
  assert.equal(parsed.data.purchaseEndDate, '2026-08-02');
  assert.equal(parsed.data.type, '店舗');
  assert.equal(parsed.data.area, '広島県');
  assert.deepEqual(parsed.missing, []);
});

test('受付終了Googleフォームを要確認にする', () => {
  const parsed = parseGoogleFormFromText(
    'カードショップ テスト店\n対象商品 ポケモンカードゲーム 拡張パック テスト\n応募締切 2026/7/20\nこのフォームは回答の受け付けを終了しました。',
    'https://docs.google.com/forms/d/e/1FAIpQLClosed/viewform',
    'カードショップ テスト店 ポケモンカード抽選',
  );
  assert.equal(parsed.data.status, 'closed');
  assert.equal(parsed.reviewRequired, true);
  assert.match(parsed.warnings.join('\n'), /受付を終了/);
});

test('Worker APIがforms.gle短縮URLを展開してGoogleフォームを返す', async () => {
  const worker = (await import('../../pokeca-reader-worker.js')).default;
  const originalFetch = globalThis.fetch;
  const html = `<!doctype html><html><head>
    <meta property="og:title" content="ブックオフ フォレオ広島東店 抽選販売のお知らせ">
  </head><body>
    <div>対象商品</div><div>ストームエメラルダ</div><div>1BOX 6,000円</div>
    <div>応募期間 2026/7/18 10:00 ～ 7/28 23:59</div>
    <div>抽選結果 7/30 当選者のみDM</div>
    <div>受取期間 7/31 ～ 8/2</div>
    <div>ブックオフ フォレオ広島東店</div>
  </body></html>`;
  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    url: 'https://docs.google.com/forms/d/e/1FAIpQLExample123/viewform?usp=sharing',
    headers: new Headers({ 'content-type': 'text/html; charset=utf-8' }),
    text: async () => html,
  });
  try {
    const request = new Request('https://reader.example/read', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url: 'https://forms.gle/AbCdEf123' }),
    });
    const response = await worker.fetch(request, {});
    const payload = await response.json();
    assert.equal(response.status, 200);
    assert.equal(payload.ok, true);
    assert.equal(payload.source, 'google-form-server');
    assert.equal(payload.requestedUrl, 'https://forms.gle/AbCdEf123');
    assert.equal(payload.canonicalUrl, 'https://docs.google.com/forms/d/e/1FAIpQLExample123/viewform');
    assert.equal(payload.identity.recordKey, 'url:https://docs.google.com/forms/d/e/1FAIpQLExample123/viewform');
    assert.equal(payload.data.product, 'ストームエメラルダ');
  } finally {
    globalThis.fetch = originalFetch;
  }
});
