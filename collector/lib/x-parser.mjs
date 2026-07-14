import crypto from "node:crypto";
import { parseDateRange } from "./dates.mjs";

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

function inferShop(text, authorName) {
  if (/Amazon|アマゾン/i.test(text)) return "Amazon.co.jp";
  if (/ポケモンセンターオンライン|ポケセンオンライン/i.test(text)) return "ポケモンセンターオンライン";
  if (/楽天ブックス/i.test(text)) return "楽天ブックス";
  if (/セブンネット/i.test(text)) return "セブンネットショッピング";
  if (/あみあみ/i.test(text)) return "あみあみ";
  if (/ヤマダ/i.test(text)) return "ヤマダウェブコム";
  if (/ノジマ/i.test(text)) return "ノジマオンライン";
  if (/ホビーステーション|ホビステ/i.test(text)) return "ホビーステーション";
  if (/カードラボ/i.test(text)) return "カードラボ";
  if (/フタバ図書/i.test(text)) return "フタバ図書";
  return authorName || "X情報";
}

function inferProduct(text) {
  const cleaned = cleanText(text);
  const quoted = cleaned.match(/[「『](.{3,80}?)[」』]/);
  if (quoted) return quoted[1].trim();

  const lines = String(text).split(/\n+/).map(cleanText).filter(Boolean);
  const candidate = lines.find((line) =>
    /ポケモンカード|ポケカ|拡張パック|ハイクラスパック|スタートデッキ|BOX|ボックス|セット|MEGA/i.test(line)
  );
  return (candidate || cleaned).slice(0, 120) || "ポケモンカード抽選";
}

function inferArea(text) {
  return PREFECTURES.find((prefecture) => text.includes(prefecture)) || "全国";
}

function inferType(text) {
  return /店頭|店舗|受取店舗|店頭受取/.test(text) ? "店舗" : "通販";
}

function extractPeriod(text, labels) {
  const lines = String(text).split(/\n+/);
  const line = lines.find((value) => labels.some((label) => value.includes(label)));
  return parseDateRange(line || text);
}

function directLink(post) {
  const urls = post?.entities?.urls || [];
  const preferred = urls.find((item) =>
    /livepocket|entry|lottery|campaign|form|apply|amazon|pokemoncenter|rakuten|7net|amiami/i.test(
      item.expanded_url || item.unwound_url || item.url || ""
    )
  );
  const first = preferred || urls[0];
  return first?.unwound_url || first?.expanded_url || first?.url || "";
}

export function parseXPost(post, user = {}, knownAccounts = new Set()) {
  const text = String(post?.text || "");
  if (!/(ポケカ|ポケモンカード)/i.test(text)) return null;
  if (!/(抽選|招待リクエスト|応募|予約|当選発表|受付開始)/i.test(text)) return null;

  const username = user.username || "";
  const postUrl = username && post.id ? `https://x.com/${username}/status/${post.id}` : "https://x.com/";
  const actionUrl = directLink(post);
  const apply = extractPeriod(text, ["応募期間", "受付期間", "応募締切", "締切", "受付"]);
  const result = extractPeriod(text, ["当選発表", "結果発表", "抽選結果"]);
  const purchase = extractPeriod(text, ["購入期間", "販売期間", "購入期限"]);

  let confidence = 0.45;
  if (knownAccounts.has(username.toLowerCase())) confidence += 0.18;
  if (actionUrl) confidence += 0.12;
  if (apply.start || apply.end) confidence += 0.12;
  if (/抽選|招待リクエスト/.test(text)) confidence += 0.08;
  if (/ポケモンカード|ポケカ/.test(text)) confidence += 0.05;
  confidence = Math.min(0.97, confidence);

  const shop = inferShop(text, user.name || username);
  const product = inferProduct(text);
  const sourceId = `x-${post.id || hash(text)}`;

  return {
    externalId: sourceId,
    xPostId: post.id || "",
    xAuthor: username,
    sourceKind: "x",
    shop,
    product,
    type: inferType(text),
    area: inferArea(text),
    status: "open",
    url: actionUrl || postUrl,
    sourceUrl: postUrl,
    sourceType: "X",
    destinationType: actionUrl ? "direct" : "x",
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
    instructions: actionUrl ? "" : "Xの投稿内容を確認し、記載された応募方法に従ってください。",
    memo: cleanText(text).slice(0, 300),
  };
}
