import test from "node:test";
import assert from "node:assert/strict";
import { buildOfficialRevisitCandidates } from "../lib/official-revisit.mjs";

test("Furuichi direct official article is revisited after it disappears from the archive", () => {
  const source = {
    parser: "furuichi-news",
    url: "https://www.furu1.net/news/",
  };
  const previous = [
    {
      verified: true,
      qualityVersion: 2,
      shop: "古本市場（ふるいち）",
      product: "スターターセットex 3種",
      url: "https://www.furu1.net/news/news_information/pk20260713",
      collectedAt: "2026-07-20T00:00:00.000Z",
    },
    {
      verified: true,
      qualityVersion: 2,
      product: "拡張パック ストームエメラルダ",
      url: "https://www.furu1.net/news/news_information/pk20260713",
    },
  ];
  const result = buildOfficialRevisitCandidates(source, previous, []);
  assert.equal(result.length, 1);
  assert.equal(result[0].url, "https://www.furu1.net/news/news_information/pk20260713");
  assert.equal(result[0].parser, "furuichi-news");
  assert.equal(result[0].officialRevisit, true);
});

test("revisit never follows previous records to another host", () => {
  const result = buildOfficialRevisitCandidates(
    { parser: "hobby-station-news", url: "https://www.hbst.net/category/news/" },
    [{ verified: true, qualityVersion: 2, url: "https://example.com/bad" }],
    [],
  );
  assert.deepEqual(result, []);
});
