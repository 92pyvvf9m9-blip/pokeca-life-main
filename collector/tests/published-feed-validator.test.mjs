import test from "node:test";
import assert from "node:assert/strict";
import { looksDescriptionLikeProductName, validatePublishedLotteries } from "../lib/published-feed-validator.mjs";

const catalog = [
  { id: "group", name: "スターターセットex 3種", category: "商品グループ", releaseDate: "2026-07-31", aliases: ["スターターセットex3種"] },
  { id: "storm", name: "拡張パック ストームエメラルダ", category: "拡張パック", aliases: ["ストームエメラルダ"] },
];

test("description-like product names fail the final public feed gate", () => {
  const product = "拡張パック ストームエメラルダ 特性 はしゃのほうこうは、手札からベンチに出したとき、山札を上から4枚見て基本エネルギーを1枚つけることができるぞ！";
  assert.equal(looksDescriptionLikeProductName(product), true);
  const result = validatePublishedLotteries([{ product }], catalog);
  assert.equal(result.ok, false);
  assert.match(result.errors[0], /説明文/);
});

test("unexpanded product groups fail the final public feed gate", () => {
  const result = validatePublishedLotteries([{ product: "スターターセットex 3種" }], catalog);
  assert.equal(result.ok, false);
  assert.match(result.errors[0], /未分割/);
});

test("canonical individual product names pass", () => {
  const result = validatePublishedLotteries([{ product: "拡張パック ストームエメラルダ" }], catalog);
  assert.equal(result.ok, true);
});
