const CRITICAL_LIVEPOCKET_STATUSES = new Set([
  "search_failed",
  "candidate_fetch_failed",
  "parser_returned_zero",
]);

const WARNING_LIVEPOCKET_STATUSES = new Set([
  "no_candidates",
  "no_relevant_pages",
  "partial",
]);

function number(value) {
  return Number.isFinite(Number(value)) ? Number(value) : 0;
}

function md(value = "") {
  return String(value || "")
    .replace(/\|/g, "\\|")
    .replace(/[\r\n]+/g, " ")
    .slice(0, 180);
}

function statusMark(value) {
  if (value === "items" || value === "ok") return "✅";
  if (value === "failed") return "❌";
  return "⚠️";
}

export function buildCollectorHealthReport(status = {}) {
  const failedSources = Array.isArray(status.sourceHealth?.failedSources)
    ? status.sourceHealth.failedSources
    : [];
  const diagnostics = Array.isArray(status.sourceDiagnostics)
    ? status.sourceDiagnostics
    : [];
  const livePocket = status.livePocketDiscovery || {
    status: status.livePocketDiscoveryStatus || "not_configured",
  };
  const livePocketStatus = String(livePocket.status || "not_configured");
  const fatalFailedSources = failedSources.filter((source) => source.severity !== "warning");
  const warningFailedSources = failedSources.filter((source) => source.severity === "warning");
  const allSourcesFailed = number(status.checkedSourceCount) > 0
    && number(status.successfulSourceCount) === 0;
  const collectorFatal = fatalFailedSources.length > 0 || allSourcesFailed;
  const livePocketCritical = CRITICAL_LIVEPOCKET_STATUSES.has(livePocketStatus);
  const livePocketWarning = WARNING_LIVEPOCKET_STATUSES.has(livePocketStatus);

  let level = "ok";
  if (collectorFatal || livePocketCritical) level = "error";
  else if (warningFailedSources.length > 0 || livePocketWarning || status.status === "degraded") level = "warning";

  const annotations = [];
  for (const source of failedSources) {
    const sourceLevel = source.severity === "warning" ? "warning" : "error";
    annotations.push({
      level: sourceLevel,
      title: sourceLevel === "warning"
        ? `取得元警告: ${source.name || "不明"}`
        : `取得元エラー: ${source.name || "不明"}`,
      message: source.error || "原因不明の取得エラー",
    });
  }
  if (livePocketCritical) {
    annotations.push({
      level: "error",
      title: "LivePocket自動発見エラー",
      message: `状態: ${livePocketStatus}／候補 ${number(livePocket.candidateLinkCount)}件／解析 ${number(livePocket.parsedItemCount)}件`,
    });
  } else if (livePocketWarning) {
    annotations.push({
      level: "warning",
      title: "LivePocket自動発見の確認が必要",
      message: `状態: ${livePocketStatus}／検索ページ内リンク ${number(livePocket.searchPageLinkCount)}件／候補 ${number(livePocket.candidateLinkCount)}件`,
    });
  }

  const failedSourceLines = failedSources.length
    ? [
        "",
        "## 失敗した取得元",
        "",
        ...failedSources.map((source) => `- ${source.severity === "warning" ? "⚠️" : "❌"} **${md(source.name || "不明")}**: ${md(source.error || "原因不明")}`),
      ]
    : [];

  const lines = [
    "# Pokeca Life 収集結果",
    "",
    `- 総合状態: **${status.status || "unknown"}**`,
    `- コレクター: **v${status.collectorVersion || "unknown"}**`,
    `- 公開件数: **${number(status.publishedCount)}件**`,
    `- 確認待ち: **${number(status.reviewCount)}件**`,
    `- 取得元: **成功 ${number(status.successfulSourceCount)} / 失敗 ${number(status.failedSourceCount)}**`,
    ...failedSourceLines,
    "",
    "## LivePocket自動発見",
    "",
    `- 状態: **${livePocketStatus}**`,
    `- 検索元: ${number(livePocket.successfulSearchSourceCount)}成功 / ${number(livePocket.failedSearchSourceCount)}失敗`,
    `- 検索ページ内リンク: ${number(livePocket.searchPageLinkCount)}件`,
    `- 抽選候補リンク: ${number(livePocket.candidateLinkCount)}件`,
    `- 候補ページ取得: ${number(livePocket.candidateFetchSuccessCount)}成功 / ${number(livePocket.candidateFetchFailureCount)}失敗`,
    `- 関連ページ: ${number(livePocket.relevantPageCount)}件`,
    `- 解析できた抽選: ${number(livePocket.parsedItemCount)}件`,
    "",
    "## 取得元別診断",
    "",
    "| 状態 | 取得元 | 公開候補 | 発見候補 | 関連ページ | 理由・エラー |",
    "|---|---|---:|---:|---:|---|",
  ];

  for (const source of diagnostics) {
    lines.push(
      `| ${source.status === "failed" && source.severity === "warning" ? "⚠️" : statusMark(source.status)} | ${md(source.name)} | ${number(source.itemCount)} | ${number(source.discovery?.returnedCount)} | ${number(source.relevantPageCount)} | ${md(source.error || source.zeroItemReason)} |`
    );
  }

  if (!diagnostics.length) {
    lines.push("| ⚠️ | 診断情報なし | 0 | 0 | 0 | v1.21.1実行後に表示されます | ");
  }

  lines.push(
    "",
    level === "error"
      ? "**判定: 収集処理は完走しましたが、失敗があるためWorkflowを失敗扱いにします。診断JSONは保存済みです。**"
      : level === "warning"
        ? "**判定: 収集・公開データ更新は完了しました。取得元の一部に警告がありますが、Workflowは成功扱いです。**"
        : "**判定: 取得元・自動発見とも正常です。**",
    ""
  );

  return {
    level,
    exitCode: level === "error" ? 1 : 0,
    annotations,
    markdown: `${lines.join("\n")}\n`,
  };
}
