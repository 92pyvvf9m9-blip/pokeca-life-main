const CRITICAL_DISCOVERY_STATUSES = new Set([
  "search_failed",
  "candidate_fetch_failed",
  "parser_returned_zero",
]);

const WARNING_DISCOVERY_STATUSES = new Set([
  "no_candidates",
  "no_relevant_pages",
  "partial",
]);

function number(value) {
  return Number.isFinite(Number(value)) ? Number(value) : 0;
}

export function buildCollectorHealthReport(status = {}) {
  const failedSources = Array.isArray(status.sourceHealth?.failedSources)
    ? status.sourceHealth.failedSources
    : [];
  const fatalFailedCount = failedSources.filter((source) => source.severity !== "warning").length;
  const warningFailedCount = failedSources.length - fatalFailedCount;
  const failedSourceCount = number(status.failedSourceCount || failedSources.length);
  const checkedSourceCount = number(status.checkedSourceCount);
  const successfulSourceCount = number(status.successfulSourceCount);
  const allSourcesFailed = checkedSourceCount > 0 && successfulSourceCount === 0;
  const discoveryStatus = String(
    status.livePocketDiscovery?.status || status.livePocketDiscoveryStatus || "not_configured",
  );
  const criticalDiscovery = CRITICAL_DISCOVERY_STATUSES.has(discoveryStatus);
  const warningDiscovery = WARNING_DISCOVERY_STATUSES.has(discoveryStatus);
  const collectorFatal = fatalFailedCount > 0 || allSourcesFailed || status.status === "partial";

  let level = "ok";
  if (collectorFatal || criticalDiscovery) level = "error";
  else if (warningFailedCount > 0 || warningDiscovery || status.status === "degraded") level = "warning";

  const annotations = [];
  if (collectorFatal) {
    annotations.push({
      level: "error",
      title: "収集処理で確認が必要です",
      message: `失敗した取得元 ${failedSourceCount}件。詳細は非公開の診断情報で確認してください。`,
    });
  } else if (warningFailedCount > 0 || warningDiscovery || status.status === "degraded") {
    annotations.push({
      level: "warning",
      title: "収集結果を確認してください",
      message: `取得元の警告 ${warningFailedCount}件。公開一覧の更新は完了しています。`,
    });
  }
  if (criticalDiscovery) {
    annotations.push({
      level: "error",
      title: "候補ページの確認に失敗しました",
      message: "自動発見の処理を確認してください。",
    });
  }

  const lines = [
    "# Pokeca Life 収集結果",
    "",
    `- 総合状態: **${status.status || "unknown"}**`,
    `- コレクター: **v${status.collectorVersion || "unknown"}**`,
    `- 公開件数: **${number(status.publishedCount)}件**`,
    `- 確認待ち: **${number(status.reviewCount)}件**`,
    `- 取得元: **成功 ${successfulSourceCount} / 失敗 ${failedSourceCount}**`,
    `- 自動発見候補: **${number(status.livePocketDiscovery?.candidateLinkCount)}件**`,
    `- 解析済み候補: **${number(status.livePocketDiscovery?.parsedItemCount)}件**`,
    "",
    level === "error"
      ? "**判定: 収集処理を確認してください。公開一覧の更新結果は保存されています。**"
      : level === "warning"
        ? "**判定: 公開一覧を更新しました。一部の取得状況を確認してください。**"
        : "**判定: 収集と公開一覧の更新が完了しました。**",
    "",
  ];

  return {
    level,
    exitCode: level === "error" ? 1 : 0,
    annotations,
    markdown: `${lines.join("\n")}\n`,
  };
}
