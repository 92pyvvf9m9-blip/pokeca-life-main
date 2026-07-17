import crypto from "node:crypto";
import { parseDateRange } from "./dates.mjs";
import { inferLotteryLocation } from "./location.mjs";

const PRODUCT_PATTERN = /ポケモンカード|ポケカ|拡張パック|強化拡張パック|ハイクラスパック|スタートデッキ|スペシャル(?:BOX|セット)|プレミアムデッキ|MEGA|デッキビルド|コレクションファイル/i;
const LOTTERY_PATTERN = /抽選|招待リクエスト|応募|予約|当選発表|受付開始|受付中|申込|エントリー|LivePocket|ライブポケット/i;

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
  if (/ヤマダ(?:ウェブコム|デンキ)?/i.test(text)) return /オンライン|ウェブコム/i.test(text) ? "ヤマダウェブコム" : "ヤマダデンキ";
  if (/ノジマ(?:オンライン)?/i.test(text)) return /オンライン/i.test(text) ? "ノジマオンライン" : "ノジマ";
  if (/ホビーステーション|ホビステ/i.test(text)) return cleanText(text.match(/(?:ホビーステーション|ホビステ)[^\n。、]{0,24}/i)?.[0] || "ホビーステーション");
  if (/カードラボ/i.test(text)) return cleanText(text.match(/カードラボ[^\n。、]{0,24}/i)?.[0] || "カードラボ");
  if (/フタバ図書/i.test(text)) return cleanText(text.match(/フタバ図書[^\n。、]{0,30}/i)?.[0] || "フタバ図書");
  if (/レプトン/i.test(text)) return cleanText(text.match(/レプトン[^\n。、]{0,24}/i)?.[0] || "レプトン");
  if (/カードボックス|CARD BOX/i.test(text)) return cleanText(text.match(/(?:カードボックス|CARD BOX)[^\n。、]{0,24}/i)?.[0] || "カードボックス");
  if (/バトロコ/i.test(text)) return cleanText(text.match(/バトロコ[^\n。、]{0,30}/i)?.[0] || "バトロコ");
  if (/TierOne/i.test(text)) return cleanText(text.match(/TierOne[^\n。、]{0,30}/i)?.[0] || "TierOne");
  if (/TCG SHOP193/i.test(text)) return cleanText(text.match(/TCG SHOP193[^\n。、]{0,30}/i)?.[0] || "TCG SHOP193");
  return cleanText(authorName || "X情報").slice(0, 80) || "X情報";
}

function inferProduct(text) {
  const cleaned = cleanText(text);
  const quoted = cleaned.match(/[「『](.{3,100}?)[」』]/);
  if (quoted && PRODUCT_PATTERN.test(quoted[1])) return quoted[1].trim();

  const lines = String(text).split(/\n+/).map(cleanText).filter(Boolean);
  const candidate = lines.find((line) => PRODUCT_PATTERN.test(line) && line.length <= 180);
  if (!candidate) return cleaned.slice(0, 120) || "ポケモンカード抽選";

  return candidate
    .replace(/^(?:抽選|応募|予約|受付)(?:販売|開始|受付)?\s*[:：-]?\s*/i, "")
    .replace(/(?:の)?(?:抽選|招待リクエスト|応募|予約)(?:受付|販売)?(?:を)?(?:開始|実施|開催|受付中).*$/i, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 140);
}

function extractPeriod(text, labels) {
  const lines = String(text).split(/\n+/);
  const index = lines.findIndex((value) => labels.some((label) => value.includes(label)));
  if (index < 0) return parseDateRange("");
  return parseDateRange(lines.slice(index, index + 3).join(" "));
}

function directLink(post) {
  const urls = post?.entities?.urls || [];
  const preferred = urls.find((item) =>
    /livepocket|entry|lottery|campaign|form|apply|amazon|pokemoncenter|rakuten|7net|amiami|ticket/i.test(
      item.expanded_url || item.unwound_url || item.url || ""
    )
  );
  const first = preferred || urls[0];
  return first?.unwound_url || first?.expanded_url || first?.url || "";
}

export function parseXPost(post, user = {}, knownAccounts = new Set(), options = {}) {
  const text = String(post?.text || "");
  const username = String(user.username || "");
  const knownAccount = knownAccounts.has(username.toLowerCase());
  if (!PRODUCT_PATTERN.test(text) && !knownAccount) return null;
  if (!LOTTERY_PATTERN.test(text)) return null;

  const postUrl = username && post.id ? `https://x.com/${username}/status/${post.id}` : "https://x.com/";
  const actionUrl = directLink(post);
  const apply = extractPeriod(text, ["応募期間", "抽選期間", "受付期間", "応募締切", "締切", "受付日時", "申込期間"]);
  const result = extractPeriod(text, ["当選発表", "結果発表", "抽選結果", "当選通知"]);
  const purchase = extractPeriod(text, ["購入期間", "販売期間", "購入期限", "受取期間", "支払期限"]);

  let confidence = 0.43;
  if (knownAccount) confidence += 0.2;
  if (actionUrl) confidence += 0.12;
  if (apply.start || apply.end) confidence += 0.12;
  if (/抽選|招待リクエスト/.test(text)) confidence += 0.08;
  if (PRODUCT_PATTERN.test(text)) confidence += 0.05;
  confidence = Math.min(0.97, confidence);

  const shop = inferShop(text, user.name || username);
  const product = inferProduct(text);
  const location = inferLotteryLocation({
    text,
    shop,
    fallbackArea: "全国",
    fallbackType: "",
    storeIndex: options.storeIndex || [],
  });
  const sourceId = `x-${post.id || hash(text)}`;

  return {
    externalId: sourceId,
    xPostId: post.id || "",
    xAuthor: username,
    sourceKind: "x",
    shop,
    product,
    type: location.type,
    area: location.area,
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
