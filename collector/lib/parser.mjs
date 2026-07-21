import crypto from "node:crypto";
import { extractLinks, htmlToText, normalizeLines } from "./html.mjs";
import { parseDateRange } from "./dates.mjs";
import { enrichAppDestination } from "./app-destination.mjs";
import { normalizeOcrText } from "./image-ocr.mjs";

const STOP_LABELS = [
  "応募期間",
  "抽選期間",
  "受付期間",
  "当選発表",
  "結果発表",
  "購入期間",
  "購入期限",
  "受取期間",
  "受取期限",
  "引取期間",
  "引取期限",
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

function normalizedLabelLine(value = "") {
  return String(value).replace(/^[\s【\[［(（]+/, "").trim();
}
function startsWithStopLabel(value = "") {
  const normalized = normalizedLabelLine(value);
  return STOP_LABELS.some((label) => normalized.startsWith(label));
}

function productLinesAfterLabel(lines, labelPattern) {
  const index = lines.findIndex((line) => labelPattern.test(line));
  if (index < 0) return [];

  const sameLine = lines[index].replace(labelPattern, "").replace(/^[:：]/, "").trim();
  const products = sameLine ? [sameLine] : [];

  for (let i = index + 1; i < Math.min(lines.length, index + 15); i += 1) {
    const line = lines[i].trim();
    if (startsWithStopLabel(line)) break;
    if (line.length > 2 && isPokemonCard(line)) products.push(line);
  }

  return [...new Set(products.map(cleanProduct).filter((x) => x.length > 2))];
}

function labelText(lines, labels) {
  const index = lines.findIndex((line) => labels.some((label) => line.includes(label)));
  if (index < 0) return "";

  const output = [lines[index]];
  for (let i = index + 1; i < Math.min(lines.length, index + 4); i += 1) {
    if (startsWithStopLabel(lines[i])) break;
    output.push(lines[i]);
  }
  return output.join(" ");
}

function bestActionUrl(html, sourceUrl) {
  const links = extractLinks(html, sourceUrl);
  const preferred = links.find((link) => /応募|抽選へ進む|抽選販売専用サイト|抽選販売サイト|応募ページ|申込受付|エントリー|申し込/.test(link.text));
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
    noticeOnly: Boolean(source.noticeOnly),
    officialNotice: Boolean(source.officialNotice),
    appName: source.appName || "",
    appUrl: source.appUrl || "",
    fallbackUrl: source.fallbackUrl || "",
    instructions: source.instructions || "",
    rawApplyText: String(applyText || "").slice(0, 300),
    rawResultText: String(resultText || "").slice(0, 300),
    memo: "",
    purchaseStartPolicy: source.purchaseStartPolicy || "",
  };
}

function imageAltTexts(html = "") {
  const values = [];
  const regex = /<img\b[^>]*\balt=["']([^"']+)["'][^>]*>/gi;
  let match;
  while ((match = regex.exec(String(html)))) {
    const value = htmlToText(match[1]);
    if (value) values.push(value);
  }
  return [...new Set(values)];
}

function sectionText(lines, labels, stopLabels = []) {
  const index = lines.findIndex((line) => labels.some((label) => line.includes(label)));
  if (index < 0) return "";
  const output = [lines[index]];
  for (let i = index + 1; i < Math.min(lines.length, index + 8); i += 1) {
    if (stopLabels.some((label) => lines[i].includes(label))) break;
    output.push(lines[i]);
  }
  return output.join(" ");
}

function dateYear(value = "") {
  const match = String(value).match(/^(\d{4})-/);
  return match ? Number(match[1]) : 0;
}

function replaceDateYear(value = "", year = 0) {
  return year && /^\d{4}-\d{2}-\d{2}$/.test(String(value))
    ? `${year}${String(value).slice(4)}`
    : value;
}

function repairPublishedYear(record) {
  const referenceYear = dateYear(record.applyEndDate || record.applyStartDate);
  if (!referenceYear) return record;
  for (const key of ["resultStartDate", "resultEndDate", "purchaseStartDate", "purchaseEndDate"]) {
    const year = dateYear(record[key]);
    if (year && year === referenceYear - 1) record[key] = replaceDateYear(record[key], referenceYear);
  }
  return record;
}

function normalizePokemonProductName(value = "") {
  return cleanProduct(String(value)
    .normalize("NFKC")
    .replace(/[「」『』]/g, "")
    .replace(/\s*（再販）\s*|\s*\(再販\)\s*/g, "")
    .replace(/\s+/g, " "));
}

function quotedProductCandidates(text = "") {
  const normalized = String(text).normalize("NFKC");
  const prefixMatch = normalized.match(/(ポケモンカードゲーム\s*(?:MEGA|スカーレット＆バイオレット)?\s*(?:強化拡張パック|拡張パック|ハイクラスパック|スタートデッキ[^「」『』]{0,25}|スターターセットex)?)/i);
  const prefix = prefixMatch?.[1]?.trim() || "ポケモンカードゲーム";
  const quoted = [...normalized.matchAll(/[「『]([^」』]{2,90})[」』]/g)]
    .map((match) => match[1].trim())
    .filter((value) => !/応募|抽選|販売|注意|期間/.test(value));
  if (quoted.length) {
    return uniqueValues(quoted.map((value) => {
      if (isPokemonCard(value)) return value;
      if (/^(?:MEGA\s*)?(?:強化拡張パック|拡張パック|ハイクラスパック|スタートデッキ|スターターセット)/i.test(value)) {
        return `ポケモンカードゲーム ${value}`;
      }
      return `${prefix} ${value}`;
    }));
  }
  return [];
}

function livePocketTitle(html = "") {
  const meta = String(html).match(/<meta[^>]+(?:property|name)=["']og:title["'][^>]+content=["']([^"']+)["']/i)?.[1] || "";
  const tag = String(html).match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || "";
  return htmlToText(meta || tag);
}

const PREFECTURES = [
  "北海道","青森県","岩手県","宮城県","秋田県","山形県","福島県",
  "茨城県","栃木県","群馬県","埼玉県","千葉県","東京都","神奈川県",
  "新潟県","富山県","石川県","福井県","山梨県","長野県","岐阜県",
  "静岡県","愛知県","三重県","滋賀県","京都府","大阪府","兵庫県",
  "奈良県","和歌山県","鳥取県","島根県","岡山県","広島県","山口県",
  "徳島県","香川県","愛媛県","高知県","福岡県","佐賀県","長崎県",
  "熊本県","大分県","宮崎県","鹿児島県","沖縄県",
];

function inferLivePocketArea(lines, fallback = "全国") {
  if (fallback && fallback !== "全国") return fallback;
  const locationLine = lines.find((line) => PREFECTURES.some((prefecture) => line.includes(prefecture)));
  return PREFECTURES.find((prefecture) => locationLine?.includes(prefecture))
    || PREFECTURES.find((prefecture) => lines.some((line) => line.includes(prefecture)))
    || fallback
    || "全国";
}

function inferLivePocketShop(lines, title, fallback = "") {
  const text = [title, ...lines.slice(0, 120)].join("\n");
  const patterns = [
    /フタバ図書\s*TSUTAYA[^\n（）()]{1,45}店/i,
    /フタバ図書[^\n（）()]{1,45}店/i,
    /ホビーステーション[^\n（）()]{0,35}店/i,
    /(?:ふるいち|古本市場)[^\n（）()]{0,40}店/i,
    /TSUTAYA[^\n（）()]{1,45}店/i,
    /GIRAFULL(?:\([^)]*\))?[^\n（）()]{0,35}店/i,
    /カードボックス[^\n（）()]{0,35}店/i,
    /フルコンプ[^\n（）()]{0,35}店/i,
    /カードラボ[^\n（）()]{0,35}店/i,
    /トレカ[^\n（）()]{0,35}店/i,
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern)?.[0]?.replace(/\s+/g, " ").trim();
    if (match) return match;
  }

  const bracket = title.match(/[【\[]([^】\]]{2,45}(?:店|センター))[】\]]/)?.[1];
  if (bracket) return bracket.trim();

  const locationCandidate = lines.find((line) =>
    /店(?:\s*[（(][^）)]*(?:都|道|府|県)[）)])?$/.test(line)
    && line.length >= 4
    && line.length <= 80
    && !/営業時間|販売店|対象店舗|お問い合わせ/.test(line)
  );
  return locationCandidate?.replace(/\s*[（(][^）)]*(?:都|道|府|県)[）)]\s*$/, "").trim()
    || fallback
    || "LivePocket";
}

function cleanLivePocketProduct(value = "") {
  return normalizePokemonProductName(value)
    .replace(/&/g, "＆")
    .replace(/\s*(?:抽選販売|抽選受付|抽選予約販売|購入権応募受付|抽選販売のお知らせ).*$/i, "")
    .replace(/^\s*[【\[][^】\]]*(?:店|センター)[】\]]\s*/, "")
    .trim();
}

function livePocketProduct(lines, html) {
  const title = livePocketTitle(html);
  const titleCandidates = [title, ...lines.slice(0, 50)]
    .map(cleanLivePocketProduct)
    .filter((value) => isPokemonCard(value) && value.length >= 4 && value.length <= 180);
  return titleCandidates.sort((a, b) => {
    const score = (value) =>
      (/拡張パック|強化拡張パック|ハイクラスパック|スターターセット|スタートデッキ|スペシャルセット/i.test(value) ? 20 : 0)
      + (/「[^」]+」|『[^』]+』/.test(value) ? 5 : 0)
      - (/抽選|応募|受付|お知らせ/.test(value) ? 8 : 0)
      + Math.min(value.length, 120) / 100;
    return score(b) - score(a);
  })[0] || "";
}


function googleFormTitle(html = "") {
  const source = String(html || "");
  const meta = source.match(/<meta[^>]+(?:property|name)=["']og:title["'][^>]+content=["']([^"']+)["']/i)?.[1]
    || source.match(/<meta[^>]+itemprop=["']name["'][^>]+content=["']([^"']+)["']/i)?.[1]
    || source.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]
    || "";
  return htmlToText(meta)
    .replace(/\s*[-–—|｜]\s*Google\s*(?:Forms?|フォーム)\s*$/i, "")
    .trim();
}

function cleanGoogleFormProduct(value = "") {
  return cleanProduct(String(value)
    .normalize("NFKC")
    .replace(/^(?:対象商品|商品名|抽選対象商品|販売商品|応募商品)\s*[:：]?\s*/i, "")
    .replace(/\s*(?:抽選販売|抽選受付|応募フォーム|エントリーフォーム|抽選販売のお知らせ).*$/i, "")
    .replace(/[「『](.*)[」』]/, "$1")
    .trim());
}

function googleFormProduct(lines, title = "") {
  const candidates = [];
  const add = (value, score = 0) => {
    const product = cleanGoogleFormProduct(value);
    if (!product || product.length < 3 || product.length > 180) return;
    if (/氏名|名前|メール|電話|住所|応募期間|当選発表|受取期間|注意事項|利用規約/i.test(product)) return;
    if (/^抽選販売(?:のお知らせ)?$|^応募フォーム$|^エントリーフォーム$/i.test(product)) return;
    let total = score;
    if (/ポケモンカード|ポケカ/.test(product)) total += 80;
    if (/拡張パック|強化拡張パック|ハイクラスパック|スタートデッキ|スターターセット|BOX|ボックス|デッキ|セット|パック/i.test(product)) total += 60;
    if (/^[ァ-ヶーA-Za-z0-9＆・\s]{4,80}$/.test(product)) total += 35;
    candidates.push({ product, score: total + Math.min(product.length, 80) / 5 });
  };

  add(title, 45);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const inline = line.match(/(?:対象商品|商品名|抽選対象商品|販売商品|応募商品)\s*[:：]?\s*(.{2,180})/i)?.[1];
    if (inline) add(inline, 100);
    if (/^(?:対象商品|商品名|抽選対象商品|販売商品|応募商品)\s*[:：]?$/.test(line)) add(lines[index + 1] || "", 100);
    if (/1\s*BOX|\d[,.]?\d{2,5}\s*円/.test(line)) add(lines[index - 1] || "", 45);
    if (/ポケモンカード|ポケカ|拡張パック|ハイクラスパック|スターターセット|スタートデッキ|BOX|ボックス/i.test(line)) add(line, 30);
  }

  const seen = new Set();
  return candidates
    .sort((a, b) => b.score - a.score || b.product.length - a.product.length)
    .find((item) => {
      const key = item.product.normalize("NFKC").toLowerCase().replace(/[\s　「」『』【】［］\[\]()（）・･\-‐‑‒–—―_]/g, "");
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    })?.product || "";
}

function parseGoogleForm(source, html, collectedAt) {
  const text = htmlToText(html);
  if (!/抽選|応募|申込|受付/.test(text)) return [];
  const lines = normalizeLines(text);
  const title = googleFormTitle(html);
  const product = googleFormProduct(lines, title);
  if (!product) return [];

  const applyText = labelText(lines, ["応募期間", "応募受付期間", "抽選受付期間", "申込期間", "受付期間", "応募締切", "締切"])
    || lines.find((line) => /応募|申込|受付/.test(line) && /締切|まで|期間/.test(line))
    || "";
  const resultText = labelText(lines, ["当選発表", "結果発表", "抽選結果", "当落発表", "当選通知"]);
  const purchaseText = labelText(lines, ["購入期間", "購入期限", "受取期間", "受取期限", "引取期間", "引取期限"]);
  const shop = inferLivePocketShop(lines, title, source.shop || "");
  const area = inferLivePocketArea(lines, source.area || "全国");
  const type = /発送|配送|通販|オンラインショップ|送料/.test(text) && !/店頭受取|店舗受取|受取店舗/.test(text)
    ? "通販"
    : (source.type || "店舗");

  const record = buildRecord({
    source,
    product,
    applyText,
    resultText,
    purchaseText,
    html,
    collectedAt,
    actionUrlOverride: source.url,
    shopOverride: shop,
    typeOverride: type,
    areaOverride: area,
  });
  repairPublishedYear(record);
  record.sourceType = "Googleフォーム";
  record.sourceKind = source.sourceKind || "web";
  record.destinationType = "direct";
  record.collectionMode = source.discoveryParentUrl ? "google-form-discovered" : "google-form-direct";
  record.memo = "Googleフォーム本文から自動取得しました。";
  return [record];
}

function parseLivePocket(source, html, collectedAt) {
  const text = htmlToText(html);
  if (!/ポケモンカード|ポケカ|拡張パック|ハイクラスパック|スタートデッキ|スターターセット|MEGA/i.test(text)) return [];
  if (!/抽選|応募|申込|受付/.test(text)) return [];

  const lines = normalizeLines(text);
  const product = livePocketProduct(lines, html);
  if (!product) return [];

  const applyText = labelText(lines, ["受付日時", "受付期間", "申込期間", "応募期間", "抽選受付期間", "販売期間", "受付終了", "申込締切"])
    || lines.find((line) => /受付.*(?:まで|終了|締切)|申込.*(?:まで|終了|締切)|応募.*(?:まで|終了|締切)/.test(line))
    || "";
  const resultText = labelText(lines, ["結果発表予定日", "抽選結果発表日時", "抽選結果", "当選発表", "結果発表", "当選通知"]);
  const purchaseText = labelText(lines, ["購入期間", "購入期限", "支払期限", "入金期限", "受取期間", "受取期限", "引取期間", "引取期限"]);

  const title = livePocketTitle(html);
  const fallbackShop = source.shop || (source.name === "LivePocket公開抽選" ? "" : source.name);
  const shop = inferLivePocketShop(lines, title, fallbackShop);
  const area = inferLivePocketArea(lines, source.area || "全国");
  const record = buildRecord({
    source,
    product,
    applyText,
    resultText,
    purchaseText,
    html,
    collectedAt,
    actionUrlOverride: source.url,
    shopOverride: shop,
    typeOverride: source.type || "店舗",
    areaOverride: area,
  });
  repairPublishedYear(record);
  record.sourceType = "LivePocket";
  record.sourceKind = source.sourceKind || "web";
  record.destinationType = "direct";
  record.collectionMode = source.discoveryParentUrl ? "livepocket-public-search" : "livepocket-direct";
  if (/営業時間終了まで/.test(purchaseText)) {
    record.memo = "購入期限は営業時間終了までです。店舗の営業時間を応募ページで確認してください。";
  }
  return [record];
}

function parseLivePocketSearch() {
  return [];
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

function uniqueValues(values = []) {
  return [...new Set(values.map((value) => cleanProduct(value)).filter((value) => value.length > 2))];
}

function geoReleaseText(text = "") {
  const titleLike = normalizeLines(text).slice(0, 15).join(" ");
  const match = titleLike.match(/(?:(\d{4})年)?\s*(\d{1,2})月\s*(\d{1,2})日[^\n]{0,8}発売/);
  if (!match) return "";
  return `${match[1] ? `${match[1]}年` : ""}${match[2]}月${match[3]}日`;
}

function extractGeoProducts(text = "") {
  const normalized = String(text)
    .normalize("NFKC")
    .replace(/[\u00a0\t]+/g, " ")
    .replace(/\s*／\s*/g, "／")
    .replace(/\s+/g, " ");
  const products = [];

  // Starter sets are often announced as one group followed by slash-separated variants.
  const starterGroupPattern = /ポケモンカードゲーム\s*MEGA\s*スターターセットex\s*[（(「『\[]?([^）)」』\]\n。]{3,180})/gi;
  let starterMatch;
  while ((starterMatch = starterGroupPattern.exec(normalized))) {
    let variants = starterMatch[1]
      .replace(/(?:の)?発売日当日分.*$/i, "")
      .replace(/(?:抽選販売|抽選申込受付|について).*$/i, "")
      .replace(/\s*3種.*$/i, "")
      .trim();
    const split = variants.split(/[／/]/).map((value) => value.replace(/^[\s（(「『]+|[\s）)」』]+$/g, "").trim());
    for (const variant of split) {
      if (!/ex/i.test(variant)) continue;
      const cleanedVariant = variant.replace(/^スターターセットex\s*/i, "").replace(/&/g, "＆").trim();
      if (cleanedVariant.length > 2 && cleanedVariant.length < 80) {
        products.push(`ポケモンカードゲーム MEGA スターターセットex ${cleanedVariant}`);
      }
    }
  }

  // Expansion packs and deck products can be extracted individually from headings/body copy.
  const expansionPattern = /ポケモンカードゲーム\s*MEGA\s*拡張パック\s*[「『\[]?([^」』\]\n。]{2,80})/gi;
  let expansionMatch;
  while ((expansionMatch = expansionPattern.exec(normalized))) {
    const name = expansionMatch[1]
      .replace(/[」』\]]/g, "")
      .replace(/(?:の)?発売日当日分.*$/i, "")
      .replace(/(?:抽選販売|抽選申込受付|について).*$/i, "")
      .replace(/^[\s:：]+|[\s,、]+$/g, "")
      .trim();
    if (name.length > 1 && name.length < 70) {
      products.push(`ポケモンカードゲーム MEGA 拡張パック ${name}`);
    }
  }

  const deckPattern = /ポケモンカードゲーム\s*MEGA\s*(スタートデッキ[^「」『』\n。]{2,100})/gi;
  let deckMatch;
  while ((deckMatch = deckPattern.exec(normalized))) {
    const name = deckMatch[1]
      .replace(/(?:の)?再販売分.*$/i, "")
      .replace(/(?:抽選販売|抽選申込受付|について).*$/i, "")
      .replace(/[」』]/g, "")
      .trim();
    if (name.length > 3 && name.length < 90) products.push(`ポケモンカードゲーム MEGA ${name}`);
  }

  return uniqueValues(products).filter((product) => isPokemonCard(product)).slice(0, 20);
}

function parseGeoLottery(source, html, collectedAt) {
  const text = htmlToText(html);
  if (!/ポケモンカードゲーム|ポケモンカード|ポケカ/i.test(text) || !/抽選販売|抽選申込|応募期間/.test(text)) return [];

  const lines = normalizeLines(text);
  const products = extractGeoProducts(text);
  if (!products.length) return [];

  const applyText = labelText(lines, ["応募期間", "抽選受付期間", "受付期間"])
    || lines.find((line) => /応募期間は/.test(line))
    || "";
  const resultText = labelText(lines, ["当選発表", "結果発表", "当選連絡"]);
  const purchaseText = labelText(lines, ["購入期間", "販売期間", "受取期間", "引取期間"]);
  const releaseText = geoReleaseText(text);
  const actionUrl = bestActionUrl(html, source.url);
  const isResale = /再販売|再販|キャンセル分|追加販売/.test(text);

  return products.map((product) => {
    const record = buildRecord({
      source,
      product,
      applyText,
      resultText,
      purchaseText,
      html,
      collectedAt,
      actionUrlOverride: actionUrl,
      shopOverride: "ゲオ",
      typeOverride: "店舗",
      areaOverride: "全国",
    });

    if (!record.purchaseStartDate && releaseText && !isResale) {
      const release = parseDateRange(releaseText);
      record.purchaseStartDate = release.start?.date || "";
      record.purchaseStartTime = release.start?.time || "";
    }
    record.memo = isResale
      ? "再販抽選。購入開始日は公式告知で確認できた場合のみ表示します。"
      : "ゲオ公式のお知らせから商品単位で自動分割しました。";
    record.collectionMode = "official-news-multi-product";
    return record;
  });
}

function hobbyStationPrimaryText(text = "") {
  return String(text)
    .split(/\n(?:最近の投稿|前の記事を読む|次の記事を読む|ホビーステーショントップ|トレーディングカード・トレカ販売)/i)[0]
    .trim();
}

function hobbyStationProducts(text = "") {
  const primaryText = hobbyStationPrimaryText(text);
  const products = quotedProductCandidates(primaryText).map(normalizePokemonProductName);
  if (products.length) {
    const unique = new Map();
    for (const product of products) {
      const cleaned = product
        .replace(/^(?:当選者代金前払い必要|応募は終了しました|※応募は終了しました)\s*/i, "")
        .replace(/\s*(?:を抽選販売いたします|の再販商品を抽選販売いたします).*$/i, "")
        .trim();
      if (!cleaned || cleaned.length > 120) continue;
      const key = cleaned.normalize("NFKC").toLowerCase().replace(/再販|再販売|[()（）\s]/g, "");
      if (!unique.has(key) || cleaned.length < unique.get(key).length) unique.set(key, cleaned);
    }
    return [...unique.values()].slice(0, 4);
  }

  const lines = normalizeLines(primaryText);
  return uniqueValues(lines
    .filter((line) => isPokemonCard(line))
    .filter((line) => /拡張パック|強化拡張パック|ハイクラスパック|スタートデッキ|スターターセット|スペシャルセット|BOX|ボックス|MEGA/i.test(line))
    .filter((line) => !/応募方法|応募期間|抽選受付|当選発表|購入期間|注意事項|最近の投稿/.test(line))
    .map((line) => normalizePokemonProductName(line.replace(/^.*?抽選販売/, "")))
    .map((line) => line.replace(/\s*(?:を抽選販売いたします|の再販商品を抽選販売いたします).*$/i, "").trim())
    .filter((line) => line.length > 4 && line.length < 120))
    .slice(0, 4);
}

function hobbyStationIsListingPage(source, text, actionUrls) {
  if (source.discoveryParentUrl) return false;
  let path = "";
  try { path = new URL(source.url).pathname; } catch {}
  if (/\/(?:category|tag|author)\//i.test(path)) return true;
  const noticeCount = (String(text).match(/(?:応募期間|抽選受付期間)/g) || []).length;
  return actionUrls.length > 1 && noticeCount > 1;
}

function parseHobbyStationNews(source, html, collectedAt) {
  const fullText = htmlToText(html);
  if (!/ポケモンカード|ポケカ/i.test(fullText) || !/抽選/.test(fullText)) return [];

  const livePocketLinks = extractLinks(html, source.url)
    .filter((link) => /(^|\.)livepocket\.jp$/i.test(new URL(link.url).hostname));
  const textLivePocket = [...String(html).matchAll(/https?:\/\/livepocket\.jp\/e\/[A-Za-z0-9_-]+/gi)]
    .map((match) => match[0]);
  const actionUrls = [...new Set([...livePocketLinks.map((link) => link.url), ...textLivePocket])];
  if (!actionUrls.length || hobbyStationIsListingPage(source, fullText, actionUrls)) return [];

  const text = hobbyStationPrimaryText(fullText);
  const lines = normalizeLines(text);
  const products = hobbyStationProducts(text);
  if (!products.length) return [];

  const applyText = sectionText(lines,
    ["応募期間", "抽選受付期間", "受付期間"],
    ["当選発表", "結果発表", "当選者購入期間", "購入期間", "受取期間"]);
  const resultText = sectionText(lines,
    ["当選発表", "結果発表", "抽選結果"],
    ["当選者購入期間", "購入期間", "受取期間", "注意事項"]);
  const purchaseText = sectionText(lines,
    ["当選者購入期間", "商品代金お支払い期間", "購入期間", "受取期間", "引取期間"],
    ["商品お受け取り期間", "注意事項", "応募条件", "お問い合わせ"]);

  const pairs = [];
  if (products.length === 1) {
    for (const actionUrl of actionUrls) pairs.push({ product: products[0], actionUrl });
  } else if (actionUrls.length === 1) {
    for (const product of products) pairs.push({ product, actionUrl: actionUrls[0] });
  } else {
    const count = Math.min(products.length, actionUrls.length);
    for (let index = 0; index < count; index += 1) pairs.push({ product: products[index], actionUrl: actionUrls[index] });
  }

  const uniquePairs = new Map();
  for (const pair of pairs) {
    const key = `${pair.product.normalize("NFKC").toLowerCase()}|${pair.actionUrl}`;
    if (!uniquePairs.has(key)) uniquePairs.set(key, pair);
  }

  const records = [];
  for (const { product, actionUrl } of uniquePairs.values()) {
    const record = buildRecord({
      source,
      product,
      applyText,
      resultText,
      purchaseText,
      html,
      collectedAt,
      actionUrlOverride: actionUrl,
      shopOverride: "ホビーステーション",
      typeOverride: "店舗",
      areaOverride: "全国",
    });
    repairPublishedYear(record);
    record.memo = /再販|再販売/.test(text)
      ? "ホビーステーション公式告知から取得した再販抽選です。"
      : "ホビーステーション公式告知からLivePocket応募先を自動取得しました。";
    record.collectionMode = "official-news-livepocket";
    records.push(record);
  }
  return records;
}

function normalizeFuruichiProductLine(value = "") {
  return normalizePokemonProductName(normalizeOcrText(value))
    .replace(/[\]】」』]+$/g, "")
    .replace(/&/g, "＆")
    .replace(/\s+(?:について|抽選受付|抽選販売|お知らせ).*$/i, "")
    .trim();
}

function furuichiSectionProducts(section = "", html = "") {
  const normalizedSection = normalizeOcrText(section);
  const lineCandidates = normalizeLines(normalizedSection)
    .filter((line) => isPokemonCard(line))
    .filter((line) => /拡張パック|強化拡張パック|ハイクラスパック|スタートデッキ|スターターセット|スペシャルセット|BOX|ボックス|MEGA/i.test(line))
    .filter((line) => !/応募方法|応募条件|会員登録|ポイントアプリ|購入期間|注意事項|本人確認|抽選結果/.test(line))
    .map((line) => line.replace(/^[「『【\[]+|[」』】\]]+$/g, ""))
    .map(normalizeFuruichiProductLine)
    .filter((line) => line.length >= 8 && line.length <= 110);
  const quotedCandidates = lineCandidates.length
    ? []
    : quotedProductCandidates(normalizedSection).map(normalizeFuruichiProductLine);
  const candidates = [
    ...lineCandidates,
    ...quotedCandidates,
    ...imageAltTexts(html)
      .filter((value) => isPokemonCard(value))
      .map(normalizeFuruichiProductLine),
  ];
  return uniqueValues(candidates)
    .filter((value) => !/抽選受付|抽選販売|お知らせ|スケジュール/.test(value))
    .filter((value) => !/登録会員番号|アプリ会員|ふるいちアプリ|本人確認/.test(value))
    .slice(0, 16);
}

function furuichiSchedule(section = "") {
  const lines = normalizeLines(section);
  return {
    applyText: sectionText(lines,
      ["抽選受付日時", "抽選受付期間", "応募期間", "受付期間"],
      ["当選発表", "当選商品販売時間", "購入期間", "販売予定期間"]),
    resultText: sectionText(lines,
      ["当選発表", "結果発表"],
      ["当選商品販売時間", "購入期間", "販売予定期間"]),
    purchaseText: sectionText(lines,
      ["当選商品販売時間", "購入期間", "販売予定期間", "受取期間"],
      ["注意事項", "応募は無料", "第"]),
  };
}

function furuichiShopName(text = "", fallback = "ふるいち") {
  const line = normalizeLines(text).find((value) => /(?:ふるいち|古本市場)[^\n]{0,40}店/.test(value));
  const match = line?.match(/((?:ふるいち|古本市場)[^｜|　\n]{0,40}店)/);
  return match?.[1]?.trim() || fallback;
}

function parseFuruichiNews(source, html, collectedAt) {
  const text = htmlToText(html);
  const combinedText = normalizeOcrText(`${text}\n${imageAltTexts(html).join("\n")}`);
  if (!/ポケモンカード|ポケカ/i.test(combinedText) || !/抽選/.test(combinedText)) return [];

  const directLivePocket = extractLinks(html, source.url)
    .filter((link) => /(^|\.)livepocket\.jp$/i.test(new URL(link.url).hostname))
    .map((link) => link.url);
  const sections = combinedText
    .split(/(?=第\s*\d+\s*弾[^\n]{0,80}(?:LivePocket|ライブポケット)抽選販売)/i)
    .filter((section) => /ポケモンカード|ポケカ/i.test(section) && /抽選/.test(section));
  const records = [];
  const detectedShop = furuichiShopName(combinedText, source.name || "ふるいち");

  for (let index = 0; index < sections.length; index += 1) {
    const section = sections[index];
    const products = furuichiSectionProducts(section, html);
    const schedule = furuichiSchedule(section);
    if (!products.length || !schedule.applyText) continue;

    const actionUrl = directLivePocket[index] || directLivePocket[0] || source.url;
    const storeQr = !directLivePocket.length && /店頭[^\n]{0,40}(?:QR|ＱＲ)|QRコードは店頭|受付QRコードは店頭/i.test(section);
    for (const product of products) {
      const recordSource = {
        ...source,
        destinationType: storeQr ? "store" : "direct",
        fallbackUrl: storeQr ? source.url : source.fallbackUrl,
        instructions: storeQr
          ? "店舗で公開されるLivePocketのQRコードから応募してください。"
          : source.instructions,
        noticeOnly: storeQr,
        officialNotice: storeQr,
      };
      const record = buildRecord({
        source: recordSource,
        product,
        applyText: schedule.applyText,
        resultText: schedule.resultText,
        purchaseText: schedule.purchaseText,
        html,
        collectedAt,
        actionUrlOverride: actionUrl,
        shopOverride: detectedShop,
        typeOverride: "店舗",
        areaOverride: source.area || "全国",
      });
      record.memo = storeQr
        ? "ふるいち公式告知を確認。応募用QRコードは店頭でのみ公開されます。"
        : "ふるいち公式告知からLivePocket応募先を自動取得しました。";
      record.collectionMode = storeQr ? "official-store-qr-notice" : "official-news-livepocket";
      if (/スターターセット\s*ex\s*(?:3種)?$/i.test(record.product.replace(/ポケモンカードゲーム\s*(?:MEGA)?/i, "").trim())) {
        record.expandCatalogGroup = true;
      }
      records.push(record);
    }
  }

  if (records.length) return records;

  // アプリ抽選は、本文に商品名と期間の両方がある場合だけ公開候補にする。
  if (/ふるいちアプリ/.test(combinedText) && /WEB事前抽選|Web事前抽選|アプリ抽選/.test(combinedText)) {
    const products = furuichiSectionProducts(combinedText, html);
    const schedule = furuichiSchedule(combinedText);
    if (products.length && schedule.applyText) {
      return products.map((product) => {
        const record = buildRecord({
          source: {
            ...source,
            destinationType: "app",
            appName: "ふるいちアプリ",
            fallbackUrl: source.url,
            instructions: "ふるいちアプリ内の抽選案内から応募してください。",
          },
          product,
          applyText: schedule.applyText,
          resultText: schedule.resultText,
          purchaseText: schedule.purchaseText,
          html,
          collectedAt,
          actionUrlOverride: source.url,
          shopOverride: detectedShop,
          typeOverride: "店舗",
          areaOverride: source.area || "全国",
        });
        record.memo = "ふるいち公式ページでアプリ抽選を確認しました。";
        record.collectionMode = "official-app-notice";
        if (/スターターセット\s*ex\s*(?:3種)?$/i.test(record.product.replace(/ポケモンカードゲーム\s*(?:MEGA)?/i, "").trim())) {
          record.expandCatalogGroup = true;
        }
        return record;
      });
    }
  }

  return [];
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
  let records;
  if (source.parser === "livepocket") records = parseLivePocket(source, html, collectedAt);
  else if (source.parser === "google-form") records = parseGoogleForm(source, html, collectedAt);
  else if (source.parser === "livepocket-search") records = parseLivePocketSearch(source, html, collectedAt);
  else if (source.parser === "amiami") records = parseAmiAmi(source, html, collectedAt);
  else if (source.parser === "rakuten-books") records = parseRakutenBooks(source, html, collectedAt);
  else if (source.parser === "hobby-search") records = parseHobbySearch(source, html, collectedAt);
  else if (source.parser === "listing-intelligence-v1") records = parseListingIntelligence(source, html, collectedAt);
  else if (source.parser === "geo-lottery") records = parseGeoLottery(source, html, collectedAt);
  else if (source.parser === "hobby-station-news") records = parseHobbyStationNews(source, html, collectedAt);
  else if (source.parser === "furuichi-news") records = parseFuruichiNews(source, html, collectedAt);
  else records = parseGeneric(source, html, collectedAt);

  const evidence = htmlToText(html);
  return (records || []).map((record) => enrichAppDestination(record, evidence));
}
