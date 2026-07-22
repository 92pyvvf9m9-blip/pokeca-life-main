import test from "node:test";
import assert from "node:assert/strict";
import { discoverCandidateLinksDetailed } from "../lib/discovery.mjs";

test("ふるいちの通常ニュースだけの一覧は contextual 0 と診断する", () => {
  const source = {
    name: "ふるいち",
    url: "https://www.furu1.net/",
    parser: "furuichi-news",
    discovery: {
      enabled: true,
      sameHostOnly: true,
      includePatterns: ["ポケモンカード", "抽選"],
      requiredPathPatterns: ["/news/news_information/"],
    },
  };
  const html = `
    <a href="/news/news_campaign/sale260716">ふるいちサマーセール</a>
    <a href="/news/news_information/store-open">新店舗オープンのお知らせ</a>
  `;
  const result = discoverCandidateLinksDetailed(source, html);
  assert.equal(result.candidates.length, 0);
  assert.equal(result.stats.totalLinks, 2);
  assert.equal(result.stats.contextualFuruichiLinkCount, 0);
  assert.equal(result.stats.contextualLinkCount, 0);
});

test("ふるいちのポケカ抽選記事は古いSecret条件を迂回して contextual 候補になる", () => {
  const source = {
    name: "ふるいち",
    url: "https://www.furu1.net/",
    parser: "furuichi-news",
    discovery: {
      enabled: true,
      sameHostOnly: true,
      includePatterns: ["NEVER_MATCH"],
      excludePatterns: ["抽選"],
      requiredPathPatterns: ["/obsolete/"],
    },
  };
  const html = `
    <article>
      <h2>ポケモンカードゲーム 新商品 WEB事前抽選受付</h2>
      <a href="/news/news_information/pk20260713">抽選受付について</a>
    </article>
  `;
  const result = discoverCandidateLinksDetailed(source, html);
  assert.equal(result.candidates.length, 1);
  assert.equal(result.stats.contextualFuruichiLinkCount, 1);
  assert.equal(result.stats.contextualLinkCount, 1);
});
