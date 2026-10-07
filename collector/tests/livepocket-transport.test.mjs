import test from "node:test";
import assert from "node:assert/strict";
import { recoverLivePocketSearch, livePocketResponseClass } from "../lib/livepocket-transport.mjs";
const source = { parser: "livepocket-search", url: "https://livepocket.jp/event/search?word=ポケモンカード" };
test("empty HTTP 200 search shell recovers only when transport returns real event links", async () => {
  const html = '<a href="/e/abc01">ポケモンカード 抽選</a>';
  const result = await recoverLivePocketSearch(source, '<script src="app.js"></script>', async () => html);
  assert.equal(result.html, html);
  assert.equal(result.fallbackUsed, true);
  assert.equal(result.responseClass, "event_links");
});
test("working search and unrelated sources never trigger another request", async () => {
  const fail = () => { throw new Error("unexpected fallback"); };
  assert.equal((await recoverLivePocketSearch(source, '<a href="/e/abc01">抽選</a>', fail)).fallbackUsed, false);
  assert.equal((await recoverLivePocketSearch({ ...source, url: "https://example.com/search" }, "", fail)).fallbackUsed, false);
});
test("failed fallback and access checks do not invent search entries", async () => {
  const shell = "Just a moment enable JavaScript and cookies";
  const result = await recoverLivePocketSearch(source, shell, async () => { throw new Error("timeout"); });
  assert.equal(result.html, shell);
  assert.equal(result.fallbackUsed, false);
  assert.equal(livePocketResponseClass(shell), "access_check");
});
