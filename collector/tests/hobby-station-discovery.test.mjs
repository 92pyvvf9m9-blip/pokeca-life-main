import test from "node:test";
import assert from "node:assert/strict";
import { discoverCandidateLinksDetailed } from "../lib/discovery.mjs";

test("Hobby Station discovers ended article links from image-only listing cards", () => {
  const source = {
    id: "hobby-station-official",
    name: "ホビーステーション",
    url: "https://www.hbst.net/category/news/",
    parser: "hobby-station-news",
    discovery: {
      enabled: true,
      sameHostOnly: true,
      requiredPathPatterns: ["\\?p=\\d+"],
      childParser: "hobby-station-news",
    },
  };
  const html = `
  <article>
    <h2>【2026.07.03】※応募は終了しました「ポケモンカードゲームMEGA 拡張パック ストームエメラルダ」抽選販売</h2>
    <a href="https://www.hbst.net/?p=410275"><img src="thumb.jpg" alt=""></a>
    <p>LivePocketを使用した抽選です。</p>
  </article>`;
  const result = discoverCandidateLinksDetailed(source, html);
  assert.equal(result.candidates.length, 1);
  assert.equal(result.candidates[0].url, "https://www.hbst.net/?p=410275");
  assert.equal(result.candidates[0].parser, "hobby-station-news");
});

test("Furuichi official news links are discovered even when generic path rules are stale", () => {
  const source = {
    id: "furuichi-official",
    name: "ふるいち",
    url: "https://www.furu1.net/news/",
    parser: "furuichi-news",
    discovery: {
      enabled: true,
      sameHostOnly: true,
      includePatterns: ["never-match-this"],
      requiredPathPatterns: ["/outdated-path/"],
      childParser: "furuichi-news",
      maxPages: 8,
    },
  };
  const html = `
    <article>
      <a href="/news/news_information/pk20260713">7月31日発売トレーディングカード 各種 抽選受付について（ポケモンカード）</a>
    </article>`;
  const result = discoverCandidateLinksDetailed(source, html);
  assert.equal(result.candidates.length, 1);
  assert.equal(result.candidates[0].url, "https://www.furu1.net/news/news_information/pk20260713");
});

test("Hobby Station bypasses stale secret patterns for official articles and contextual LivePocket links", () => {
  const source = {
    id: "hobby-station",
    name: "ホビーステーション",
    url: "https://www.hbst.net/category/news/",
    parser: "hobby-station-news",
    discovery: {
      enabled: true,
      sameHostOnly: true,
      includePatterns: ["NEVER_MATCH_OLD_SECRET"],
      excludePatterns: ["抽選"],
      requiredPathPatterns: ["/obsolete-path/"],
      childParser: "hobby-station-news",
      maxPages: 8,
    },
  };
  const html = `
    <article>
      <h2>ポケモンカードゲームMEGA 拡張パック ストームエメラルダ 抽選販売</h2>
      <a href="https://www.hbst.net/?p=410275"><img alt="抽選販売"></a>
      <a href="https://livepocket.jp/e/i1xp-">抽選受付ページリンク</a>
    </article>`;
  const result = discoverCandidateLinksDetailed(source, html);
  assert.equal(result.candidates.length, 2);
  assert.ok(result.candidates.some(item => item.url === "https://www.hbst.net/?p=410275" && item.parser === "hobby-station-news"));
  assert.ok(result.candidates.some(item => item.url === "https://livepocket.jp/e/i1xp-" && item.parser === "livepocket"));
});
