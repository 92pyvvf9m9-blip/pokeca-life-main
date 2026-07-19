import test from "node:test";
import assert from "node:assert/strict";
import { buildCollectorHealthReport } from "../lib/status-report.mjs";

test("HTTP 403だけなら警告表示しつつWorkflowを成功扱いにする", () => {
  const report = buildCollectorHealthReport({
    collectorVersion: "1.21.2",
    status: "degraded",
    checkedSourceCount: 10,
    successfulSourceCount: 9,
    failedSourceCount: 1,
    sourceHealth: {
      failedSources: [{
        name: "あみあみ",
        error: "HTTP 403",
        failureClass: "access_blocked",
        severity: "warning",
      }],
    },
    sourceDiagnostics: [],
    livePocketDiscovery: { status: "no_candidates", searchPageLinkCount: 240 },
  });

  assert.equal(report.level, "warning");
  assert.equal(report.exitCode, 0);
  assert.equal(report.annotations[0].level, "warning");
  assert.match(report.markdown, /収集・公開データ更新は完了/);
});

test("パーサー故障は引き続きWorkflowを失敗扱いにする", () => {
  const report = buildCollectorHealthReport({
    collectorVersion: "1.21.2",
    status: "partial",
    checkedSourceCount: 2,
    successfulSourceCount: 1,
    failedSourceCount: 1,
    sourceHealth: {
      failedSources: [{
        name: "取得元A",
        error: "Parser failed",
        failureClass: "parser_error",
        severity: "error",
      }],
    },
    livePocketDiscovery: { status: "ok", parsedItemCount: 1 },
  });

  assert.equal(report.level, "error");
  assert.equal(report.exitCode, 1);
});
