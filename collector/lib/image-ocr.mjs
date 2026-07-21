import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { htmlToText } from "./html.mjs";

const execFileAsync = promisify(execFile);

function decodeAttribute(value = "") {
  return String(value)
    .replace(/&amp;/gi, "&")
    .replace(/&#x2f;/gi, "/")
    .replace(/&#47;/g, "/");
}

function imageAttribute(tag = "", name = "") {
  return tag.match(new RegExp(`\\b${name}\\s*=\\s*(["'])([\\s\\S]*?)\\1`, "i"))?.[2] || "";
}

function numericAttribute(tag = "", name = "") {
  const value = imageAttribute(tag, name) || tag.match(new RegExp(`\\b${name}\\s*=\\s*(\\d+)`, "i"))?.[1] || "";
  return Number(value || 0);
}

function normalizeHost(value = "") {
  return String(value || "").toLowerCase().replace(/^www\./, "");
}

function candidateScore(candidate) {
  let score = 0;
  const url = candidate.url.toLowerCase();
  const alt = candidate.alt.toLowerCase();
  if (/\/storage\/news\/|\/news\/|\/uploads?\//.test(url)) score += 6;
  if (/\.(?:jpe?g|webp)(?:$|\?)/.test(url)) score += 3;
  if (/\d{6,}/.test(url)) score += 2;
  if (/ポケモン|抽選|カード|商品/.test(candidate.alt)) score += 4;
  if (candidate.width >= 600 || candidate.height >= 600) score += 4;
  if (candidate.width && candidate.width < 280) score -= 8;
  if (candidate.height && candidate.height < 280) score -= 8;
  if (/logo|icon|banner|button|btn|header|footer|sns|twitter|instagram|youtube|fa\.png|od\.png/.test(`${url} ${alt}`)) score -= 10;
  return score;
}

export function extractOcrImageCandidates(html = "", baseUrl = "", options = {}) {
  let baseHost = "";
  try { baseHost = normalizeHost(new URL(baseUrl).hostname); } catch {}
  const sameHostOnly = options.sameHostOnly !== false;
  const output = [];
  const seen = new Set();
  const tags = String(html).match(/<img\b[^>]*>/gi) || [];

  for (const tag of tags) {
    const raw = imageAttribute(tag, "data-src")
      || imageAttribute(tag, "data-original")
      || imageAttribute(tag, "data-lazy-src")
      || imageAttribute(tag, "src");
    if (!raw || /^data:/i.test(raw)) continue;
    let url;
    try { url = new URL(decodeAttribute(raw), baseUrl); } catch { continue; }
    if (!/^https?:$/.test(url.protocol)) continue;
    const host = normalizeHost(url.hostname);
    if (sameHostOnly && baseHost && host !== baseHost && !host.endsWith(`.${baseHost}`)) continue;
    url.hash = "";
    const href = url.href;
    if (seen.has(href)) continue;
    seen.add(href);
    const candidate = {
      url: href,
      alt: htmlToText(imageAttribute(tag, "alt")),
      width: numericAttribute(tag, "width"),
      height: numericAttribute(tag, "height"),
    };
    candidate.score = candidateScore(candidate);
    output.push(candidate);
  }

  return output
    .filter((candidate) => candidate.score > -5)
    .sort((a, b) => b.score - a.score)
    .slice(0, Number(options.maxImages || 2));
}

export function normalizeOcrText(value = "") {
  return String(value || "")
    .normalize("NFKC")
    .replace(/\r/g, "")
    .replace(/(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日/g, "$1年$2月$3日")
    .replace(/(\d{1,2})\s*月\s*(\d{1,2})\s*日/g, "$1月$2日")
    .replace(/(\d{4})\s*[.\/-]\s*(\d{1,2})\s*[.\/-]\s*(\d{1,2})/g, "$1/$2/$3")
    .replace(/\b(\d{1,2})A(\d{1,2})48\b/g, "$1月$2日")
    .replace(/\be\s*x\b/gi, "ex")
    .replace(/イープイ/g, "イーブイ")
    .replace(/[\[\]]/g, (value) => value === "[" ? "「" : "」")
    .replace(/[ \t]+/g, " ")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function escapeHtml(value = "") {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

async function fetchImageBuffer(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Number(options.timeoutMs || 20_000));
  try {
    const response = await (options.fetchImpl || fetch)(url, {
      signal: controller.signal,
      redirect: "follow",
      headers: {
        "User-Agent": options.userAgent || "Mozilla/5.0 PokecaLife-OCR/1.0",
        Accept: "image/avif,image/webp,image/png,image/jpeg,image/*;q=0.8",
        "Accept-Language": "ja-JP,ja;q=0.9",
      },
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const type = String(response.headers.get("content-type") || "").toLowerCase();
    if (type && !type.startsWith("image/")) throw new Error(`Not an image: ${type}`);
    const buffer = Buffer.from(await response.arrayBuffer());
    const maxBytes = Number(options.maxBytes || 5_000_000);
    if (buffer.length < 8_000) throw new Error("Image too small for OCR");
    if (buffer.length > maxBytes) throw new Error("Image too large for OCR");
    return { buffer, contentType: type };
  } finally {
    clearTimeout(timer);
  }
}

function extensionFromType(contentType = "", url = "") {
  if (contentType.includes("png")) return ".png";
  if (contentType.includes("webp")) return ".webp";
  if (contentType.includes("jpeg") || contentType.includes("jpg")) return ".jpg";
  try {
    const ext = path.extname(new URL(url).pathname).toLowerCase();
    return [".jpg", ".jpeg", ".png", ".webp"].includes(ext) ? ext : ".img";
  } catch { return ".img"; }
}

export async function runTesseractOcr(buffer, options = {}) {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "pokeca-ocr-"));
  const file = path.join(tempDir, `source${options.extension || ".img"}`);
  try {
    await fs.writeFile(file, buffer);
    const args = [file, "stdout", "-l", options.languages || "jpn+eng", "--psm", String(options.psm || 6)];
    const { stdout } = await execFileAsync(options.command || "tesseract", args, {
      timeout: Number(options.timeoutMs || 50_000),
      maxBuffer: Number(options.maxBuffer || 6_000_000),
      windowsHide: true,
    });
    return normalizeOcrText(stdout);
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

function needsImageOcr(source, html = "") {
  if (source?.ocr?.enabled === false) return false;
  if (!(source?.ocr?.enabled === true || source?.parser === "furuichi-news")) return false;
  const text = htmlToText(html);
  const productCount = (text.match(/(?:拡張パック|強化拡張パック|ハイクラスパック|スターターセットex|スタートデッキ)/g) || []).length;
  const hasDeadline = /(?:応募期間|受付期間|抽選受付日時)[^\n]{0,100}\d{1,2}[\/月]\d{1,2}/.test(text);
  return productCount < 2 || !hasDeadline;
}

export async function enrichHtmlWithImageOcr(source, html = "", options = {}) {
  if (!needsImageOcr(source, html)) return { html, applied: false, imageCount: 0, textLength: 0, errors: [] };
  const candidates = extractOcrImageCandidates(html, source?.url || "", {
    maxImages: source?.ocr?.maxImages || options.maxImages || 1,
    sameHostOnly: source?.ocr?.sameHostOnly !== false,
  });
  if (!candidates.length) return { html, applied: false, imageCount: 0, textLength: 0, errors: [] };

  const texts = [];
  const errors = [];
  for (const candidate of candidates) {
    try {
      const image = await fetchImageBuffer(candidate.url, options);
      const text = await (options.ocrImpl || runTesseractOcr)(image.buffer, {
        extension: extensionFromType(image.contentType, candidate.url),
        languages: source?.ocr?.languages || options.languages || "jpn+eng",
        psm: source?.ocr?.psm || options.psm || 6,
        timeoutMs: source?.ocr?.timeoutMs || options.ocrTimeoutMs || 50_000,
      });
      if (text && /ポケモンカード|ポケカ|拡張パック|スターターセット|スタートデッキ/i.test(text)) texts.push(text);
    } catch (error) {
      errors.push(String(error?.message || error).slice(0, 160));
    }
  }

  const ocrText = normalizeOcrText(texts.join("\n"));
  if (!ocrText) return { html, applied: false, imageCount: 0, textLength: 0, errors };
  return {
    html: `${html}\n<pre data-pokeca-ocr="true">${escapeHtml(ocrText)}</pre>`,
    applied: true,
    imageCount: texts.length,
    textLength: ocrText.length,
    errors,
  };
}
