import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { withMaintainedSources, MAINTAINED_SOURCES } from "../lib/maintained-sources.mjs";
import { discoverCandidateLinks, discoverSearchPagination } from "../lib/discovery.mjs";
import { htmlToText } from "../lib/html.mjs";
import { parseDateRange } from "../lib/dates.mjs";
import { parseSourceDocument } from "../lib/parser.mjs";
await import("../../lottery-lifecycle-core.js");

test("maintained sources preserve private configuration and explicit disabled sources", () => {
  const disabled = { ...MAINTAINED_SOURCES[0], enabled: false };
  const payload = { sources: [disabled], blockedDestinationDomains: ["example.com"] };
  const merged = withMaintainedSources(payload);
  assert.equal(merged.sources.length, MAINTAINED_SOURCES.length);
  assert.equal(merged.sources[0].enabled, false);
  assert.deepEqual(merged.blockedDestinationDomains, payload.blockedDestinationDomains);
  assert.deepEqual(withMaintainedSources(merged), merged);
  assert.equal(payload.sources.length, 1);
});

test("modern LivePocket markup does not leak quoted attribute arrows into text", () => {
  assert.equal(htmlToText('<p data-action="click->toggle#open">応募期間</p>'), "応募期間");
});

test("LivePocket search bounds pagination and merges duplicate event subdomains", () => {
  const source = MAINTAINED_SOURCES[0];
  const second = new URL(source.url);
  second.searchParams.set("page", "2");
  const third = new URL(source.url);
  third.searchParams.set("page", "3");
  const html = `<a href="${second.href}">2</a><a href="${third.href}">3</a>
    <a href="https://livepocket.jp/e/test01">ポケモンカード 抽選</a>
    <a href="https://t.livepocket.jp/e/test01">ポケモンカード 抽選</a>`;
  assert.deepEqual(discoverSearchPagination(source, html), [second.href]);
  assert.equal(discoverCandidateLinks(source, html).length, 1);
});

test("modern full heading and sales reception period override truncated social title", () => {
  const html = `<meta property="og:title" content="キデイランド ポケモ...のチケット情報">
    <h1>キデイランド 吉祥寺店 ポケモンカードゲーム 30THセレブレーション カードセット（全9種）購入券</h1>
    <p>東京都 キデイランド 吉祥寺店</p>
    <p>販売受付期間 2026年10月5日（月）10：00～7日（水）23：59 当選発表 2026年10月14日 購入期限 2026年10月18日</p>
    <h2>同じ販売元のイベント</h2><p>応募期間 2026年9月1日～9月3日</p>`;
  const [item] = parseSourceDocument({ ...MAINTAINED_SOURCES[0], parser: "livepocket", url: "https://livepocket.jp/e/test01" }, html, "2026-10-06T05:30:00Z");
  assert.ok(item);
  assert.match(item.product, /30th CELEBRATION/i);
  assert.equal(item.applyStartDate, "2026-10-05");
  assert.equal(item.applyEndDate, "2026-10-07");
  assert.equal(item.applyEndTime, "23:59");
  assert.equal(item.resultStartDate, "2026-10-14");
  assert.equal(item.purchaseEndDate, "2026-10-18");
  const [japaneseTitle] = parseSourceDocument({ ...MAINTAINED_SOURCES[0], parser: "livepocket", url: "https://livepocket.jp/e/test02" }, html.replace("30THセレブレーション", "30周年セレブレーション"), "2026-10-06T05:30:00Z");
  assert.match(japaneseTitle.product, /30th CELEBRATION/i);
});

test("spaced Japanese dates preserve noon, midnight and minutes", () => {
  const period = parseDateRange("2026 年 10 月 5 日 午後 12 時 00 分 ～ 2026 年 10 月 7 日 午後 11 時 59 分", new Date("2026-10-06T05:30:00Z"));
  assert.equal(period.start.time, "12:00");
  assert.equal(period.end.time, "23:59");
  assert.equal(parseDateRange("2026年10月5日午前12時00分").start.time, "00:00");
});

test("closed application remains available for results and purchase without becoming active", () => {
  const core = globalThis.PokecaLotteryLifecycleCore;
  const item = { applyEndDate: "2026-10-04", resultStartDate: "2026-10-15", purchaseEndDate: "2026-10-19" };
  const now = new Date("2026-10-06T05:30:00Z");
  assert.equal(core.applicationState(item, now), "closed");
  assert.equal(core.isHistory(item, now), false);
  assert.equal(core.isHistory(item, new Date("2026-10-19T15:00:00Z")), true);
  assert.equal(core.applicationState({ applyEndDate: "2026-10-06" }, new Date("2026-10-06T14:59:00Z")), "active");
});

test("home regional filter accepts declared multi-prefecture coverage without admitting other-area pickup", () => {
  const html = fs.readFileSync(new URL("../../index.html", import.meta.url), "utf8");
  const match = html.match(/function lotteryMatchesAreas\(item,areas\)\{[\s\S]*?\n\}/);
  assert.ok(match);
  const context = vm.createContext({
    PREFECTURES: ["全国", "東京都", "神奈川県", "千葉県", "広島県"],
    normalizedLotteryArea: value => value || "全国",
    isNationwideShipping: item => item.type === "通販",
    lotteryPhysicalPrefecture: item => item.prefecture || "",
  });
  vm.runInContext(match[0], context);
  assert.equal(context.lotteryMatchesAreas({ area: "東京都・神奈川県・千葉県", type: "店舗" }, ["千葉県"]), true);
  assert.equal(context.lotteryMatchesAreas({ area: "東京都", type: "店舗" }, ["広島県"]), false);
  assert.equal(context.lotteryMatchesAreas({ area: "全国", type: "通販" }, ["広島県"]), true);
  assert.equal(context.lotteryMatchesAreas({ area: "全国", type: "店舗" }, ["広島県"]), false);
  assert.equal(context.lotteryMatchesAreas({ area: "全国", type: "店舗", coverage: ["広島県"] }, ["広島県"]), true);
});

test("Yodobashi official product and separate date labels form a nationwide shipping entry", () => {
  const html = `<h1>ポケモンカード 抽選</h1><p>対象商品</p>
    <p>ポケモンカードゲーム 30th CELEBRATION カードセット（全9種）</p>
    <p>抽選お申し込み期間</p><p>2026年10月5日午前11時00分～2026年10月6日午前10時59分</p>
    <p>抽選結果発表</p><p>2026年10月6日午後6時00分</p>
    <p>ご注文期限</p><p>2026年10月7日午後11時59分</p>`;
  const [item] = parseSourceDocument(MAINTAINED_SOURCES[3], html, "2026-10-06T05:30:00Z");
  assert.ok(item);
  assert.equal(item.type, "通販");
  assert.equal(item.applyEndTime, "10:59");
  assert.equal(item.resultStartTime, "18:00");
  assert.equal(item.purchaseEndTime, "23:59");
  assert.deepEqual(parseSourceDocument(MAINTAINED_SOURCES[3], "抽選結果は順次発表します", "2026-10-06T05:30:00Z"), []);
});
