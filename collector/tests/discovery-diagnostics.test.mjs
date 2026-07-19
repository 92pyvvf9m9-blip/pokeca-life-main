import test from "node:test";
import assert from "node:assert/strict";
import { discoverCandidateLinksDetailed } from "../lib/discovery.mjs";

const source = {
  url: "https://imageflux.livepocket.jp/event/search?word=pokeca",
  discovery: {
    enabled: true,
    sameHostOnly: false,
    allowedHosts: ["livepocket.jp"],
    requiredPathPatterns: ["^/e/"],
    childParser: "livepocket",
    includePatterns: ["ポケモンカード", "ポケカ"],
    excludePatterns: ["終了"],
    maxPages: 10,
  },
};

test("発見診断は除外理由をURLなしで集計する", () => {
  const html = `
    <a href="https://livepocket.jp/e/good01">ポケモンカード 抽選</a>
    <a href="https://livepocket.jp/e/closed">ポケモンカード 受付終了</a>
    <a href="https://example.com/e/fake">ポケモンカード 抽選</a>
    <a href="https://livepocket.jp/help">ポケモンカード FAQ</a>
    <a href="https://livepocket.jp/e/music">音楽イベント</a>
  `;

  const result = discoverCandidateLinksDetailed(source, html);
  assert.equal(result.candidates.length, 1);
  assert.equal(result.stats.totalLinks, 5);
  assert.equal(result.stats.returnedCount, 1);
  assert.equal(result.stats.rejected.excludePattern, 1);
  assert.equal(result.stats.rejected.host, 1);
  assert.equal(result.stats.rejected.path, 1);
  assert.equal(result.stats.rejected.includePattern, 1);
  assert.equal(JSON.stringify(result.stats).includes("https://"), false);
});

test("リンクが無いJS描画ページを判別できる", () => {
  const result = discoverCandidateLinksDetailed(source, "<div id=app></div><script>window.__DATA__={}</script>");
  assert.equal(result.candidates.length, 0);
  assert.equal(result.stats.totalLinks, 0);
  assert.equal(result.stats.returnedCount, 0);
});
