import test from "node:test";
import assert from "node:assert/strict";
import { expandCatalogGroupCandidates } from "../lib/product-group-expander.mjs";

const catalog = [
  { id: "group", name: "スターターセットex 3種", category: "商品グループ", releaseDate: "2026-07-31", aliases: ["スターターセットex"] },
  { id: "eevee", name: "スターターセットex イーブイex", category: "構築デッキ", releaseDate: "2026-07-31", aliases: ["イーブイex"] },
  { id: "zoroark", name: "スターターセットex ゾロア＆ゾロアークex", category: "構築デッキ", releaseDate: "2026-07-31", aliases: ["ゾロアークex"] },
  { id: "meowscarada", name: "スターターセットex ニャオハ＆マスカーニャex", category: "構築デッキ", releaseDate: "2026-07-31", aliases: ["マスカーニャex"] },
  { id: "pack", name: "拡張パック ストームエメラルダ", category: "拡張パック", releaseDate: "2026-07-31", aliases: ["ストームエメラルダ"] },
];

test("explicit three-product catalog groups expand into three independent lotteries", () => {
  const result = expandCatalogGroupCandidates([{
    shop: "古本市場（ふるいち）",
    product: "スターターセットex 3種",
    expandCatalogGroup: true,
    applyEndDate: "2026-07-19",
  }], catalog);
  assert.equal(result.expandedCount, 3);
  assert.deepEqual(result.items.map(item => item.product), [
    "スターターセットex イーブイex",
    "スターターセットex ゾロア＆ゾロアークex",
    "スターターセットex ニャオハ＆マスカーニャex",
  ]);
});
