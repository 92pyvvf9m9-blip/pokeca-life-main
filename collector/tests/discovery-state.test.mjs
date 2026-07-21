import test from "node:test";
import assert from "node:assert/strict";
import { DiscoveryStateTracker, documentFingerprint, opaqueCandidateKey } from "../lib/discovery-state.mjs";

const source = { id: "official-store-a", url: "https://example.com/news" };

test("HTMLの空白差は同じ意味のfingerprintになる", () => {
  assert.equal(
    documentFingerprint("<h1>ポケカ 抽選</h1><p>受付中</p>"),
    documentFingerprint("<h1> ポケカ   抽選 </h1>\n<p>受付中</p>"),
  );
});

test("初回巡回はroot初回・候補新着として記録する", () => {
  const tracker = new DiscoveryStateTracker({}, new Date("2026-07-21T00:00:00.000Z"));
  const root = tracker.observeRoot(source, "<h1>抽選一覧</h1>");
  const candidate = tracker.observeCandidate(source, "https://example.com/lottery/1?utm_source=x", "<p>応募受付中</p>");
  const result = tracker.finalize();

  assert.deepEqual(root, { firstSeen: true, changed: false });
  assert.deepEqual(candidate, { firstSeen: true, changed: false });
  assert.equal(result.metrics.rootFirstSeenCount, 1);
  assert.equal(result.metrics.newCandidateCount, 1);
  assert.equal(JSON.stringify(result.state).includes("example.com"), false);
});

test("2回目巡回で本文変更を検知しURL追跡パラメータは同一候補に統合する", () => {
  const first = new DiscoveryStateTracker({}, new Date("2026-07-21T00:00:00.000Z"));
  first.observeRoot(source, "<h1>抽選一覧</h1>");
  first.observeCandidate(source, "https://example.com/lottery/1?utm_source=x", "<p>応募受付中</p>");
  const firstState = first.finalize().state;

  const second = new DiscoveryStateTracker(firstState, new Date("2026-07-21T00:15:00.000Z"));
  const root = second.observeRoot(source, "<h1>抽選一覧 更新</h1>");
  const candidate = second.observeCandidate(source, "https://example.com/lottery/1?utm_source=y", "<p>受付終了</p>");
  const result = second.finalize();

  assert.deepEqual(root, { firstSeen: false, changed: true });
  assert.deepEqual(candidate, { firstSeen: false, changed: true });
  assert.equal(result.metrics.rootChangedCount, 1);
  assert.equal(result.metrics.changedCandidateCount, 1);
  assert.equal(result.metrics.knownCandidateCount, 1);
});

test("候補URLキーはutm差を無視する", () => {
  assert.equal(
    opaqueCandidateKey("https://example.com/e/abc?utm_campaign=a&x=1"),
    opaqueCandidateKey("https://example.com/e/abc?utm_campaign=b&x=1"),
  );
});
