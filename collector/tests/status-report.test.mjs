import test from "node:test";
import assert from "node:assert/strict";
import { buildCollectorHealthReport } from "../lib/status-report.mjs";

test("取得元失敗があればWorkflowを失敗扱いにする", () => {
  const report = buildCollectorHealthReport({
    collectorVersion: "1.21.1",
    status: "partial",
    failedSourceCount: 1,
    sourceHealth: { failedSources: [{ name: "取得元A", error: "HTTP 403" }] },
    livePocketDiscovery: { status: "no_candidates" },
  });
  assert.equal(report.level, "error");
  assert.equal(report.exitCode, 1);
  assert.match(report.markdown, /取得元A/);
  assert.equal(report.annotations[0].level, "error");
});

test("LivePocket候補ゼロは警告として可視化する", () => {
  const report = buildCollectorHealthReport({
    collectorVersion: "1.21.1",
    status: "ok",
    failedSourceCount: 0,
    sourceHealth: { failedSources: [] },
    livePocketDiscovery: {
      status: "no_candidates",
      searchPageLinkCount: 125,
      candidateLinkCount: 0,
    },
  });
  assert.equal(report.level, "warning");
  assert.equal(report.exitCode, 0);
  assert.match(report.markdown, /no_candidates/);
});

test("LivePocket関連ページを解析できた場合は正常", () => {
  const report = buildCollectorHealthReport({
    collectorVersion: "1.21.1",
    status: "ok",
    failedSourceCount: 0,
    sourceHealth: { failedSources: [] },
    livePocketDiscovery: {
      status: "ok",
      candidateLinkCount: 4,
      relevantPageCount: 4,
      parsedItemCount: 4,
    },
  });
  assert.equal(report.level, "ok");
  assert.equal(report.exitCode, 0);
});
