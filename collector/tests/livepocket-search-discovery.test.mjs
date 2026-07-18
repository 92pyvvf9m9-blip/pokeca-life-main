import test from "node:test";
import assert from "node:assert/strict";
import { discoverCandidateLinks } from "../lib/discovery.mjs";

const source = {
  url: "https://imageflux.livepocket.jp/event/search?page=1&sort=0&word=%E3%83%9D%E3%82%B1%E3%83%A2%E3%83%B3%E3%82%AB%E3%83%BC%E3%83%89",
  parser: "livepocket-search",
  discovery: {
    enabled: true,
    sameHostOnly: false,
    allowedHosts: ["livepocket.jp"],
    requiredPathPatterns: ["^/e/"],
    childParser: "livepocket",
    includePatterns: ["ポケモンカード", "ポケカ", "MEGA"],
    excludePatterns: ["(?:受付|販売)?終了"],
    maxPages: 20,
  },
};

test("LivePocket検索から受付中の直接イベントだけを抽出する", () => {
  const html = `
    <a href="https://livepocket.jp/e/m1ea7">販売中 ポケモンカードゲーム MEGA スターターセットex 抽選販売</a>
    <a href="https://t.livepocket.jp/e/old01">受付終了 ポケモンカードゲーム 過去抽選</a>
    <a href="https://example.com/e/fake">ポケモンカード 抽選</a>
    <a href="https://livepocket.jp/help">ポケモンカード FAQ</a>
  `;
  const items = discoverCandidateLinks(source, html);
  assert.equal(items.length, 1);
  assert.equal(items[0].url, "https://livepocket.jp/e/m1ea7");
  assert.equal(items[0].parser, "livepocket");
});
