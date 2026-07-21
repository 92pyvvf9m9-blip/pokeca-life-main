import test from "node:test";
import assert from "node:assert/strict";
import { extractOcrImageCandidates, normalizeOcrText, enrichHtmlWithImageOcr } from "../lib/image-ocr.mjs";

test("Furuichi article image is prioritized over small action buttons", () => {
  const html = `
    <img src="/storage/news/news_information/pk20260713/fa.png" width="200" height="50" alt="会員登録">
    <img src="/storage/news/news_information/pk20260713/20260714p.jpg" alt="">
    <img src="/storage/news/news_information/pk20260713/od.png" width="220" height="60" alt="抽選へ進む">
  `;
  const candidates = extractOcrImageCandidates(html, "https://www.furu1.net/news/news_information/pk20260713", { maxImages: 1 });
  assert.equal(candidates.length, 1);
  assert.match(candidates[0].url, /20260714p\.jpg$/);
});

test("OCR date and product spacing noise is normalized", () => {
  const text = normalizeOcrText("2026 年 7 月 19 日 23:00 / イープイe x / 8A248");
  assert.match(text, /2026年7月19日/);
  assert.match(text, /イーブイex/);
  assert.match(text, /8月2日/);
});

test("OCR enrichment appends only Pokemon lottery text", async () => {
  const html = `<h1>ポケモンカード 抽選</h1><img src="/storage/news/main.jpg">`;
  const response = {
    ok: true,
    headers: new Map([["content-type", "image/jpeg"]]),
    async arrayBuffer(){ return new Uint8Array(10000).buffer; },
  };
  response.headers.get = response.headers.get.bind(response.headers);
  const result = await enrichHtmlWithImageOcr(
    { parser: "furuichi-news", url: "https://www.furu1.net/news/example" },
    html,
    {
      fetchImpl: async () => response,
      ocrImpl: async () => "ポケモンカードゲーム MEGA 拡張パック ストームエメラルダ\n受付期間 2026年7月19日まで",
    }
  );
  assert.equal(result.applied, true);
  assert.match(result.html, /data-pokeca-ocr/);
});
