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
