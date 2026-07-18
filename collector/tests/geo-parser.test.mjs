import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSourceDocument } from '../lib/parser.mjs';
import { discoverCandidateLinks } from '../lib/discovery.mjs';

const source = {
  id: 'geo-pokemon-card-lottery',
  name: 'ゲオ',
  url: 'https://geo-online.co.jp/news/770',
  type: '店舗',
  area: '全国',
  sourceType: '公式サイト',
  parser: 'geo-lottery',
  officialDomains: ['geo-online.co.jp', 'draw.geo-online.co.jp'],
  keywords: ['ポケモンカード', '抽選'],
};

const newProductsHtml = `
<!doctype html><html><body>
<h1>7月31日(金)発売「ポケモンカードゲーム MEGA 拡張パック ストームエメラルダ」「ポケモンカードゲーム MEGA スターターセットex 3種」抽選販売について</h1>
<p>7月31日(金)発売「ポケモンカードゲーム MEGA 拡張パック ストームエメラルダ」「ポケモンカードゲーム MEGA スターターセットex （イーブイex／ ゾロア＆ゾロアークex／ニャオハ＆マスカーニャex」の発売日当日分につきましてゲオグループでは抽選販売のみとさせていただきます。</p>
<p>応募期間は「7/13(月) 11:00 ～ 7/16(木) 17:59」までとなります。</p>
<a href="https://draw.geo-online.co.jp/lottery/">ゲオ抽選販売専用サイトはこちら</a>
</body></html>`;

test('GEO official notice is split into four product lotteries', () => {
  const items = parseSourceDocument(source, newProductsHtml, '2026-07-18T00:00:00.000Z');
  assert.equal(items.length, 4);
  assert.deepEqual(items.map((item) => item.product).sort(), [
    'ポケモンカードゲーム MEGA スターターセットex イーブイex',
    'ポケモンカードゲーム MEGA スターターセットex ゾロア＆ゾロアークex',
    'ポケモンカードゲーム MEGA スターターセットex ニャオハ＆マスカーニャex',
    'ポケモンカードゲーム MEGA 拡張パック ストームエメラルダ',
  ].sort());
  for (const item of items) {
    assert.equal(item.shop, 'ゲオ');
    assert.equal(item.applyStartDate, '2026-07-13');
    assert.equal(item.applyStartTime, '11:00');
    assert.equal(item.applyEndDate, '2026-07-16');
    assert.equal(item.applyEndTime, '17:59');
    assert.equal(item.purchaseStartDate, '2026-07-31');
    assert.equal(item.url, 'https://draw.geo-online.co.jp/lottery/');
    assert.equal(item.collectionMode, 'official-news-multi-product');
  }
});

test('GEO resale notice remains one product and does not invent purchase start', () => {
  const html = `
  <html><body>
  <h1>「ポケモンカードゲーム MEGA スタートデッキ１００バトルコレクション」抽選販売について</h1>
  <p>「ポケモンカードゲーム MEGA スタートデッキ１００バトルコレクション」の再販売分については抽選販売のみとします。</p>
  <p>応募期間は「7/13(月) 11:00 ～ 7/16(木) 17:59」までです。</p>
  <a href="https://draw.geo-online.co.jp/lottery/">ゲオ抽選販売専用サイトはこちら</a>
  </body></html>`;
  const items = parseSourceDocument({ ...source, url: 'https://geo-online.co.jp/news/771' }, html, '2026-07-18T00:00:00.000Z');
  assert.equal(items.length, 1);
  assert.equal(items[0].product, 'ポケモンカードゲーム MEGA スタートデッキ100バトルコレクション');
  assert.equal(items[0].purchaseStartDate, '');
  assert.match(items[0].memo, /再販抽選/);
});

test('GEO news index discovers Pokémon card lottery notices only', () => {
  const indexSource = {
    ...source,
    url: 'https://geo-online.co.jp/news/',
    discovery: {
      enabled: true,
      includePatterns: ['ポケモンカード', '抽選販売'],
      excludePatterns: ['よくある質問'],
      sameHostOnly: true,
      maxPages: 8,
    },
  };
  const html = `
  <a href="/news/770">7月31日発売 ポケモンカードゲーム 抽選販売について</a>
  <a href="/news/771">ポケモンカードゲーム スタートデッキ100 抽選販売について</a>
  <a href="/news/faq">抽選販売 よくある質問</a>
  <a href="https://example.com/pokemon">ポケモンカード 抽選販売</a>`;
  const links = discoverCandidateLinks(indexSource, html);
  assert.deepEqual(links.map((item) => item.url), [
    'https://geo-online.co.jp/news/770',
    'https://geo-online.co.jp/news/771',
  ]);
});
