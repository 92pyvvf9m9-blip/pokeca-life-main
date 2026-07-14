import fs from "node:fs/promises";

function normalize(value = "") {
  return String(value)
    .normalize("NFKC")
    .toLowerCase()
    .replace(/ポケモンカードゲーム|ポケモンカード|ポケカ/g, "")
    .replace(/抽選販売|予約販売|招待リクエスト|応募受付|box|ボックス|1箱|一箱/gi, "")
    .replace(/[^a-z0-9ぁ-んァ-ヶ一-龠]+/g, "")
    .trim();
}

function validDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ""))) return false;
  const date = new Date(`${value}T12:00:00+09:00`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function dateValue(value, endOfDay = false) {
  if (!validDate(value)) return NaN;
  return new Date(`${value}T${endOfDay ? "23:59:59" : "00:00:00"}+09:00`).getTime();
}

function weekdayFromText(text = "") {
  const matches = [...String(text).matchAll(/(\d{1,2})[\/月](\d{1,2})日?\s*[（(]([日月火水木金土])[)）]/g)];
  const match = matches.at(-1);
  return match ? { month: Number(match[1]), day: Number(match[2]), weekday: match[3] } : null;
}

function weekdayMatches(text, dateText) {
  const token = weekdayFromText(text);
  if (!token || !validDate(dateText)) return true;
  const date = new Date(`${dateText}T12:00:00+09:00`);
  const labels = ["日", "月", "火", "水", "木", "金", "土"];
  return token.month === date.getMonth() + 1 && token.day === date.getDate() && labels[date.getDay()] === token.weekday;
}

function directHost(candidate) {
  try { return new URL(candidate.url || "").hostname.replace(/^www\./, ""); } catch { return ""; }
}

export async function loadProductCatalog(path) {
  try {
    const payload = JSON.parse(await fs.readFile(path, "utf8"));
    return Array.isArray(payload.products) ? payload.products : [];
  } catch { return []; }
}

export function matchCatalogProduct(value, products = []) {
  const target = normalize(value);
  if (!target || target.length < 3) return null;
  let best = null;
  for (const product of products) {
    for (const label of [product.name, ...(product.aliases || [])]) {
      const key = normalize(label);
      if (!key) continue;
      const exact = target === key;
      const contains = key.length >= 4 && (target.includes(key) || key.includes(target));
      if (!exact && !contains) continue;
      const score = exact ? 1000 + key.length : key.length;
      if (!best || score > best.score) best = { product, score };
    }
  }
  return best?.product || null;
}

export function evaluateCandidate(candidate, products = [], now = new Date(), options = {}) {
  const reasons = [];
  const warnings = [];
  const catalogProduct = matchCatalogProduct(candidate.product, products);
  if (!catalogProduct) reasons.push("公式商品カタログと一致しません");

  if (!candidate.applyEndDate || !validDate(candidate.applyEndDate)) {
    reasons.push("応募締切を確定できません");
  }

  const start = dateValue(candidate.applyStartDate);
  const end = dateValue(candidate.applyEndDate, true);
  if (Number.isFinite(start) && Number.isFinite(end) && start > end) {
    reasons.push("応募開始日が締切日より後です");
  }

  const nowMs = now.getTime();
  if (Number.isFinite(end)) {
    const oldest = nowMs - 35 * 86400000;
    const farFuture = nowMs + 365 * 86400000;
    if (end < oldest) reasons.push("履歴保持期間を超えています");
    if (end > farFuture) reasons.push("締切日が遠すぎます");
  }

  if (candidate.rawApplyText && candidate.applyEndDate && !weekdayMatches(candidate.rawApplyText, candidate.applyEndDate)) {
    reasons.push("日付と曜日が一致しません");
  }

  const host = directHost(candidate);
  if (!host) reasons.push("応募先URLがありません");
  const blockedDestinationDomains = new Set(
    (options.blockedDestinationDomains || [])
      .map((value) => String(value || "").toLowerCase().replace(/^www\./, ""))
      .filter(Boolean)
  );
  const blockedDestination = [...blockedDestinationDomains].some(
    (domain) => host === domain || host.endsWith(`.${domain}`)
  );
  if (blockedDestination) reasons.push("直接応募先ではないページです");
  let discoveryHost = "";
  try { discoveryHost = new URL(candidate.sourceUrl || "").hostname.replace(/^www\./, ""); } catch {}
  const aggregated = candidate.sourceKind === "aggregated" || candidate.sourceKind === "intelligence";
  const isDiscoveryPage = Boolean(aggregated && discoveryHost && host === discoveryHost);
  if (isDiscoveryPage || blockedDestination || /x\.com$|twitter\.com$/.test(host)) {
    reasons.push("発見元ではなく直接応募先の確認が必要です");
  }

  if (aggregated && !candidate.destinationVerified) reasons.push("直接応募先を再確認できません");
  if (!aggregated && candidate.destinationVerified === false) warnings.push("応募先ページの再確認に失敗しました");

  const accepted = reasons.length === 0;
  return {
    accepted,
    reasons,
    warnings,
    catalogProduct,
    catalogProductId: catalogProduct?.id || "",
    directHost: host,
    checks: {
      productMatched: Boolean(catalogProduct),
      deadlineConfirmed: Boolean(candidate.applyEndDate && validDate(candidate.applyEndDate)),
      directDestination: Boolean(host && !isDiscoveryPage && !blockedDestination && !/x\.com$|twitter\.com$/.test(host)),
      destinationVerified: aggregated ? Boolean(candidate.destinationVerified) : candidate.destinationVerified !== false,
    },
  };
}
