import test from "node:test";
import assert from "node:assert/strict";
import { parseSourceDocument } from "../lib/parser.mjs";

const collectedAt = "2026-07-18T00:00:00.000Z";

test("Hobby Station official notice reads LivePocket and repairs obvious previous-year typo", () => {
  const source = {
    id: "hobby-station-official",
    name: "ホビーステーション",
    url: "https://www.hbst.net/?p=410187",
    type: "店舗",
    area: "全国",
    parser: "hobby-station-news",
    officialDomains: ["hbst.net", "livepocket.jp"],
    purchaseStartPolicy: "catalog-release",
  };
  const html = `
  <html><body>
    <h1>【2026.06.23】抽選販売「ポケモンカードゲームMEGA 拡張パック アビスアイ（再販）」</h1>
    <p>ポケモンカードゲームMEGA 拡張パック「アビスアイ」（再販）</p>
    <p>■応募方法：Livepocketを使用したWEB抽選を行います。</p>
    <p>抽選受付ページリンク：<a href="https://livepocket.jp/e/c9prw">https://livepocket.jp/e/c9prw</a></p>
    <p>■応募期間：2026年6月23日(火)12：00～6月25日(木)23：59まで</p>
    <p>■当選発表：2025年7月2日(木)</p>
    <p>■当選者購入期間：2026年7月6日(月)～7月12日(日)</p>
  </body></html>`;
  const items = parseSourceDocument(source, html, collectedAt);
  assert.equal(items.length, 1);
  assert.match(items[0].product, /アビスアイ/);
  assert.equal(items[0].url, "https://livepocket.jp/e/c9prw");
  assert.equal(items[0].applyEndDate, "2026-06-25");
  assert.equal(items[0].resultStartDate, "2026-07-02");
  assert.equal(items[0].purchaseStartDate, "2026-07-06");
});

test("Furuichi store QR LivePocket notice publishes one record per readable product", () => {
  const source = {
    id: "furuichi-official-news",
    name: "ふるいちパークプレイス大分店",
    url: "https://furu1.net/news/news_campaign/opensale_oita",
    type: "店舗",
    area: "大分県",
    parser: "furuichi-news",
    officialDomains: ["furu1.net"],
  };
  const html = `
  <html><body>
    <h1>ふるいちパークプレイス大分店 GRAND OPEN</h1>
    <h2>第1弾・LivePocket抽選販売</h2>
    <p>ポケモンカードゲーム MEGA 拡張パック メガブレイブ</p>
    <p>ポケモンカードゲーム MEGA スタートデッキ100 バトルコレクション</p>
    <p>抽選受付日時</p><p>2026.07.10 ～ 07.12</p>
    <p>店頭にてLivePocket抽選QR公開・受付</p>
    <p>当選発表</p><p>2026.07.14 発表予定</p>
    <p>当選商品販売時間</p><p>2026.07.17 ～ 07.19 営業終了まで</p>
  </body></html>`;
  const items = parseSourceDocument(source, html, collectedAt);
  assert.equal(items.length, 2);
  for (const item of items) {
    assert.equal(item.applyStartDate, "2026-07-10");
    assert.equal(item.applyEndDate, "2026-07-12");
    assert.equal(item.resultStartDate, "2026-07-14");
    assert.equal(item.purchaseStartDate, "2026-07-17");
    assert.equal(item.purchaseEndDate, "2026-07-19");
    assert.equal(item.destinationType, "store");
    assert.equal(item.noticeOnly, true);
    assert.match(item.instructions, /QRコード/);
  }
});
