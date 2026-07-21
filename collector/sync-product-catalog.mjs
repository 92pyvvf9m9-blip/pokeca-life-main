import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import {
  parseOfficialProductDocument,
  discoverProductLinks,
  normalizeProductName,
  productFingerprint,
  inspectImageBuffer,
  isPlausibleProductName,
} from "./lib/product-catalog-parser.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const SOURCES_PATH = process.env.POKECA_PRODUCT_SOURCES_PATH || path.join(ROOT, ".private", "product-sources.json");
const CATALOG_PATH = process.env.POKECA_PRODUCT_CATALOG_PATH || path.join(ROOT, "product-catalog.json");
const AUDIT_PATH = process.env.POKECA_PRODUCT_AUDIT_PATH || path.join(ROOT, "product-image-audit.json");
const STATUS_PATH = process.env.POKECA_PRODUCT_STATUS_PATH || path.join(ROOT, "product-catalog-status.json");
const REVIEW_PATH = process.env.POKECA_PRODUCT_REVIEW_PATH || path.join(ROOT, ".private", "product-review-queue.json");
const INDEX_PATH = process.env.POKECA_PRODUCT_INDEX_PATH || path.join(ROOT, "index.html");
const IMAGE_DIR = process.env.POKECA_PRODUCT_IMAGE_DIR || path.join(ROOT, "assets", "product-images");
const FIXTURE_PATH = process.env.POKECA_PRODUCT_FIXTURE_PATH || "";
const NOW = new Date();

async function readJson(file, fallback) {
  try { return JSON.parse(await fs.readFile(file, "utf8")); } catch { return fallback; }
}
async function writeJson(file, value) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}
async function wait(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

function officialHost(url) {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return host === "pokemon-card.com" || host.endsWith(".pokemon-card.com");
  } catch { return false; }
}

async function fetchResponse(url, accept = "text/html,application/xhtml+xml") {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 25_000);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      redirect: "follow",
      headers: {
        "User-Agent": "PokecaLifeProductCatalogBot/1.0 (+low-frequency official-product-monitor)",
        Accept: accept,
        "Accept-Language": "ja,en;q=0.5",
        "Cache-Control": "no-cache",
      },
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response;
  } finally { clearTimeout(timer); }
}

async function fetchHtml(url) {
  if (FIXTURE_PATH) return fs.readFile(FIXTURE_PATH, "utf8");
  return (await fetchResponse(url)).text();
}

function mergeCandidates(candidates) {
  const map = new Map();
  for (const candidate of candidates) {
    const key = normalizeProductName(candidate.name);
    if (!key) continue;
    const previous = map.get(key);
    if (!previous) { map.set(key, candidate); continue; }
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

function extensionFor(info, contentType, url) {
  if (info.format === "jpg") return ".jpg";
  if (info.format === "png") return ".png";
  if (info.format === "webp") return ".webp";
  if (info.format === "svg") return ".svg";
  const type = String(contentType).toLowerCase();
  if (type.includes("jpeg")) return ".jpg";
  if (type.includes("png")) return ".png";
  if (type.includes("webp")) return ".webp";
  try {
    const ext = path.extname(new URL(url).pathname).toLowerCase();
    return [".jpg", ".jpeg", ".png", ".webp", ".svg"].includes(ext) ? (ext === ".jpeg" ? ".jpg" : ext) : ".img";
  } catch { return ".img"; }
}

async function downloadVerifiedImage(candidate) {
  if (!candidate.imageUrl || !officialHost(candidate.imageUrl)) {
    return { ok: false, reason: "公式ドメインの画像URLを確定できません" };
  }
  try {
    const response = await fetchResponse(candidate.imageUrl, "image/avif,image/webp,image/png,image/jpeg,image/svg+xml,image/*;q=0.8");
    const contentType = response.headers.get("content-type") || "";
    const buffer = Buffer.from(await response.arrayBuffer());
    const info = inspectImageBuffer(buffer, contentType);
    if (!info.valid) return { ok: false, reason: `画像検証失敗 ${info.format || "unknown"} ${info.width}x${info.height} ${info.bytes}bytes`, info };

    const hash = createHash("sha1").update(`${candidate.imageUrl}|${buffer.length}`).digest("hex").slice(0, 12);
    const filename = `auto-${candidate.releaseDate || "undated"}-${hash}${extensionFor(info, contentType, candidate.imageUrl)}`;
    const filepath = path.join(IMAGE_DIR, filename);
    await fs.mkdir(IMAGE_DIR, { recursive: true });
    try { await fs.access(filepath); } catch { await fs.writeFile(filepath, buffer); }
    return {
      ok: true,
      imagePath: `./assets/product-images/${filename}`,
      imageSource: candidate.imageUrl,
      imageInfo: info,
    };
  } catch (error) {
    return { ok: false, reason: String(error?.message || error) };
  }
}

function makeProductId(candidate) {
  return `pcg-${candidate.releaseDate || "undated"}-${productFingerprint(candidate)}`;
}

function recentEnough(releaseDate) {
  if (!releaseDate) return false;
  const year = Number(releaseDate.slice(0, 4));
  return year >= NOW.getFullYear() - 2 && year <= NOW.getFullYear() + 2;
}

function productCompleteness(candidate) {
  const reasons = [];
  if (!candidate.name) reasons.push("商品名なし");
  else if (!isPlausibleProductName(candidate.name)) reasons.push("商品名に説明文・記事見出しが混入しています");
  if (!candidate.releaseDate) reasons.push("発売日なし");
  if (!candidate.officialUrl || !officialHost(candidate.officialUrl)) reasons.push("公式商品ページなし");
  if (!candidate.imageUrl || !officialHost(candidate.imageUrl)) reasons.push("公式商品画像なし");
  if ((candidate.confidence || 0) < 0.8) reasons.push("解析信頼度不足");
  return reasons;
}

function buildAudit(catalog, updatedAt) {
  const products = catalog.products.map((product) => ({
    id: product.id,
    name: product.name,
    releaseDate: product.releaseDate,
    localImage: product.imagePath || "",
    verified: product.imageVerified === true,
    status: product.imageStatus || (product.imageVerified ? "official-verified" : "missing"),
    autoManaged: product.autoManaged === true,
    lastSeenAt: product.lastSeenAt || "",
  }));
  const verified = products.filter((product) => product.verified && product.localImage).length;
  return {
    version: 2,
    updatedAt,
    summary: {
      totalProducts: products.length,
      verifiedImages: verified,
      missingImages: products.length - verified,
      placeholderImages: 0,
      coveragePercent: products.length ? Number(((verified / products.length) * 100).toFixed(1)) : 0,
      scope: "現在の商品カタログ登録商品",
    },
    products,
  };
}

async function updateIndexFallback(catalog) {
  let html = await fs.readFile(INDEX_PATH, "utf8");
  const fallback = JSON.stringify(catalog);
  const imageMap = Object.fromEntries(catalog.products.filter((product) => product.imagePath).map((product) => [product.id, product.imagePath]));
  const before = html;
  html = html.replace(/const PRODUCT_CATALOG_FALLBACK=[\s\S]*?;\nlet productCatalogState=/, `const PRODUCT_CATALOG_FALLBACK=${fallback};\nlet productCatalogState=`);
  html = html.replace(/const PRODUCT_IMAGE_PATHS=\{[\s\S]*?\};/, `const PRODUCT_IMAGE_PATHS=${JSON.stringify(imageMap)};`);
  if (html === before) throw new Error("index.htmlの商品カタログ埋め込み位置を更新できません");
  await fs.writeFile(INDEX_PATH, html, "utf8");
}

async function run() {
  const startedAt = new Date().toISOString();
  const registry = await readJson(SOURCES_PATH, { sources: [] });
  const catalog = await readJson(CATALOG_PATH, { version: 4, products: [] });
  const catalogBeforePrune = Array.isArray(catalog.products) ? catalog.products.length : 0;
  catalog.products = (Array.isArray(catalog.products) ? catalog.products : []).filter(
    (product) => product.autoManaged !== true || isPlausibleProductName(product.name)
  );
  const prunedInvalidProductCount = catalogBeforePrune - catalog.products.length;
  const enabledSources = registry.sources.filter((source) => source.enabled !== false);
  const candidates = [];
  const sourceResults = [];

  for (const source of enabledSources) {
    const started = Date.now();
    try {
      const rootHtml = await fetchHtml(source.url);
      const documents = [{ source, html: rootHtml }];
      if (!FIXTURE_PATH && source.discoverLinks !== false) {
        const links = discoverProductLinks(source, rootHtml).slice(0, Number(source.maxPages || 12));
        for (const link of links) {
          try {
            const childSource = { ...source, url: link.url };
            const childHtml = await fetchHtml(link.url);
            documents.push({ source: childSource, html: childHtml });
          } catch {
            // A child page failure does not fail the source root.
          }
          await wait(Number(source.childDelayMs || 650));
        }
      }
      const items = documents.flatMap(({ source: documentSource, html }) => parseOfficialProductDocument(documentSource, html, startedAt));
      candidates.push(...items);
      sourceResults.push({
        id: source.id,
        name: source.name,
        ok: true,
        pageCount: documents.length,
        candidateCount: items.length,
        elapsedMs: Date.now() - started,
      });
    } catch (error) {
      sourceResults.push({ id: source.id, name: source.name, ok: false, pageCount: 0, candidateCount: 0, elapsedMs: Date.now() - started, error: String(error?.message || error) });
    }
    if (!FIXTURE_PATH) await wait(Number(source.delayMs || 1200));
  }

  const merged = mergeCandidates(candidates).filter((candidate) => recentEnough(candidate.releaseDate));
  const existingByName = new Map(catalog.products.map((product) => [normalizeProductName(product.name), product]));
  const review = [];
  let newCount = 0;
  let updatedCount = 0;

  for (const candidate of merged) {
    const key = normalizeProductName(candidate.name);
    const existing = existingByName.get(key);
    const reasons = productCompleteness(candidate);

    if (existing) {
      let changed = false;
      const fill = {
        officialUrl: candidate.officialUrl,
        source: candidate.source,
        sourceUrl: candidate.sourceUrl,
        priceYen: candidate.priceYen,
        releaseDate: candidate.releaseDate,
        year: candidate.year,
        category: candidate.category,
        aliases: [...new Set([...(existing.aliases || []), ...(candidate.aliases || [])])],
        lastSeenAt: startedAt,
      };
      for (const [field, value] of Object.entries(fill)) {
        if (value !== undefined && value !== "" && JSON.stringify(existing[field]) !== JSON.stringify(value)) {
          existing[field] = value;
          changed = true;
        }
      }
      if ((!existing.imageVerified || !existing.imagePath) && !reasons.includes("公式商品画像なし")) {
        const image = await downloadVerifiedImage(candidate);
        if (image.ok) {
          Object.assign(existing, {
            imagePath: image.imagePath,
            imageVerified: true,
            imageSource: image.imageSource,
            imageStatus: "official-verified",
            imageSourceType: "official-product-image",
            imageSourceUrl: candidate.officialUrl,
            imageVerifiedAt: startedAt,
            imageInfo: image.imageInfo,
            autoManaged: true,
          });
          changed = true;
        } else {
          review.push({ ...candidate, existingProductId: existing.id, reviewReasons: [image.reason] });
        }
      }
      if (changed) updatedCount += 1;
      continue;
    }

    if (reasons.length) {
      review.push({ ...candidate, reviewReasons: reasons });
      continue;
    }
    const image = await downloadVerifiedImage(candidate);
    if (!image.ok) {
      review.push({ ...candidate, reviewReasons: [image.reason] });
      continue;
    }

    const product = {
      id: makeProductId(candidate),
      year: candidate.year,
      releaseDate: candidate.releaseDate,
      name: candidate.name,
      category: candidate.category,
      aliases: candidate.aliases,
      officialUrl: candidate.officialUrl,
      source: candidate.source,
      priceYen: candidate.priceYen,
      imagePath: image.imagePath,
      imageVerified: true,
      imageSource: image.imageSource,
      imageStatus: "official-verified",
      imageSourceType: "official-product-image",
      imageSourceUrl: candidate.officialUrl,
      imageVerifiedAt: startedAt,
      imageInfo: image.imageInfo,
      autoManaged: true,
      discoveredAt: startedAt,
      lastSeenAt: startedAt,
      sourceFingerprint: productFingerprint(candidate),
    };
    catalog.products.push(product);
    existingByName.set(key, product);
    newCount += 1;
  }

  catalog.version = Math.max(4, Number(catalog.version || 1));
  catalog.updatedAt = startedAt;
  catalog.scope = "直近3年の主要カード商品。公式情報・発売日・実商品画像が揃った商品だけを自動公開。";
  catalog.automation = {
    enabled: true,
    schedule: "every-6-hours",
    publishRule: "name+releaseDate+officialPage+verifiedOfficialImage",
    lastRunAt: startedAt,
  };
  catalog.products.sort((a, b) => String(b.releaseDate || "").localeCompare(String(a.releaseDate || "")) || String(a.name || "").localeCompare(String(b.name || ""), "ja"));
  const audit = buildAudit(catalog, startedAt);
  catalog.imageCoverage = { ...audit.summary, scope: "現在の商品カタログ登録商品" };

  const successCount = sourceResults.filter((result) => result.ok).length;
  const failedCount = sourceResults.length - successCount;
  const status = {
    version: 1,
    collectorVersion: "1.12.0",
    lastRunAt: startedAt,
    mode: "automatic",
    schedule: "every-6-hours",
    sourceCount: enabledSources.length,
    successCount,
    failedCount,
    discoveredCandidateCount: merged.length,
    newProductCount: newCount,
    updatedProductCount: updatedCount,
    prunedInvalidProductCount,
    reviewCount: review.length,
    totalProducts: catalog.products.length,
    verifiedImages: audit.summary.verifiedImages,
    imageCoveragePercent: audit.summary.coveragePercent,
  };

  const privateProductKeys = [
    "source", "sourceUrl", "imageSource", "imageSourceUrl", "imageSourceType",
    "sourceFingerprint", "imageInfo", "lastSeenAt", "discoveredAt"
  ];
  const publicCatalog = {
    ...catalog,
    products: catalog.products.map((product) => {
      const output = { ...product };
      for (const key of privateProductKeys) delete output[key];
      return output;
    }),
  };
  const publicAudit = {
    ...audit,
    products: audit.products.map((product) => {
      const output = { ...product };
      delete output.sourceUrl;
      delete output.sourceType;
      return output;
    }),
  };

  await writeJson(CATALOG_PATH, publicCatalog);
  await writeJson(AUDIT_PATH, publicAudit);
  await writeJson(STATUS_PATH, status);
  await writeJson(REVIEW_PATH, { version: 1, updatedAt: startedAt, items: review });
  await updateIndexFallback(publicCatalog);

  console.log(JSON.stringify({
    ok: failedCount === 0,
    discoveredCandidateCount: merged.length,
    newProductCount: newCount,
    updatedProductCount: updatedCount,
    prunedInvalidProductCount,
    reviewCount: review.length,
    totalProducts: publicCatalog.products.length,
    checkedSourceCount: enabledSources.length,
    successfulSourceCount: successCount,
    failedSourceCount: failedCount,
  }, null, 2));
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
