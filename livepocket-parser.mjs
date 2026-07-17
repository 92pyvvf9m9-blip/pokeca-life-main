import { htmlToText, normalizeLines } from "./html.mjs";
import { parseDateRange } from "./dates.mjs";
import { inferLotteryLocation } from "./location.mjs";

const PRODUCT_PATTERN = /ポケモンカード|ポケカ|拡張パック|強化拡張パック|ハイクラスパック|スタートデッキ|スペシャル(?:BOX|セット)|プレミアムデッキ|MEGA|デッキビルド|コレクションファイル/i;
const GENERIC_TITLE = /LivePocket|ライブポケット|チケット|抽選販売|応募フォーム|イベント詳細|受付ページ/gi;

function decodeAttribute(value = "") {
  return String(value)
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function metaContent(html, key) {
  const patterns = [
    new RegExp(`<meta[^>]+(?:property|name)=["']${key}["'][^>]+content=["']([^"']+)["']`, "i"),
    new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${key}["']`, "i"),
  ];
  for (const pattern of patterns) {
    const match = String(html).match(pattern);
    if (match) return decodeAttribute(match[1]).trim();
  }
  return "";
}

function documentTitle(html) {
  return metaContent(html, "og:title") || metaContent(html, "twitter:title") || decodeAttribute(String(html).match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || "").trim();
}

function cleanLine(value = "") {
  return String(value)
    .replace(/^【?抽選販売】?\s*/i, "")
    .replace(/^イベント名\s*[:：]\s*/i, "")
    .replace(/^対象商品\s*[:：]\s*/i, "")
    .replace(/\s*[|｜]\s*LivePocket.*$/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

function labeledText(lines, labels, span = 4) {
  const index = lines.findIndex((line) => labels.some((label) => line.includes(label)));
  if (index < 0) return "";
  const output = [lines[index]];
  if (/\d{1,2}(?:月|[\/.-])\d{1,2}/.test(lines[index])) return lines[index];
  const stopPattern = /抽選申込期間|申込期間|応募期間|受付期間|販売期間|受付日時|当選発表|抽選結果|結果発表|当選通知|購入期間|支払期限|決済期限|受取期間/;
  for (let i = index + 1; i < Math.min(lines.length, index + span); i += 1) {
    if (stopPattern.test(lines[i])) break;
    output.push(lines[i]);
    if (/\d{1,2}(?:月|[\/.-])\d{1,2}/.test(lines[i])) break;
  }
  return output.join(" ");
}

function labeledValue(lines, labels) {
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const label = labels.find((candidate) => line.includes(candidate));
    if (!label) continue;
    const sameLine = line.slice(line.indexOf(label) + label.length).replace(/^\s*[:：]\s*/, "").trim();
    if (sameLine) return sameLine;
    if (lines[index + 1]) return lines[index + 1].trim();
  }
  return "";
}

function inferProduct(lines, title) {
  const labeled = labeledValue(lines, ["対象商品", "商品名", "販売商品", "イベント名"]);
  if (PRODUCT_PATTERN.test(labeled)) return cleanLine(labeled).slice(0, 140);

  const titleParts = String(title || "").split(/[|｜]/).map(cleanLine).filter(Boolean);
  const titleProduct = titleParts.find((part) => PRODUCT_PATTERN.test(part));
  if (titleProduct) return titleProduct.replace(GENERIC_TITLE, "").replace(/^[\s:：・-]+|[\s:：・-]+$/g, "").slice(0, 140);

  const candidate = lines.find((line) => PRODUCT_PATTERN.test(line) && line.length >= 4 && line.length <= 180);
  return cleanLine(candidate || title || "ポケモンカード抽選").replace(GENERIC_TITLE, "").trim().slice(0, 140);
}

function inferShop(lines, title, fallbackShop = "") {
  const labeled = labeledValue(lines, ["主催者", "販売元", "運営者", "開催店舗", "店舗名", "主催店舗"]);
  if (labeled && labeled.length <= 100) return cleanLine(labeled);

  const titleParts = String(title || "").split(/[|｜]/).map(cleanLine).filter(Boolean);
  const shopPart = titleParts.find((part) => !PRODUCT_PATTERN.test(part) && !/LivePocket|ライブポケット|抽選販売|受付/i.test(part));
  return shopPart || fallbackShop;
}

export function isLivePocketUrl(value = "") {
  try {
    const host = new URL(value).hostname.toLowerCase();
    return host === "livepocket.jp" || host.endsWith(".livepocket.jp") || host === "livepocket-ticket.jp" || host.endsWith(".livepocket-ticket.jp");
  } catch {
    return false;
  }
}

export function parseLivePocketPage({ html = "", url = "", fallbackShop = "", collectedAt = new Date().toISOString(), storeIndex = [] } = {}) {
  const text = htmlToText(html);
  const lines = normalizeLines(text);
  const title = documentTitle(html);
  const shop = inferShop(lines, title, fallbackShop) || fallbackShop || "LivePocket掲載店舗";
  const product = inferProduct(lines, title);

  const applyText = labeledText(lines, ["抽選申込期間", "申込期間", "応募期間", "受付期間", "販売期間", "受付日時"], 5);
  const resultText = labeledText(lines, ["当選発表", "抽選結果", "結果発表", "当選通知"], 4);
  const purchaseText = labeledText(lines, ["購入期間", "支払期限", "決済期限", "受取期間", "販売期間"], 4);
  const apply = parseDateRange(applyText, new Date(collectedAt));
  const result = parseDateRange(resultText, new Date(collectedAt));
  const purchase = parseDateRange(purchaseText, new Date(collectedAt));
  const location = inferLotteryLocation({
    text: `${title}\n${text}`,
    shop,
    fallbackArea: "全国",
    fallbackType: "",
    storeIndex,
  });

  const hasLotteryLanguage = /抽選|応募|申込|受付/.test(text);
  const hasPokemonProduct = PRODUCT_PATTERN.test(product) || PRODUCT_PATTERN.test(text);

  return {
    ok: hasLotteryLanguage && hasPokemonProduct,
    shop,
    product,
    type: location.type,
    area: location.area,
    url,
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
    rawApplyText: applyText.slice(0, 300),
    rawResultText: resultText.slice(0, 300),
    pageTitle: title,
  };
}
