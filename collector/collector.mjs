import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseSourceDocument } from "./lib/parser.mjs";
import { dedupeItems, keepRelevant, sanitizeForPublic } from "./lib/dedupe.mjs";
import { validateWithAI } from "./lib/ai-router.mjs";
import { discoverCandidateLinks, pageLooksRelevant } from "./lib/discovery.mjs";
import { collectXLotteryCandidates } from "./lib/x-collector.mjs";
import { loadProductCatalog, evaluateCandidate } from "./lib/quality-gate.mjs";
import { verifyDestination } from "./lib/destination-verifier.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const SOURCES_PATH = process.env.POKECA_SOURCES_PATH || path.join(ROOT, ".private", "sources.json");
const FEED_PATH = process.env.POKECA_FEED_PATH || path.join(ROOT, "lottery-feed.json");
const STATUS_PATH = process.env.POKECA_STATUS_PATH || path.join(ROOT, "collector-status.json");
const REVIEW_PATH = process.env.POKECA_REVIEW_PATH || path.join(ROOT, ".private", "review-queue.json");
const FIXTURE_PATH = process.env.POKECA_FIXTURE_PATH || "";
const X_SOURCES_PATH = process.env.POKECA_X_SOURCES_PATH || path.join(ROOT, ".private", "x-sources.json");
const PRODUCT_CATALOG_PATH = path.join(ROOT, "product-catalog.json");
const QUALITY_STATUS_PATH = process.env.POKECA_QUALITY_STATUS_PATH || path.join(ROOT, "data-quality-status.json");
const MANUAL_LOTTERIES_PATH = process.env.POKECA_MANUAL_LOTTERIES_PATH || path.join(ROOT, "manual-lotteries.json");

async function readJson(file, fallback) {
  try {
    return JSON.parse(await fs.readFile(file, "utf8"));
  } catch {
    return fallback;
  }
}

async function writeJson(file, value) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function fetchHtml(source) {
  if (FIXTURE_PATH) return fs.readFile(FIXTURE_PATH, "utf8");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20_000);
  try {
    const response = await fetch(source.url, {
      signal: controller.signal,
      redirect: "follow",
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; PokecaLifeCollector/1.13; +https://github.com/)",
        Accept: "text/html,application/xhtml+xml",
        "Accept-Language": "ja,en;q=0.5",
      },
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.text();
  } finally {
    clearTimeout(timer);
  }
}

async function enrichLivePocketCandidates(items, collectedAt) {
  const output = [];
  let enrichedCount = 0;
  for (const item of items) {
    let host = "";
    try { host = new URL(item.url || "").hostname.toLowerCase(); } catch {}
    if (!(host === "livepocket.jp" || host.endsWith(".livepocket.jp"))) {
      output.push(item);
      continue;
    }

    try {
      const html = await fetchHtml({ url: item.url });
      const [parsed] = parseSourceDocument({
        id: `x-livepocket-${item.xPostId || item.externalId}`,
        name: item.shop || "LivePocket",
        shop: item.shop || "",
        url: item.url,
        parser: "livepocket",
        type: item.type || "店舗",
        area: item.area || "全国",
        sourceKind: "x",
        publicSourceType: "LivePocket",
        officialDomains: ["livepocket.jp"],
        purchaseStartPolicy: "catalog-release",
      }, html, collectedAt);
      if (parsed) {
        output.push({
          ...item,
          ...parsed,
          externalId: item.externalId,
          xPostId: item.xPostId,
          xAuthor: item.xAuthor,
          sourceUrl: item.sourceUrl,
          sourceKind: "x",
          shop: parsed.shop || item.shop,
          area: parsed.area !== "全国" ? parsed.area : item.area,
          type: parsed.type || item.type,
          memo: [item.memo, parsed.memo].filter(Boolean).join("\n"),
          confidence: Math.max(Number(item.confidence || 0), Number(parsed.confidence || 0), 0.9),
        });
        enrichedCount += 1;
      } else {
        output.push(item);
      }
    } catch {
      output.push(item);
    }
    if (!FIXTURE_PATH) await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return { items: output, enrichedCount };
}

function applyCatalogPurchaseStart(candidate, catalogProduct) {
  if (candidate.purchaseStartPolicy !== "catalog-release" || !catalogProduct?.releaseDate) return candidate;
  const context = `${candidate.product || ""}\n${candidate.memo || ""}\n${candidate.rawApplyText || ""}`;
  if (/再販|再販売|キャンセル分|追加販売/.test(context)) return candidate;
  const releaseDate = String(catalogProduct.releaseDate || "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(releaseDate)) return candidate;
  const resultDate = candidate.resultStartDate || candidate.applyEndDate || "";
  const purchaseEnd = candidate.purchaseEndDate || "";
  if (resultDate && releaseDate < resultDate) return candidate;
  if (purchaseEnd && releaseDate > purchaseEnd) return candidate;
  candidate.purchaseStartDate = releaseDate;
  candidate.purchaseStartTime = "";
  candidate.memo = [candidate.memo, `購入開始は商品カタログの発売日 ${releaseDate.replaceAll("-", "/")} を使用`]
    .filter(Boolean).join("\n");
  return candidate;
}

async function run() {
  const startedAt = new Date().toISOString();
  const registry = await readJson(SOURCES_PATH, { sources: [] });
  const enabledSources = registry.sources.filter((source) => source.enabled !== false);
  const blockedDestinationDomains = Array.isArray(registry.blockedDestinationDomains)
    ? registry.blockedDestinationDomains
    : [];
  const previousFeed = await readJson(FEED_PATH, { lotteries: [] });
  const productCatalog = await loadProductCatalog(PRODUCT_CATALOG_PATH);
  const trustedPrevious = (previousFeed.lotteries || []).filter((item) => item.qualityVersion >= 2 && item.verified === true);
  const manualPayload = await readJson(MANUAL_LOTTERIES_PATH, { lotteries: [] });
  const manualLotteries = (Array.isArray(manualPayload) ? manualPayload : manualPayload.lotteries || [])
    .filter((item) => item && typeof item === "object")
    .map((item) => ({
      ...item,
      sourceKind: "manual",
      sourceType: "Administrator manual entry",
      manualEntry: true,
      adminPublished: true,
      confidence: Math.max(0.99, Number(item.confidence || 0)),
      collectedAt: item.collectedAt || item.createdAt || startedAt,
      updatedAt: item.updatedAt || startedAt,
    }));

  const collected = [...manualLotteries];
  const sourceResults = [{
    id: "manual-admin",
    name: "Administrator manual entries",
    ok: true,
    itemCount: manualLotteries.length,
    discoveredPages: 0,
    elapsedMs: 0,
  }];
  const seenDocumentUrls = new Set();
  let livePocketDiscoveredCount = 0;

  for (const source of enabledSources) {
    const started = Date.now();
    try {
      const html = await fetchHtml(source);
      const documents = [{ source, html }];
      const discovered = discoverCandidateLinks(source, html);

      for (const candidate of discovered) {
        if (seenDocumentUrls.has(candidate.url)) continue;
        seenDocumentUrls.add(candidate.url);
        const childSource = {
          ...source,
          url: candidate.url,
          parser: candidate.parser || source.discovery?.childParser || source.childParser || source.parser,
          discoveryParentUrl: source.url,
          discoveryLinkText: candidate.text || "",
          discovery: { enabled: false },
        };
        try {
          const childHtml = await fetchHtml(childSource);
          if (pageLooksRelevant(source, childHtml)) {
            documents.push({ source: childSource, html: childHtml });
            let host = "";
            try { host = new URL(candidate.url).hostname.toLowerCase(); } catch {}
            if (host === "livepocket.jp" || host.endsWith(".livepocket.jp")) livePocketDiscoveredCount += 1;
          }
        } catch (error) {
          // A failed child page does not fail the parent source.
        }
        if (!FIXTURE_PATH) await new Promise((resolve) => setTimeout(resolve, 800));
      }

      const items = documents.flatMap((document) =>
        parseSourceDocument(document.source, document.html, startedAt)
      );
      collected.push(...items);
      sourceResults.push({
        id: source.id,
        name: source.name,
        ok: true,
        itemCount: items.length,
        discoveredPages: Math.max(0, documents.length - 1),
        elapsedMs: Date.now() - started,
      });
    } catch (error) {
      sourceResults.push({
        id: source.id,
        name: source.name,
        ok: false,
        itemCount: 0,
        elapsedMs: Date.now() - started,
        error: String(error?.message || error),
      });
    }

    // Be polite to official sites.
    if (!FIXTURE_PATH) await new Promise((resolve) => setTimeout(resolve, 1500));
  }

  const xResult = FIXTURE_PATH
    ? { items: [], meta: { status: "not_configured", accountCount: 12, queryCount: 0, postCount: 0, itemCount: 0 } }
    : await collectXLotteryCandidates({
        configPath: X_SOURCES_PATH,
        bearerToken: process.env.X_API_BEARER_TOKEN || "",
        privateAccountsJson: process.env.X_MONITOR_ACCOUNTS_JSON || "",
      });
  const xEnrichment = FIXTURE_PATH
    ? { items: xResult.items, enrichedCount: 0 }
    : await enrichLivePocketCandidates(xResult.items, startedAt);
  collected.push(...xEnrichment.items);

  const merged = keepRelevant(dedupeItems([
    ...trustedPrevious,
    ...collected,
  ]));

  const published = [];
  const reviewQueue = [];
  const rejected = [];
  let directVerifiedCount = 0;
  let catalogMatchedCount = 0;

  for (const rawCandidate of merged) {
    let candidate = { ...rawCandidate };

    if (candidate.sourceKind === "manual" || candidate.manualEntry === true) {
      const gate = evaluateCandidate(candidate, productCatalog, new Date(startedAt), { blockedDestinationDomains });
      if (gate.catalogProduct) {
        candidate.product = gate.catalogProduct.name;
        candidate.productCatalogId = gate.catalogProduct.id;
        catalogMatchedCount += 1;
      }
      const hasMinimum = Boolean(candidate.shop && candidate.product && (candidate.applyEndDate || candidate.deadline) && (candidate.resultStartDate || candidate.resultDate));
      if (hasMinimum) {
        published.push(sanitizeForPublic({
          ...candidate,
          manualEntry: true,
          adminPublished: true,
          verified: true,
          qualityVersion: 2,
          confidence: 0.99,
          verificationChecks: { ...gate.checks, administratorApproved: true },
        }));
      } else {
        reviewQueue.push({
          ...candidate,
          qualityVersion: 2,
          reviewReasons: ["管理者入力の必須項目不足"],
          reviewReason: "管理者入力の必須項目不足",
        });
      }
      continue;
    }

    const intelligence = candidate.sourceKind === "aggregated" || candidate.sourceKind === "intelligence" || candidate.sourceKind === "x";
    const officialNotice = Boolean(candidate.noticeOnly && (candidate.officialAccount || candidate.officialNotice));

    if (intelligence && candidate.url && !officialNotice) {
      const verification = await verifyDestination(candidate, async ({ url }) => fetchHtml({ url }), { blockedDestinationDomains });
      candidate.destinationVerified = verification.ok;
      candidate.destinationHost = verification.host;
      candidate.destinationVerificationReason = verification.reason;
    } else if (officialNotice) {
      candidate.destinationVerified = true;
    } else if (!intelligence) {
      candidate.destinationVerified = candidate.url ? true : false;
    }

    let gate = evaluateCandidate(candidate, productCatalog, new Date(startedAt), { blockedDestinationDomains });
    if (gate.catalogProduct) {
      candidate.product = gate.catalogProduct.name;
      candidate.productCatalogId = gate.catalogProduct.id;
      applyCatalogPurchaseStart(candidate, gate.catalogProduct);
      catalogMatchedCount += 1;
      gate = evaluateCandidate(candidate, productCatalog, new Date(startedAt), { blockedDestinationDomains });
    }
    if (gate.checks.directDestination && gate.checks.destinationVerified) directVerifiedCount += 1;

    let finalConfidence = Number(candidate.confidence || 0);
    if (!gate.accepted && finalConfidence < 0.8) {
      const ai = await validateWithAI(candidate);
      if (ai.enabled && ai.accepted) {
        finalConfidence = Math.max(finalConfidence, Number(ai.confidence || 0));
        candidate.confidence = Number(finalConfidence.toFixed(2));
        gate = evaluateCandidate(candidate, productCatalog, new Date(startedAt), { blockedDestinationDomains });
      }
    }

    if (gate.accepted) {
      const publicCandidate = sanitizeForPublic({
        ...candidate,
        verified: true,
        qualityVersion: 2,
        confidence: Number(Math.max(0.86, finalConfidence).toFixed(2)),
        verificationChecks: gate.checks,
      });
      published.push(publicCandidate);
    } else {
      const entry = {
        ...candidate,
        qualityVersion: 2,
        reviewReasons: gate.reasons,
        reviewReason: gate.reasons[0] || "公開条件を満たしません",
      };
      const hardReject = gate.reasons.some((reason) => /履歴保持期間|遠すぎ|開始日が締切日より後|日付と曜日/.test(reason));
      if (hardReject) rejected.push(entry);
      else reviewQueue.push(entry);
    }
  }

  const successCount = sourceResults.filter((result) => result.ok).length;
  const failedCount = sourceResults.length - successCount;
  const webSourceResults = sourceResults.filter((result) => result.id !== "manual-admin");
  const sourceHealth = {
    checkedCount: webSourceResults.length,
    successfulCount: webSourceResults.filter((result) => result.ok).length,
    failedCount: webSourceResults.filter((result) => !result.ok).length,
    withItemsCount: webSourceResults.filter((result) => result.ok && Number(result.itemCount || 0) > 0).length,
    zeroItemsCount: webSourceResults.filter((result) => result.ok && Number(result.itemCount || 0) === 0).length,
    discoveredPageCount: webSourceResults.reduce((sum, result) => sum + Number(result.discoveredPages || 0), 0),
  };
  const autoCollectedCount = collected.filter((item) => item.sourceKind !== "manual" && item.manualEntry !== true).length;
  const multiProductExpandedCount = collected.filter((item) => item.collectionMode === "official-news-multi-product").length;
  const quality = {
    qualityVersion: 2,
    candidateCount: merged.length,
    publishedCount: published.length,
    reviewCount: reviewQueue.length,
    rejectedCount: rejected.length,
    directVerifiedCount,
    catalogMatchedCount,
    autoCollectedCount,
    multiProductExpandedCount,
    rule: "catalog+deadline+direct-destination-or-official-store-notice",
  };
  const meta = {
    collectorVersion: "1.21.0",
    lastRunAt: startedAt,
    status: failedCount === 0 ? "ok" : "partial",
    reviewCount: reviewQueue.length,
    publishedCount: published.length,
    historyDays: 35,
    manualEntryCount: manualLotteries.length,
    checkedSourceCount: enabledSources.length,
    successfulSourceCount: sourceResults.filter((result) => result.ok && result.id !== "manual-admin").length,
    failedSourceCount: sourceResults.filter((result) => !result.ok).length,
    sourceHealth,
    autoCollectedCount,
    multiProductExpandedCount,
    livePocketDiscoveredCount,
    xLivePocketEnrichedCount: xEnrichment.enrichedCount,
    xCollectorStatus: xResult.meta?.status || "not_configured",
    xOfficialAccountCount: Number(xResult.meta?.officialAccountCount || 0),
    xPostCount: Number(xResult.meta?.postCount || 0),
    xItemCount: Number(xResult.meta?.itemCount || 0),
    quality,
  };

  await writeJson(FEED_PATH, {
    version: 1,
    updatedAt: startedAt,
    meta,
    lotteries: published.sort((a, b) =>
      String(b.collectedAt || "").localeCompare(String(a.collectedAt || ""))
    ),
  });

  await writeJson(STATUS_PATH, meta);
  await writeJson(REVIEW_PATH, {
    updatedAt: startedAt,
    items: reviewQueue,
    rejected,
  });
  await writeJson(QUALITY_STATUS_PATH, {
    updatedAt: startedAt,
    ...quality,
  });

  console.log(JSON.stringify({
    ok: failedCount === 0,
    collected: collected.length,
    published: published.length,
    review: reviewQueue.length,
    rejected: rejected.length,
    manualEntryCount: manualLotteries.length,
    autoCollectedCount,
    multiProductExpandedCount,
    checkedSourceCount: enabledSources.length + 1,
    successfulSourceCount: successCount,
    failedSourceCount: failedCount,
    sourceHealth,
    livePocketDiscoveredCount,
    xLivePocketEnrichedCount: xEnrichment.enrichedCount,
  }, null, 2));
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
