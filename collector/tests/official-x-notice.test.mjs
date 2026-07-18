import test from "node:test";
import assert from "node:assert/strict";
import { parseXPost } from "../lib/x-parser.mjs";
import { evaluateCandidate } from "../lib/quality-gate.mjs";

const productCatalog = [{
  id: "pcg-test-ninja",
  name: "拡張パック ニンジャスピナー",
  aliases: ["ニンジャスピナー"],
  releaseDate: "2026-03-13",
}];

test("official store-only X post becomes a publishable notice without inventing an application link", () => {
  const post = {
    id: "2032016497875566688",
    author_id: "42",
    created_at: "2026-03-05T03:00:00.000Z",
    text: `【#ポケカ 抽選販売】\nポケモンカード 拡張パック「ニンジャスピナー」\n応募期間：3月5日～3月10日 20:00まで\n店頭掲示のポスターよりお申込みページへ！`,
    entities: { urls: [{ expanded_url: "https://x.com/example/status/1/photo/1" }] },
  };
  const known = new Set(["ys_hiroshimags"]);
  const metadata = new Map([["ys_hiroshimags", {
    username: "YS_HIROSHIMAGS",
    label: "イエローサブマリン広島店",
    area: "広島県",
    official: true,
  }]]);
  const item = parseXPost(post, { username: "YS_HIROSHIMAGS", name: "イエローサブマリン広島店" }, known, metadata);
  assert.ok(item);
  assert.equal(item.destinationType, "store");
  assert.equal(item.noticeOnly, true);
  assert.equal(item.sourceType, "公式X");
  assert.equal(item.area, "広島県");
  assert.equal(item.applyEndDate, "2026-03-10");
  const gate = evaluateCandidate({ ...item, product: "ニンジャスピナー", destinationVerified: true }, productCatalog, new Date("2026-03-06T00:00:00+09:00"));
  assert.equal(gate.accepted, true, gate.reasons.join(" / "));
  assert.equal(gate.checks.officialNotice, true);
});
