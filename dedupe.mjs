function clean(value = "") {
  return String(value)
    .toLowerCase()
    .normalize("NFKC")
    .replace(/ポケモンカードゲーム|ポケモンカード|ポケカ|抽選販売|招待リクエスト|予約販売|受付開始|応募開始/g, "")
    .replace(/box|ボックス|シュリンク付き|1箱|一箱/gi, "")
    .replace(/[^a-z0-9ぁ-んァ-ヶ一-龠]+/g, "")
    .trim();
}
function canonicalShop(value = "") {
  const text = clean(value);
  const aliases = [
    [/amazon|アマゾン/, "amazon"], [/pokemoncenter|ポケセン/, "pokemoncenter"], [/楽天ブックス/, "rakutenbooks"],
    [/セブンネット/, "7net"], [/あみあみ/, "amiami"], [/ヤマダ/, "yamada"], [/ノジマ/, "nojima"],
    [/エディオン/, "edion"], [/トレカキャピタル/, "trecacapital"], [/キッズリパブリック/, "kidsrepublic"],
    [/ファミマ/, "famima"], [/コジマ/, "kojima"], [/ホビーステーション|ホビステ/, "hbst"], [/カードラボ/, "cardlabo"]
  ];
  return aliases.find(([re]) => re.test(text))?.[1] || text;
}
function actionHost(item) {
  for (const value of [item.url, item.sourceUrl]) {
    try { const host = new URL(value).hostname.replace(/^www\./, ""); if (!/x\.com$|twitter\.com$/.test(host)) return host; } catch {}
  }
  return "";
}
function keyFor(item) {
  const shop = canonicalShop(item.shop);
  const product = clean(item.product).slice(0, 90);
  const date = item.applyEndDate || item.applyStartDate || item.resultStartDate || "";
  const host = actionHost(item);
  return [shop, product, date || host].join("|");
}
function quality(item) {
  let score = Number(item.confidence || 0);
  if (item.sourceKind !== "x" && item.sourceType !== "X") score += 0.3;
  if (actionHost(item)) score += 0.15;
  if (item.applyEndDate) score += 0.1;
  if (item.resultStartDate) score += 0.05;
  return score;
}
function mergeEvidence(primary, secondary) {
  const kinds = new Set([...(primary.sourceKinds || []), ...(secondary.sourceKinds || []), primary.sourceKind, secondary.sourceKind].filter(Boolean));
  const merged = { ...secondary, ...primary };
  merged.sourceKinds = [...kinds];
  merged.evidenceCount = Number(primary.evidenceCount || 1) + Number(secondary.evidenceCount || 1);
  merged.confidence = Number(Math.min(0.99, Math.max(Number(primary.confidence || 0), Number(secondary.confidence || 0)) + 0.04).toFixed(2));
  return merged;
}
export function dedupeItems(items = []) {
  const map = new Map();
  for (const raw of items) {
    const item = { ...raw, evidenceCount: Number(raw.evidenceCount || 1), sourceKinds: raw.sourceKinds || [raw.sourceKind || (raw.sourceType === "X" ? "x" : "web")] };
    const key = keyFor(item) || item.externalId;
    const existing = map.get(key);
    if (!existing) { map.set(key, item); continue; }
    const primary = quality(item) > quality(existing) ? item : existing;
    const secondary = primary === item ? existing : item;
    map.set(key, mergeEvidence(primary, secondary));
  }
  return [...map.values()];
}
export function sanitizeForPublic(item) {
  const output = { ...item };

  // The public feed contains only user-facing lottery facts and the direct
  // application destination. Discovery provenance remains private.
  const privateKeys = [
    "sourceUrl",
    "sourceType",
    "sourceKind",
    "sourceKinds",
    "intelligenceSource",
    "privateSources",
    "evidenceCount",
    "destinationHost",
    "destinationVerified",
    "destinationVerificationReason",
    "verificationChecks",
    "rawApplyText",
    "rawResultText",
    "xAuthor",
    "xPostId",
    "officialAccount",
    "productCandidates",
    "purchaseStartPolicy",
  ];
  for (const key of privateKeys) delete output[key];

  try {
    const host = output.url ? new URL(output.url).hostname : "";
    if (/x\.com$|twitter\.com$/.test(host) && !output.noticeOnly) output.url = "";
  } catch {
    output.url = "";
  }
  return output;
}
export function keepRelevant(items = [], now = new Date()) {
  const cutoff = new Date(now); cutoff.setDate(cutoff.getDate() - 35);
  return items.filter((item) => {
    const date = item.purchaseEndDate || item.applyEndDate || item.resultStartDate;
    if (!date) return true;
    const parsed = new Date(`${date}T23:59:59+09:00`);
    return Number.isNaN(parsed.getTime()) || parsed >= cutoff;
  });
}
