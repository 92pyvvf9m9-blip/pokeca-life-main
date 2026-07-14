import assert from "node:assert/strict";
import { parseXPost } from "../lib/x-parser.mjs";

const post = {
  id: "1234567890",
  author_id: "42",
  created_at: "2026-07-12T03:00:00.000Z",
  text: `Amazonでポケモンカード「ストームエメラルダ BOX」の招待リクエスト開始
応募期間：2026年7月12日 10時00分～2026年7月15日 23時59分
#ポケカ`,
  entities: {
    urls: [
      {
        expanded_url: "https://www.amazon.co.jp/example",
      },
    ],
  },
};

const item = parseXPost(
  post,
  { username: "pokegetinfomain", name: "ポケカ情報" },
  new Set(["pokegetinfomain"])
);

assert.ok(item);
assert.equal(item.shop, "Amazon.co.jp");
assert.match(item.product, /ストームエメラルダ/);
assert.equal(item.applyStartDate, "2026-07-12");
assert.equal(item.applyEndDate, "2026-07-15");
assert.equal(item.destinationType, "direct");
assert.equal(item.sourceType, "X");
assert.ok(item.confidence >= 0.8);

console.log("x-parser.test.mjs: OK");
