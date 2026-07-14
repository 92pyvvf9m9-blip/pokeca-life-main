import crypto from "node:crypto";
import { extractLinks, htmlToText, normalizeLines } from "./html.mjs";
import { parseDateRange } from "./dates.mjs";

const STOP_LABELS = [
  "応募期間",
  "抽選期間",
  "受付期間",
  "当選発表",
  "結果発表",
  "購入期間",
  "販売期間",
  "注意事項",
  "応募条件",
  "応募専用",
];

function hash(value) {
  return crypto.createHash("sha256").update(String(value)).digest("hex").slice(0, 24);
}

function cleanProduct(value = "") {
  return String(value)
    .replace(/^【?抽選販売】?/, "")
    .replace(/^\[?抽選販売\]?/, "")
    .replace(/^\s*対象商品\s*[:：]\s*/, "")
    .replace(/\s+/g, " ")
    .trim();
}

function isPokemonCard(value = "") {
  return /ポケモンカード|ポケカ|MEGA|拡張パック|ハイクラスパック|スタートデッキ|スペシャルセット|プレミアムデッキ/i.test(value);
}

function productLinesAfterLabel(lines, labelPattern) {
  const index = lines.findIndex((line) => labelPattern.test(line));
  if (index < 0) return [];

  const sameLine = lines[index].replace(labelPattern, "").replace(/^[:：]/, "").trim();
  const products = sameLine ? [sameLine] : [];

  for (let i = index + 1; i < Math.min(lines.length, index + 15); i += 1) {
    const line = lines[i].trim();
    if (STOP_LABELS.some((label) => line.startsWith(label))) break;
    if (line.length > 2 && isPokemonCard(line)) products.push(line);
  }

  return [...new Set(products.map(cleanProduct).filter((x) => x.length > 2))];
}

function labelText(lines, labels) {
  const index = lines.findIndex((line) => labels.some((label) => line.includes(label)));
  if (index < 0) return "";

  const output = [lines[index]];
  for (let i = index + 1; i < Math.min(lines.length, index + 4); i += 1) {
    if (STOP_LABELS.some((label) => lines[i].startsWith(label))) break;
    output.push(lines[i]);
  }
  return output.join(" ");
}

function bestActionUrl(html, sourceUrl) {
  const links = extractLinks(html, sourceUrl);
  const preferred = links.find((link) => /応募|抽選へ進む|エントリー|申し込/.test(link.text));
  return preferred?.url || sourceUrl;
}

function buildRecord({ source, product, applyText, resultText, purchaseText, html, collectedAt, actionUrlOverride = "", shopOverride = "", typeOverride = "", areaOverride = "" }) {
  const apply = parseDateRange(applyText);
  const result = parseDateRange(resultText);
  const purchase = parseDateRange(purchaseText);
  const actionUrl = actionUrlOverride || bestActionUrl(html, source.url);
  const externalId = hash([
    source.id,
    product,
    apply.start?.date || "",
    apply.end?.date || "",
    actionUrl,
  ].join("|"));

  let confidence = 0.55;
  if (source.officialDomains?.some((domain) => new URL(source.url).hostname.endsWith(domain))) confidence += 0.2;
  if (product && isPokemonCard(product)) confidence += 0.1;
  if (apply.start || apply.end) confidence += 0.1;
  if (result.start || result.end) confidence += 0.03;
  if (purchase.start || purchase.end) confidence += 0.02;
  confidence = Math.min(0.99, confidence);

  return {
    externalId,
    shop: shopOverride || source.name,
    product: cleanProduct(product),
    type: typeOverride || source.type || "通販",
    area: areaOverride || source.area || "全国",
    status: "open",
    url: actionUrl,
    sourceUrl: source.url,
    sourceType: source.publicSourceType || source.sourceType || "公式サイト",
    sourceKind: source.sourceKind || "web",
    intelligenceSource: source.sourceKind === "intelligence" ? source.id : "",
    verified: confidence >= 0.8,
    confidence: Number(confidence.toFixed(2)),
    collectedAt,
    updatedAt: collectedAt,
    applyStartDate: apply.start?.date || "",
    applyStartTime: apply.start?.time || "",
    applyEndDate: apply.end?.date || "",
    applyEndTime: apply.end?.time || "",
    resultStartDate: result.start?.date || "",
    resultStartTime: result.start?.time || "",
    resultEndDate: result.end?.date || "",
    resultEndTime: result.end?.time || "",
    purchaseStartDate: purchase.start?.date || "",
    purchaseStartTime: purchase.start?.time || "",
    purchaseEndDate: purchase.end?.date || "",
    purchaseEndTime: purchase.end?.time || "",
    destinationType: source.destinationType || "direct",
    appName: source.appName || "",
    appUrl: source.appUrl || "",
    fallbackUrl: source.fallbackUrl || "",
    instructions: source.instructions || "",
    rawApplyText: String(applyText || "").slice(0, 300),
    rawResultText: String(resultText || "").slice(0, 300),
    memo: "",
  };
}

function parseAmiAmi(source, html, collectedAt) {
  const text = htmlToText(html);
  const sections = text
    .split(/(?=【抽選販売】|\[抽選販売\])/)
    .filter((section) => /抽選販売/.test(section) && isPokemonCard(section));

  const records = [];
  for (const section of sections) {
    const lines = normalizeLines(section);
    const title = cleanProduct(lines[0] || "");
    let products = productLinesAfterLabel(lines, /^対象商品\s*[:：]?/);
    if (!products.length && title) products = [title];

    const applyText = labelText(lines, ["応募期間", "抽選期間", "受付期間"]);
    const resultText = labelText(lines, ["当選発表", "結果発表"]);
    const purchaseText = labelText(lines, ["購入期間", "販売期間"]);

    for (const product of products.slice(0, 12)) {
      records.push(buildRecord({ source, product, applyText, resultText, purchaseText, html, collectedAt }));
    }
  }
  return records;
}

function parseRakutenBooks(source, html, collectedAt) {
  const text = htmlToText(html);
  if (!/ポケモンカードゲーム/.test(text) || !/抽選/.test(text)) return [];

  const lines = normalizeLines(text);
  let products = productLinesAfterLabel(lines, /^対象商品\s*[:：]?/);
  if (!products.length) {
    products = lines.filter((line) => isPokemonCard(line) && line.length < 140).slice(0, 12);
  }

  const applyText = labelText(lines, ["応募期間", "抽選受付期間", "エントリー期間"]);
  const resultText = labelText(lines, ["当選発表", "抽選結果"]);
  const purchaseText = labelText(lines, ["購入期間", "注文期間"]);

  return [...new Set(products)]
    .slice(0, 12)
    .map((product) => buildRecord({ source, product, applyText, resultText, purchaseText, html, collectedAt }));
}


function parseHobbySearch(source, html, collectedAt) {
  const text = htmlToText(html);
  if (!/ポケモンカード|ポケカ/i.test(text) || !/抽選/.test(text)) return [];

  const lines = normalizeLines(text);
  const candidates = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (!isPokemonCard(line) || line.length > 180) continue;
    if (!/拡張パック|ハイクラスパック|スタートデッキ|BOX|ボックス|セット|パック|MEGA/i.test(line)) continue;

    const nearby = lines.slice(Math.max(0, index - 2), Math.min(lines.length, index + 8));
    if (!nearby.some((value) => /抽選|応募/.test(value))) continue;

    const product = cleanProduct(line);
    const applyText =
      nearby.find((value) =>
        /抽選受付期間|応募期間|受付期間|抽選締切|応募締切/.test(value)
      ) || nearby.join(" ");

    const resultText =
      nearby.find((value) =>
        /当選発表|結果発表|当選通知/.test(value)
      ) || "";

    const purchaseText =
      nearby.find((value) =>
        /購入期間|注文期間|販売期間/.test(value)
      ) || "";

    candidates.push(
      buildRecord({
        source,
        product,
        applyText,
        resultText,
        purchaseText,
        html,
        collectedAt,
      })
    );
  }

  const unique = new Map();
  for (const item of candidates) {
    const key = `${item.product}|${item.applyEndDate}|${item.url}`;
    if (!unique.has(key)) unique.set(key, item);
  }
  return [...unique.values()].slice(0, 20);
}


function relativeDeadline(text, collectedAt) {
  const base = new Date(collectedAt);
  const value = String(text || "");
  const time = value.match(/(\d{1,2}):(\d{2})/);
  const format = (date) => ({
    date: `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,"0")}-${String(date.getDate()).padStart(2,"0")}`,
    time: time ? `${String(Number(time[1])).padStart(2,"0")}:${time[2]}` : "23:59",
  });
  if (/本日|今日/.test(value)) return format(base);
  if (/明日/.test(value)) { const next = new Date(base); next.setDate(next.getDate()+1); return format(next); }
  const parsed = parseDateRange(`締切 ${value}`, base);
  return parsed.end || parsed.start;
}

function parseListingIntelligence(source, html, collectedAt) {
  const records = [];
  const linkRegex = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let match;
  while ((match = linkRegex.exec(String(html)))) {
    const label = htmlToText(match[2]);
    if (!/応募ページ|応募フォーム|抽選ページ|エントリー/.test(label)) continue;
    let actionUrl = "";
    try { actionUrl = new URL(match[1], source.url).href; } catch { continue; }
    const snippet = htmlToText(String(html).slice(Math.max(0, match.index - 2600), match.index));
    const lines = normalizeLines(snippet).slice(-20);
    const shopIndex = lines.findLastIndex((line) => /・\s*ポケカ/.test(line));
    const shopLine = shopIndex >= 0 ? lines[shopIndex] : "";
    const shop = shopLine ? shopLine.replace(/・\s*ポケカ.*$/, "").trim() : "";
    const deadlineLine = [...lines].reverse().find((line) => /本日|今日|明日|\d{1,2}[\/]\d{1,2}|\d{1,2}月\d{1,2}日|締切/.test(line));
    const beforeShop = shopIndex >= 0 ? lines.slice(Math.max(0, shopIndex - 8), shopIndex) : lines;
    const typeLine = [...beforeShop].reverse().find((line) => /オンライン|店頭/.test(line)) || "";
    const product = [...beforeShop].reverse().find((line) =>
      !/オンライン|店頭|アプリ|会員|本人確認|SNS応募|ポケモンカードの抽選|主要拡張パック|全\d+件|抽選方法|・\s*ポケカ/.test(line) &&
      !/残り\s*\d+/.test(line) &&
      line.length >= 3 && line.length < 130
    );
    if (!shop || !product || !deadlineLine) continue;
    const deadline = relativeDeadline(deadlineLine, collectedAt);
    if (!deadline) continue;
    const applyText = `締切 ${deadline.date} ${deadline.time}`;
    const record = buildRecord({
      source,
      product,
      applyText,
      resultText: "",
      purchaseText: "",
      html,
      collectedAt,
      actionUrlOverride: actionUrl,
      shopOverride: shop,
      typeOverride: /店頭/.test(typeLine) ? "店舗" : "通販",
    });
    record.sourceKind = "aggregated";
    record.sourceType = "情報収集";
    record.confidence = 0.64;
    record.verified = false;
    record.intelligenceSource = source.id;
    record.rawApplyText = deadlineLine;
    records.push(record);
  }
  const unique = new Map();
  for (const item of records) {
    const key = `${item.shop}|${item.product}|${item.applyEndDate}|${item.url}`;
    if (!unique.has(key)) unique.set(key, item);
  }
  return [...unique.values()].slice(0, 150);
}

function parseGeneric(source, html, collectedAt) {
  const text = htmlToText(html);
  if (!source.keywords?.every((word) => text.includes(word))) return [];
  const lines = normalizeLines(text);
  const products = lines.filter((line) => isPokemonCard(line) && line.length < 140).slice(0, 8);
  const applyText = labelText(lines, ["応募期間", "抽選期間", "受付期間"]);
  const resultText = labelText(lines, ["当選発表", "結果発表"]);
  const purchaseText = labelText(lines, ["購入期間", "販売期間"]);

  return products.map((product) =>
    buildRecord({ source, product, applyText, resultText, purchaseText, html, collectedAt })
  );
}

export function parseSourceDocument(source, html, collectedAt = new Date().toISOString()) {
  if (source.parser === "amiami") return parseAmiAmi(source, html, collectedAt);
  if (source.parser === "rakuten-books") return parseRakutenBooks(source, html, collectedAt);
  if (source.parser === "hobby-search") return parseHobbySearch(source, html, collectedAt);
  if (source.parser === "listing-intelligence-v1") return parseListingIntelligence(source, html, collectedAt);
  return parseGeneric(source, html, collectedAt);
}
