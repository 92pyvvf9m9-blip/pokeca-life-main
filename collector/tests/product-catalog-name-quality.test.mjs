import test from "node:test";
import assert from "node:assert/strict";
import {
  parseOfficialProductDocument,
  isPlausibleProductName,
} from "../lib/product-catalog-parser.mjs";
import { matchCatalogProduct } from "../lib/quality-gate.mjs";

const collectedAt = "2026-07-21T00:00:00.000Z";

test("official product parser does not append page descriptions to a product name", () => {
  const source = { id: "official-m6", name: "公式商品ページ", url: "https://www.pokemon-card.com/ex/m6/" };
  const html = `
  <html><body>
    <h1>ポケモンカードゲーム MEGA 拡張パック ストームエメラルダ</h1>
    <p>拡張パック ストームエメラルダ 特性 はしゃのほうこうは、手札からベンチに出したときに使えるぞ！</p>
    <p>発売日 2026年7月31日</p>
    <img src="https://www.pokemon-card.com/assets/product/package.png" alt="拡張パック ストームエメラルダ">
  </body></html>`;
  const items = parseOfficialProductDocument(source, html, collectedAt);
  assert.ok(items.some((item) => item.name === "拡張パック ストームエメラルダ"));
  assert.ok(items.every((item) => !/特性|はしゃのほうこう/.test(item.name)));
});

test("description-like catalog records are rejected and cannot beat canonical products", () => {
  const polluted = "拡張パック アビスアイ この特性を持つポケモンは、相手のワザや特性の効果を受けない！";
  assert.equal(isPlausibleProductName(polluted), false);
  const catalog = [
    { id: "bad", name: polluted, aliases: [polluted] },
    { id: "good", name: "拡張パック アビスアイ", aliases: ["アビスアイ"] },
  ];
  assert.equal(matchCatalogProduct(polluted, catalog)?.id, "good");
});

test("generic starter-set labels do not guess one of several products", () => {
  const catalog = [
    { id: "eevee", name: "スターターセットex イーブイex", aliases: ["イーブイex"] },
    { id: "zoroark", name: "スターターセットex ゾロア＆ゾロアークex", aliases: ["ゾロアークex"] },
  ];
  assert.equal(matchCatalogProduct("スターターセットex", catalog), null);
  assert.equal(matchCatalogProduct("スターターセットex3種", catalog), null);
});
