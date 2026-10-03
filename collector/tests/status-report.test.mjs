import test from "node:test";
import assert from "node:assert/strict";
import { buildCollectorHealthReport } from "../lib/status-report.mjs";

test("取得元の詳細を表示せず、致命的な失敗はWorkflowを失敗扱いにする", () => {
  const report = buildCollectorHealthReport({
    collectorVersion: "1.21.1",
    status: "partial",
    failedSourceCount: 1,
    sourceHealth: { failedSources: [{ name: "取得元A", error: "Parser failed", severity: "error" }] },
    livePocketDiscovery: { status: "no_candidates" },
  });
  assert.equal(report.level, "error");
  assert.equal(report.exitCode, 1);
  assert.doesNotMatch(report.markdown, /取得元A|Parser failed/);
  assert.doesNotMatch(JSON.stringify(report.annotations), /取得元A|Parser failed/);
  assert.equal(report.annotations[0].level, "error");
});

test("候補がない場合は、取得元名を出さずに警告する", () => {
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
  assert.match(report.markdown, /自動発見候補/);
  assert.doesNotMatch(report.markdown, /LivePocket|no_candidates/);
});

test("候補ページを解析できた場合は正常", () => {
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
