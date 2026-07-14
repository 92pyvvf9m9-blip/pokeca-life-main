import { createHash } from "node:crypto";

const PRODUCT_PREFIX_PATTERN = [
  "強化拡張パック",
  "ハイクラスパック",
  "拡張パックデラックス",
  "拡張パック",
  "スターターセットMEGA",
  "スターターセットex",
  "スターターセット",
  "スタートデッキ100 バトルコレクション",
  "スタートデッキGenerations",
  "スタートデッキ100",
  "スタートデッキ",
  "スターターデッキ＆ビルドセット",
  "バトルマスターデッキ",
  "デッキビルドBOX",
  "コレクションファイルセット",
  "スペシャルジャンボカードセット",
  "スペシャルカードセット",
  "プレミアムデッキセット",
  "カードイラストフィギュアコレクション",
  "バトルアカデミー",
  "30th CELEBRATION FUTURISTIC BOX",
  "30th CELEBRATION カードセット",
].sort((a, b) => b.length - a.length).map(escapeRegExp).join("|");

const PRODUCT_PREFIX_RE = new RegExp(`(?:${PRODUCT_PREFIX_PATTERN})`, "i");
const PRODUCT_QUOTED_RE = new RegExp(`(${PRODUCT_PREFIX_PATTERN})\\s*[「『\\\"]([^」』\\\"]{2,100})[」』\\\"]`, "gi");
const EXCLUDED_RE = /デッキシールド|デッキケース|ラバープレイマット|プレイマット|カードスリーブ|カードボックス|ストレージボックス|コイン|ダメカン|マーカー|フリップデッキケース|キャリングケース|フレーム|ポスター|ぬいぐるみ/i;

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function decodeHtml(value = "") {
  const named = {
    amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ",
    ldquo: "“", rdquo: "”", laquo: "«", raquo: "»",
  };
  return String(value)
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(Number(dec)))
    .replace(/&([a-z]+);/gi, (match, key) => named[key.toLowerCase()] ?? match);
}

export function stripHtml(html = "") {
  return decodeHtml(String(html)
    .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
    .replace(/<br\s*\/?\s*>/gi, "\n")
    .replace(/<\/p>|<\/li>|<\/h[1-6]>|<\/div>/gi, "\n")
    .replace(/<[^>]+>/g, " "))
    .replace(/[\t\r ]+/g, " ")
    .replace(/\n\s+/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function getAttribute(tag, name) {
  const match = String(tag).match(new RegExp(`\\b${escapeRegExp(name)}\\s*=\\s*(["'])([\\s\\S]*?)\\1`, "i"));
  return match ? decodeHtml(match[2]).trim() : "";
}

function resolveUrl(value, baseUrl) {
  if (!value) return "";
  try { return new URL(value, baseUrl).href; } catch { return ""; }
}

function isOfficialHost(url) {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return host === "pokemon-card.com" || host.endsWith(".pokemon-card.com");
  } catch { return false; }
}

export function normalizeProductName(value = "") {
  return decodeHtml(value)
    .normalize("NFKC")
    .toLowerCase()
    .replace(/ポケモンカードゲーム/g, "")
    .replace(/[「」『』【】［］\[\]()（）・･\s　\-‐‑‒–—―_]/g, "")
    .replace(/抽選販売|抽選受付|予約販売|応募フォーム|再販/g, "")
    .trim();
}

function cleanName(value = "") {
  return decodeHtml(value)
    .replace(/\s+/g, " ")
    .replace(/^商品\s*/i, "")
    .replace(/^ポケモンカードゲーム\s*(?:スカーレット＆バイオレット|MEGA)?\s*/i, "")
    .replace(/[「『]/g, " ")
    .replace(/[」』]/g, "")
    .replace(/\s+/g, " ")
    .replace(/(?:が|を)?、?\s*\d{1,2}月\d{1,2}日[（(][^）)]*[）)](?:に)?発売.*$/u, "")
    .replace(/(?:販売日|発売日|希望小売価格).*$/u, "")
    .replace(/[!！?？]+$/g, "")
    .trim();
}

export function classifyProduct(name = "") {
  const text = String(name);
  if (/強化拡張パック|ハイクラスパック|拡張パック/.test(text)) return "拡張パック";
  if (/スターター|スタートデッキ|バトルマスターデッキ|バトルアカデミー/.test(text)) return "構築デッキ";
  return "その他の商品";
}

export function isCardProductName(name = "") {
  const text = cleanName(name);
  if (!text || text.length < 4) return false;
  if (EXCLUDED_RE.test(text)) return false;
  if (/コレクションファイル/.test(text) && !/セット/.test(text)) return false;
  return PRODUCT_PREFIX_RE.test(text)
    || /30th CELEBRATION/.test(text)
    || /FUTURISTIC BOX/i.test(text)
    || /カードセット/.test(text);
}

function extractNames(text = "") {
  const normalized = decodeHtml(text).replace(/\s+/g, " ");
  const names = new Set();
  PRODUCT_QUOTED_RE.lastIndex = 0;
  for (const match of normalized.matchAll(PRODUCT_QUOTED_RE)) {
    const prefix = cleanName(match[1]);
    const title = cleanName(match[2]);
    const name = cleanName(`${prefix} ${title}`);
    if (isCardProductName(name)) names.add(name);
  }

  const pieces = normalized.split(/\n|\||｜|(?:販売日|発売日|希望小売価格|メーカー希望小売価格)/);
  for (const piece of pieces) {
    const start = piece.search(PRODUCT_PREFIX_RE);
    if (start < 0) continue;
    let name = cleanName(piece.slice(start));
    name = name.replace(/(?:\d{4}年)?\s*\d{1,2}月\s*\d{1,2}日.*$/u, "").trim();
    if (name.length > 120) {
      const stop = name.search(/(?:税込|内容物|カード\d+枚|入り|発売)/u);
      if (stop > 0) name = name.slice(0, stop).trim();
    }
    if (isCardProductName(name)) names.add(name);
  }

  if (/30th CELEBRATION FUTURISTIC BOX/i.test(normalized)) names.add("30th CELEBRATION FUTURISTIC BOX");
  if (/30th CELEBRATION カードセット/i.test(normalized)) names.add("30th CELEBRATION カードセット");
  return [...names];
}

export function parseJapaneseDate(text = "", sourceUrl = "", collectedAt = new Date().toISOString()) {
  const value = decodeHtml(text).normalize("NFKC");
  let match = value.match(/(20\d{2})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日/);
  if (match) return `${match[1]}-${String(match[2]).padStart(2, "0")}-${String(match[3]).padStart(2, "0")}`;

  match = value.match(/(?<!\d)(\d{1,2})\s*月\s*(\d{1,2})\s*日/);
  if (!match) return "";
  const urlYear = String(sourceUrl).match(/\/(20\d{2})\//)?.[1];
  const collected = new Date(collectedAt);
  let year = Number(urlYear || collected.getFullYear());
  const month = Number(match[1]);
  if (!urlYear && month < collected.getMonth() + 1 - 6) year += 1;
  return `${year}-${String(month).padStart(2, "0")}-${String(match[2]).padStart(2, "0")}`;
}

function parsePrice(text = "") {
  const match = decodeHtml(text).normalize("NFKC").match(/(?:希望小売価格|価格)\s*([\d,]+)\s*円/);
  return match ? Number(match[1].replace(/,/g, "")) : undefined;
}

function extractImages(html, baseUrl) {
  const images = [];
  for (const match of String(html).matchAll(/<img\b[^>]*>/gi)) {
    const tag = match[0];
    const srcset = getAttribute(tag, "srcset").split(",").map((part) => part.trim().split(/\s+/)[0]).filter(Boolean);
    const raw = getAttribute(tag, "data-src") || getAttribute(tag, "data-original") || getAttribute(tag, "src") || srcset.at(-1) || "";
    const url = resolveUrl(raw, baseUrl);
    if (!url || !isOfficialHost(url)) continue;
    images.push({
      url,
      alt: getAttribute(tag, "alt"),
      title: getAttribute(tag, "title"),
      tag,
    });
  }
  return images;
}

function imageScore(image, productName, blockText = "") {
  const product = normalizeProductName(productName);
  const alt = normalizeProductName(`${image.alt} ${image.title}`);
  const url = image.url.toLowerCase();
  let score = 0;
  if (alt && (alt.includes(product) || product.includes(alt))) score += 80;
  const core = product.replace(/強化?拡張パック|ハイクラスパック|スターターセット(?:mega|ex)?|スタートデッキ\d*|その他の商品|構築デッキ/g, "");
  if (core.length >= 4 && alt.includes(core)) score += 45;
  if (/product|item|package|thumb|box|goods|main/.test(url)) score += 22;
  if (/logo|icon|banner|bnr|bg|background|keyvisual|kv|cardlist|card_list|decklist/.test(url)) score -= 70;
  if (/\.svg(?:\?|$)/.test(url)) score -= 15;
  if (normalizeProductName(blockText).includes(product)) score += 18;
  return score;
}

function chooseImage(images, productName, blockText) {
  return images
    .map((image) => ({ ...image, score: imageScore(image, productName, blockText) }))
    .sort((a, b) => b.score - a.score)[0] || null;
}

function aliasesFor(name) {
  const values = new Set([name]);
  const core = cleanName(name)
    .replace(/^(?:強化拡張パック|ハイクラスパック|拡張パックデラックス|拡張パック|スターターセットMEGA|スターターセットex|スターターセット|デッキビルドBOX|コレクションファイルセット|スペシャルカードセット|スペシャルジャンボカードセット|プレミアムデッキセット)\s*/i, "")
    .trim();
  if (core && core !== name) values.add(core);
  return [...values];
}

function candidateConfidence(candidate) {
  let score = 0.25;
  if (candidate.releaseDate) score += 0.25;
  if (candidate.imageUrl) score += 0.25;
  if (candidate.officialUrl && isOfficialHost(candidate.officialUrl)) score += 0.15;
  if (candidate.name && isCardProductName(candidate.name)) score += 0.1;
  return Number(Math.min(1, score).toFixed(2));
}

function buildCandidate({ name, releaseDate, officialUrl, source, image, text, collectedAt }) {
  const cleaned = cleanName(name);
  if (!isCardProductName(cleaned)) return null;
  const candidate = {
    name: cleaned,
    releaseDate: releaseDate || parseJapaneseDate(text, officialUrl, collectedAt),
    year: Number((releaseDate || parseJapaneseDate(text, officialUrl, collectedAt) || "0000").slice(0, 4)) || undefined,
    category: classifyProduct(cleaned),
    aliases: aliasesFor(cleaned),
    officialUrl,
    source: source.name,
    sourceId: source.id,
    sourceUrl: officialUrl,
    imageUrl: image?.url || "",
    imageAlt: image?.alt || "",
    priceYen: parsePrice(text),
    collectedAt,
  };
  candidate.confidence = candidateConfidence(candidate);
  return candidate;
}

function dedupeCandidates(candidates) {
  const map = new Map();
  for (const candidate of candidates.filter(Boolean)) {
    const key = normalizeProductName(candidate.name);
    if (!key) continue;
    const previous = map.get(key);
    if (!previous) {
      map.set(key, candidate);
      continue;
    }
    map.set(key, {
      ...previous,
      ...candidate,
      releaseDate: previous.releaseDate || candidate.releaseDate,
      year: previous.year || candidate.year,
      imageUrl: previous.imageUrl || candidate.imageUrl,
      imageAlt: previous.imageAlt || candidate.imageAlt,
      priceYen: previous.priceYen || candidate.priceYen,
      aliases: [...new Set([...(previous.aliases || []), ...(candidate.aliases || [])])],
      confidence: Math.max(previous.confidence || 0, candidate.confidence || 0),
    });
  }
  return [...map.values()];
}

export function parseOfficialProductDocument(source, html, collectedAt = new Date().toISOString()) {
  const candidates = [];
  const pageText = stripHtml(html);
  const baseImages = extractImages(html, source.url);

  for (const anchor of String(html).matchAll(/<a\b[^>]*href\s*=\s*(["'])([\s\S]*?)\1[^>]*>[\s\S]*?<\/a>/gi)) {
    const block = anchor[0];
    const href = resolveUrl(anchor[2], source.url);
    if (!href || !isOfficialHost(href)) continue;
    const text = stripHtml(block);
    const names = extractNames(text + "\n" + extractImages(block, source.url).map((image) => image.alt).join("\n"));
    if (!names.length) continue;
    const releaseDate = parseJapaneseDate(text, href, collectedAt);
    const images = extractImages(block, source.url);
    for (const name of names) {
      const image = chooseImage(images, name, text);
      candidates.push(buildCandidate({ name, releaseDate, officialUrl: href, source, image, text, collectedAt }));
    }
  }

  for (const image of baseImages) {
    const names = extractNames(`${image.alt}\n${image.title}`);
    for (const name of names) {
      const tagIndex = String(html).indexOf(image.tag);
      const around = tagIndex >= 0 ? String(html).slice(Math.max(0, tagIndex - 1200), tagIndex + image.tag.length + 1600) : html;
      const text = stripHtml(around);
      const releaseDate = parseJapaneseDate(text, source.url, collectedAt) || parseJapaneseDate(pageText, source.url, collectedAt);
      candidates.push(buildCandidate({ name, releaseDate, officialUrl: source.url, source, image, text, collectedAt }));
    }
  }

  const pageNames = extractNames(pageText);
  if (pageNames.length <= 8) {
    for (const name of pageNames) {
      const image = chooseImage(baseImages, name, pageText);
      candidates.push(buildCandidate({
        name,
        releaseDate: parseJapaneseDate(pageText, source.url, collectedAt),
        officialUrl: source.url,
        source,
        image,
        text: pageText,
        collectedAt,
      }));
    }
  }

  return dedupeCandidates(candidates);
}

export function discoverProductLinks(source, html) {
  const links = new Map();
  for (const match of String(html).matchAll(/<a\b[^>]*href\s*=\s*(["'])([\s\S]*?)\1[^>]*>([\s\S]*?)<\/a>/gi)) {
    const url = resolveUrl(match[2], source.url);
    if (!url || !isOfficialHost(url) || url === source.url) continue;
    const text = stripHtml(match[3]);
    let path = "";
    try { path = new URL(url).pathname; } catch { continue; }
    const relevantPath = /\/(?:products|info|ex|product)(?:\/|$)/.test(path);
    const relevantText = PRODUCT_PREFIX_RE.test(text) || /商品|発売|30th CELEBRATION/.test(text);
    if (!relevantPath || !relevantText) continue;
    links.set(url, { url, text });
  }
  return [...links.values()];
}

export function productFingerprint(candidate) {
  return createHash("sha1")
    .update(`${normalizeProductName(candidate.name)}|${candidate.releaseDate || ""}`)
    .digest("hex")
    .slice(0, 12);
}

export function inspectImageBuffer(buffer, contentType = "") {
  const bytes = Buffer.from(buffer);
  let width = 0;
  let height = 0;
  let format = "";

  if (bytes.length >= 24 && bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) {
    format = "png";
    width = bytes.readUInt32BE(16);
    height = bytes.readUInt32BE(20);
  } else if (bytes.length >= 12 && bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP") {
    format = "webp";
    const chunk = bytes.toString("ascii", 12, 16);
    if (chunk === "VP8X" && bytes.length >= 30) {
      width = 1 + bytes.readUIntLE(24, 3);
      height = 1 + bytes.readUIntLE(27, 3);
    } else if (chunk === "VP8 " && bytes.length >= 30) {
      width = bytes.readUInt16LE(26) & 0x3fff;
      height = bytes.readUInt16LE(28) & 0x3fff;
    } else if (chunk === "VP8L" && bytes.length >= 25) {
      const bits = bytes.readUInt32LE(21);
      width = (bits & 0x3fff) + 1;
      height = ((bits >> 14) & 0x3fff) + 1;
    }
  } else if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    format = "jpg";
    let offset = 2;
    while (offset + 9 < bytes.length) {
      if (bytes[offset] !== 0xff) { offset += 1; continue; }
      const marker = bytes[offset + 1];
      const length = bytes.readUInt16BE(offset + 2);
      if ([0xc0,0xc1,0xc2,0xc3,0xc5,0xc6,0xc7,0xc9,0xca,0xcb,0xcd,0xce,0xcf].includes(marker)) {
        height = bytes.readUInt16BE(offset + 5);
        width = bytes.readUInt16BE(offset + 7);
        break;
      }
      if (!length || length < 2) break;
      offset += 2 + length;
    }
  } else if (/svg/i.test(contentType) || bytes.subarray(0, 300).toString("utf8").includes("<svg")) {
    format = "svg";
    const head = bytes.subarray(0, 2000).toString("utf8");
    width = Number(head.match(/\bwidth=["'](\d+)/i)?.[1] || 0);
    height = Number(head.match(/\bheight=["'](\d+)/i)?.[1] || 0);
    if ((!width || !height) && head.match(/viewBox=["'][^"']*\s(\d+(?:\.\d+)?)\s(\d+(?:\.\d+)?)/i)) {
      const match = head.match(/viewBox=["'][^"']*\s(\d+(?:\.\d+)?)\s(\d+(?:\.\d+)?)/i);
      width = Number(match[1]); height = Number(match[2]);
    }
  }

  const valid = bytes.length >= 4_000 && width >= 120 && height >= 120 && Boolean(format);
  return { valid, format, width, height, bytes: bytes.length, contentType };
}
