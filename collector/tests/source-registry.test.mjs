import test from "node:test";
import assert from "node:assert/strict";
import { normalizeSourceRegistry, summarizeSourceRegistry, sourceIsDue } from "../lib/source-registry.mjs";

test("情報源DBは旧形式を壊さずDiscovery用の既定値を補完する", () => {
  const registry = normalizeSourceRegistry({
    version: 1,
    blockedDestinationDomains: ["example.invalid"],
    sources: [{
      id: "livepocket-public-pokeca",
      name: "LivePocket公開抽選",
      url: "https://t.livepocket.jp/event/search?word=potato",
      parser: "livepocket-search",
      priority: 95,
      discovery: { enabled: true, sameHostOnly: false, allowedHosts: ["livepocket.jp"] },
    }],
  });

  assert.deepEqual(registry.errors, []);
  assert.equal(registry.sources[0].platform, "livepocket");
  assert.equal(registry.sources[0].crawlIntervalMinutes, 5);
  assert.equal(registry.sources[0].discovery.childParser, "livepocket");
  assert.equal(registry.sources[0].discovery.maxPages, 20);
  assert.deepEqual(registry.blockedDestinationDomains, ["example.invalid"]);
});

test("情報源DBは不正URLと重複IDを検出する", () => {
  const registry = normalizeSourceRegistry({
    sources: [
      { id: "same", name: "A", url: "not-a-url" },
      { id: "same", name: "B", url: "https://example.com/" },
    ],
  });

  assert.ok(registry.errors.some((message) => message.includes("urlが不正")));
  assert.ok(registry.errors.some((message) => message.includes("重複")));
});

test("情報源DB集計は公開URLを含めず件数だけ返す", () => {
  const registry = normalizeSourceRegistry({
    sources: [
      { id: "a", name: "A", url: "https://example.com/a", parser: "generic", official: true, area: "広島県", discovery: { enabled: true } },
      { id: "b", name: "B", url: "https://example.net/b", parser: "google-form", area: "全国" },
    ],
  });
  const summary = summarizeSourceRegistry(registry);

  assert.equal(summary.enabledCount, 2);
  assert.equal(summary.discoveryEnabledCount, 1);
  assert.equal(summary.officialCount, 1);
  assert.equal(summary.byPrefecture["広島県"], 1);
  assert.equal(JSON.stringify(summary).includes("https://"), false);
});

test("巡回間隔を過ぎた情報源だけdueになる", () => {
  const source = { crawlIntervalMinutes: 15 };
  const now = new Date("2026-07-21T03:00:00.000Z");
  assert.equal(sourceIsDue(source, "2026-07-21T02:40:00.000Z", now), true);
  assert.equal(sourceIsDue(source, "2026-07-21T02:50:00.000Z", now), false);
});

test("旧情報源でincludePatterns未指定なら組み込み既定値を維持する", () => {
  const registry = normalizeSourceRegistry({
    sources: [{ id: "legacy", name: "Legacy", url: "https://example.com/news", discovery: { enabled: true } }],
  });
  assert.equal(Object.hasOwn(registry.sources[0].discovery, "includePatterns"), false);
  assert.equal(Object.hasOwn(registry.sources[0].discovery, "excludePatterns"), false);
});
