import test from "node:test";
import assert from "node:assert/strict";
import { parseSourceDocument } from "../lib/parser.mjs";

test("LivePocket本文から店舗・商品・応募・結果・購入期限を取得する", () => {
  const html = `
    <html><head>
      <meta property="og:title" content="ポケモンカードゲームMEGA スターターセットex「ニャオハ＆マスカーニャex」 抽選販売のお知らせ">
    </head><body>
      <h1>ポケモンカードゲームMEGA スターターセットex「ニャオハ＆マスカーニャex」 抽選販売のお知らせ</h1>
      <p>フタバ図書TSUTAYA可部センター店（広島県）</p>
      <p>【応募期間】 7/18（土）〜7/26（日）</p>
      <p>【当選発表】 7/28（火）予定</p>
      <p>【購入期限】 8/2（日）営業時間終了まで</p>
    </body></html>
  `;
  const [item] = parseSourceDocument({
    id: "livepocket-public-pokeca",
    name: "LivePocket公開抽選",
    url: "https://livepocket.jp/e/m1ea7",
    parser: "livepocket",
    type: "店舗",
    area: "全国",
    officialDomains: ["livepocket.jp"],
    purchaseStartPolicy: "catalog-release",
    discoveryParentUrl: "https://imageflux.livepocket.jp/event/search",
  }, html, "2026-07-19T12:00:00+09:00");

  assert.ok(item);
  assert.equal(item.shop, "フタバ図書TSUTAYA可部センター店");
  assert.equal(item.area, "広島県");
  assert.match(item.product, /ニャオハ＆マスカーニャex/);
  assert.equal(item.applyStartDate, "2026-07-18");
  assert.equal(item.applyEndDate, "2026-07-26");
  assert.equal(item.resultStartDate, "2026-07-28");
  assert.equal(item.purchaseStartDate, "");
  assert.equal(item.purchaseEndDate, "2026-08-02");
  assert.match(item.memo, /営業時間終了まで/);
});

test("検索一覧ページ自体は抽選データとして公開しない", () => {
  const items = parseSourceDocument({
    id: "search",
    name: "LivePocket公開抽選",
    url: "https://imageflux.livepocket.jp/event/search?word=ポケモンカード",
    parser: "livepocket-search",
  }, "<a href='https://livepocket.jp/e/a'>ポケモンカード抽選</a>", "2026-07-19T12:00:00+09:00");
  assert.deepEqual(items, []);
});
