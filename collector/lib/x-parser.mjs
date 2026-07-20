import crypto from "node:crypto";
import { parseDateRange } from "./dates.mjs";
import { enrichAppDestination } from "./app-destination.mjs";

const PREFECTURES = [
  "北海道","青森県","岩手県","宮城県","秋田県","山形県","福島県",
  "茨城県","栃木県","群馬県","埼玉県","千葉県","東京都","神奈川県",
  "新潟県","富山県","石川県","福井県","山梨県","長野県","岐阜県",
  "静岡県","愛知県","三重県","滋賀県","京都府","大阪府","兵庫県",
  "奈良県","和歌山県","鳥取県","島根県","岡山県","広島県","山口県",
  "徳島県","香川県","愛媛県","高知県","福岡県","佐賀県","長崎県",
  "熊本県","大分県","宮崎県","鹿児島県","沖縄県"
];

function hash(value) {
  return crypto.createHash("sha256").update(String(value)).digest("hex").slice(0, 24);
}

function cleanText(value = "") {
  return String(value)
    .replace(/https?:\/\/\S+/g, "")
    .replace(/@[A-Za-z0-9_]+/g, "")
    .replace(/#[^\s#]+/g, "")
    .replace(/[【】\[\]]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizedAccountMeta(accountMetadata, username) {
  if (accountMetadata instanceof Map) return accountMetadata.get(String(username || "").toLowerCase()) || null;
  if (accountMetadata && typeof accountMetadata === "object") return accountMetadata[String(username || "").toLowerCase()] || null;
  return null;
}

function inferShop(text, authorName) {
  const context = `${text}\n${authorName || ""}`;
  if (/Amazon|アマゾン/i.test(context)) return "Amazon.co.jp";
  if (/ポケモンセンターオンライン|ポケセンオンライン/i.test(context)) return "ポケモンセンターオンライン";
  if (/楽天ブックス/i.test(context)) return "楽天ブックス";
  if (/セブンネット/i.test(context)) return "セブンネットショッピング";
  if (/あみあみ/i.test(context)) return "あみあみ";
  if (/ヤマダ/i.test(context)) return "ヤマダデンキ";
  if (/ノジマ/i.test(context)) return "ノジマ";
  if (/ホビーステーション|ホビステ/i.test(context)) return authorName || "ホビーステーション";
  if (/イエローサブマリン|イエサブ/i.test(context)) return authorName || "イエローサブマリン";
  if (/ビックカメラ|ビック\s*カメラ/i.test(context)) return authorName || "ビックカメラ";
  if (/古本市場|ふるいち/i.test(context)) return authorName || "ふるいち";
  if (/カードラボ/i.test(context)) return authorName || "カードラボ";
  if (/フタバ図書/i.test(context)) return authorName || "フタバ図書";
  return authorName || "X情報";
}

function productCandidateLooksUseful(value = "") {
  const text = cleanText(value);
  if (text.length < 2 || text.length > 120) return false;
  if (/応募|抽選|受付|販売方法|お知らせ|注意|当選|期間|購入権/.test(text)) return false;
  return /ポケモンカード|ポケカ|拡張パック|強化拡張パック|ハイクラスパック|スタートデッキ|スターターセット|スペシャルセット|BOX|ボックス|MEGA|ex/i.test(text)
    || /^[ァ-ヶーA-Za-z0-9＆・\s]{3,60}$/.test(text);
}

function inferProductCandidates(text) {
  const cleaned = cleanText(text);
  const output = [];
  const add = (value) => {
    const candidate = cleanText(value).replace(/^対象(?:商品)?\s*[:：]?\s*/, "").trim();
    if (!productCandidateLooksUseful(candidate) || output.includes(candidate)) return;
    output.push(candidate);
  };

  for (const match of String(text).matchAll(/[「『](.{2,100}?)[」』]/g)) add(match[1]);

  const lines = String(text).split(/\n+/).map(cleanText).filter(Boolean);
  for (const line of lines) {
    if (/ポケモンカード|ポケカ|拡張パック|ハイクラスパック|スタートデッキ|スターターセット|MEGA/i.test(line)) {
      const stripped = line
        .replace(/^.*?(?:対象商品|対象|商品)\s*[:：]\s*/, "")
        .replace(/^(?:抽選販売|抽選受付|予約抽選)[^：:]*[:：]?\s*/, "")
        .trim();
      add(stripped);
    }
  }
  if (!output.length) add(cleaned.slice(0, 120));
  return output.slice(0, 12);
}

function inferArea(text, authorName = "") {
  const context = `${text}\n${authorName}`;
  return PREFECTURES.find((prefecture) => context.includes(prefecture)) || "全国";
}

function inferType(text, authorName = "") {
  const context = `${text}\n${authorName}`;
  return /店頭|店舗|受取店舗|店頭受取|イエローサブマリン|イエサブ|ビックカメラ|古本市場|ふるいち|ホビーステーション|ホビステ/.test(context)
    ? "店舗"
    : "通販";
}

function extractPeriod(text, labels, base = new Date()) {
  const lines = String(text).split(/\n+/);
  const index = lines.findIndex((value) => labels.some((label) => value.includes(label)));
  if (index < 0) return parseDateRange(text, base);
  return parseDateRange(lines.slice(index, index + 3).join(" "), base);
}

function candidateUrl(item) {
  return item?.unwound_url || item?.expanded_url || item?.url || "";
}

function isXInternalUrl(url = "") {
  try {
    const host = new URL(url).hostname.replace(/^www\./, "");
    return /(^|\.)x\.com$|(^|\.)twitter\.com$|(^|\.)pic\.twitter\.com$/.test(host);
  } catch { return true; }
}

function directLink(post) {
  const urls = (post?.entities?.urls || [])
    .map(candidateUrl)
    .filter(Boolean)
    .filter((url) => !isXInternalUrl(url));
  const preferred = urls.find((url) =>
    /livepocket|passmarket|entry|lottery|campaign|form|apply|amazon|pokemoncenter|rakuten|7net|amiami/i.test(url)
  );
  return preferred || urls[0] || "";
}

function storeOnlyNotice(text = "") {
  return /店頭(?:掲示|ポスター|QR|ＱＲ|受付)|受付QRコードは店頭|店頭のみ|レジにて受付|店舗で受付|申込用紙/.test(String(text));
}

function officialInstructions(text, shop) {
  if (/店頭(?:掲示|ポスター)/.test(text)) return "店舗に掲示された案内・ポスターから応募方法を確認してください。";
  if (/QR|ＱＲ/.test(text)) return "店舗で公開されるQRコードから応募してください。";
  if (/ビックカメラ/.test(shop)) return "対象店舗の店頭で抽選受付方法を確認してください。";
  return "公式Xの投稿を確認し、記載された店頭受付方法に従ってください。";
}

export function parseXPost(post, user = {}, knownAccounts = new Set(), accountMetadata = new Map()) {
  const text = String(post?.text || "");
  if (!/(ポケカ|ポケモンカード)/i.test(text)) return null;
  if (!/(抽選|招待リクエスト|応募|予約|当選発表|受付開始|購入権)/i.test(text)) return null;

  const username = user.username || "";
  const authorName = user.name || username;
  const accountMeta = normalizedAccountMeta(accountMetadata, username);
  const officialAccount = Boolean(accountMeta?.official);
  const postUrl = username && post.id ? `https://x.com/${username}/status/${post.id}` : "https://x.com/";
  const foundActionUrl = directLink(post);
  const storeNotice = storeOnlyNotice(text);
  const noticeOnly = officialAccount && (!foundActionUrl || storeNotice);
  const actionUrl = noticeOnly ? "" : foundActionUrl;
  const dateBase = post.created_at ? new Date(post.created_at) : new Date();
  const apply = extractPeriod(text, ["応募期間", "抽選受付期間", "受付期間", "応募締切", "締切", "受付"], dateBase);
  const result = extractPeriod(text, ["当選発表", "結果発表", "抽選結果"], dateBase);
  const purchase = extractPeriod(text, ["購入期間", "販売期間", "購入期限", "受取期間"], dateBase);

  let confidence = 0.45;
  if (knownAccounts.has(username.toLowerCase())) confidence += 0.18;
  if (officialAccount) confidence += 0.12;
  if (actionUrl) confidence += 0.12;
  if (apply.start || apply.end) confidence += 0.12;
  if (/抽選|招待リクエスト/.test(text)) confidence += 0.08;
  if (/ポケモンカード|ポケカ/.test(text)) confidence += 0.05;
  confidence = Math.min(0.99, confidence);

  const shop = accountMeta?.label || inferShop(text, authorName);
  const products = inferProductCandidates(text);
  const product = products[0] || "ポケモンカード抽選";
  const sourceId = `x-${post.id || hash(text)}`;
  const destinationType = noticeOnly ? (storeNotice ? "store" : "x") : (actionUrl ? "direct" : "x");

  return enrichAppDestination({
    externalId: sourceId,
    xPostId: post.id || "",
    xAuthor: username,
    sourceKind: "x",
    shop,
    product,
    productCandidates: products,
    type: inferType(text, authorName),
    area: accountMeta?.area || inferArea(text, authorName),
    status: "open",
    url: actionUrl || postUrl,
    sourceUrl: postUrl,
    sourceType: officialAccount ? "公式X" : "X",
    destinationType,
    fallbackUrl: noticeOnly ? postUrl : "",
    noticeOnly,
    officialNotice: noticeOnly,
    officialAccount,
    verified: confidence >= 0.8,
    confidence: Number(confidence.toFixed(2)),
    collectedAt: post.created_at || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
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
    instructions: noticeOnly ? officialInstructions(text, shop) : (actionUrl ? "" : "Xの投稿内容を確認し、記載された応募方法に従ってください。"),
    memo: cleanText(text).slice(0, 300),
  }, text);
}
