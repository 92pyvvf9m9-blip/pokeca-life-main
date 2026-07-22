import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseSourceDocument } from "./lib/parser.mjs";
import { dedupeItems, keepRelevant, sanitizeForPublic } from "./lib/dedupe.mjs";
import { validateWithAI } from "./lib/ai-router.mjs";
import { discoverCandidateLinksDetailed, pageLooksRelevant } from "./lib/discovery.mjs";
import { collectXLotteryCandidates } from "./lib/x-collector.mjs";
import { loadProductCatalog, evaluateCandidate } from "./lib/quality-gate.mjs";
import { verifyDestination } from "./lib/destination-verifier.mjs";
import { normalizeSourceRegistry, summarizeSourceRegistry } from "./lib/source-registry.mjs";
import { DiscoveryStateTracker } from "./lib/discovery-state.mjs";
import { enrichHtmlWithImageOcr } from "./lib/image-ocr.mjs";
import { expandCatalogGroupCandidates } from "./lib/product-group-expander.mjs";
import { buildOfficialRevisitCandidates } from "./lib/official-revisit.mjs";
import { validatePublishedLotteries } from "./lib/published-feed-validator.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const APP_PACKAGE = JSON.parse(await fs.readFile(path.join(ROOT, "package.json"), "utf8"));
const APP_VERSION = String(APP_PACKAGE.version || "0.0.0");
const SOURCES_PATH = process.env.POKECA_SOURCES_PATH || path.join(ROOT, ".private", "sources.json");
const FEED_PATH = process.env.POKECA_FEED_PATH || path.join(ROOT, "lottery-feed.json");
const STATUS_PATH = process.env.POKECA_STATUS_PATH || path.join(ROOT, "collector-status.json");
const REVIEW_PATH = process.env.POKECA_REVIEW_PATH || path.join(ROOT, ".private", "review-queue.json");
const FIXTURE_PATH = process.env.POKECA_FIXTURE_PATH || "";
const X_SOURCES_PATH = process.env.POKECA_X_SOURCES_PATH || path.join(ROOT, ".private", "x-sources.json");
const PRODUCT_CATALOG_PATH = path.join(ROOT, "product-catalog.json");
const QUALITY_STATUS_PATH = process.env.POKECA_QUALITY_STATUS_PATH || path.join(ROOT, "data-quality-status.json");
const MANUAL_LOTTERIES_PATH = process.env.POKECA_MANUAL_LOTTERIES_PATH || path.join(ROOT, "manual-lotteries.json");
const DISCOVERY_STATE_PATH = process.env.POKECA_DISCOVERY_STATE_PATH || path.join(ROOT, "collector", "state", "discovery-state.json");

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

function publicErrorMessage(error) {
  return String(error?.message || error || "Unknown error")
    .replace(/https?:\/\/\S+/gi, "[URL]")
    .replace(/\/home\/runner\/work\/\S+/gi, "[PATH]")
    .slice(0, 180);
}

function classifySourceFailure(error) {
  const message = publicErrorMessage(error);
  if (/HTTP\s+(?:401|403|429)\b/i.test(message)) {
    return { failureClass: "access_blocked", severity: "warning" };
  }
  if (/HTTP\s+5\d\d\b|abort|timeout|timed out|fetch failed|network/i.test(message)) {
    return { failureClass: "temporary_fetch_error", severity: "warning" };
  }
  return { failureClass: "source_error", severity: "error" };
}

async function fetchDocument(source) {
  if (FIXTURE_PATH) {
    const html = await fs.readFile(FIXTURE_PATH, "utf8");
    return {
      html,
      statusCode: 200,
      contentType: "text/html; fixture",
      responseBytes: Buffer.byteLength(html, "utf8"),
      finalHostChanged: false,
      finalUrl: source.url,
    };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20_000);
  try {
    const response = await fetch(source.url, {
      signal: controller.signal,
      redirect: "follow",
      headers: {
        "User-Agent": `Mozilla/5.0 (compatible; Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 PokecaLife/${APP_VERSION}; +https://github.com/)`,
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
        "Accept-Language": "ja-JP,ja;q=0.9,en-US;q=0.6,en;q=0.4",
        "Cache-Control": "no-cache",
        Pragma: "no-cache",
        "Upgrade-Insecure-Requests": "1",
      },
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const html = await response.text();
    let originalHost = "";
    let finalHost = "";
    try { originalHost = new URL(source.url).hostname.toLowerCase(); } catch {}
    try { finalHost = new URL(response.url).hostname.toLowerCase(); } catch {}
    return {
      html,
      statusCode: response.status,
      contentType: String(response.headers.get("content-type") || "").slice(0, 100),
      responseBytes: Buffer.byteLength(html, "utf8"),
      finalHostChanged: Boolean(originalHost && finalHost && originalHost !== finalHost),
      finalUrl: response.url || source.url,
    };
  } finally {
    clearTimeout(timer);
  }
}

async function fetchHtml(source) {
  return (await fetchDocument(source)).html;
}

function isLivePocketSearchSource(source) {
  return source?.parser === "livepocket-search"
    || String(source?.id || "").startsWith("livepocket-public-");
}

function zeroItemReason(result) {
  if (!result.ok) return "source-fetch-failed";
  if (!result.discovery?.enabled) return "no-current-items";
  if (Number(result.discovery?.returnedCount || 0) === 0 && Number(result.discovery?.totalLinks || 0) === 0) {
    return "page-contained-no-links-or-was-client-rendered";
  }
  if (Number(result.discovery?.returnedCount || 0) === 0 && Number(result.discovery?.totalLinks || 0) > 0) {
    return "links-found-but-none-matched-discovery-rules";
  }
  if (Number(result.candidateFetchSuccessCount || 0) === 0 && Number(result.discovery?.returnedCount || 0) > 0) {
    return "candidate-pages-could-not-be-fetched";
  }
  if (Number(result.relevantPageCount || 0) === 0 && Number(result.candidateFetchSuccessCount || 0) > 0) {
    return "candidate-pages-did-not-look-relevant";
  }
  if (Number(result.discoveredItemCount || 0) === 0 && Number(result.relevantPageCount || 0) > 0) {
    return "relevant-pages-were-not-parsed-into-items";
  }
  return "no-current-items";
}

function canonicalGoogleFormUrl(value = "") {
  try {
    const url = new URL(String(value || ""));
    const host = url.hostname.toLowerCase();
    if (host === "forms.gle") {
      url.hash = "";
      url.search = "";
      url.pathname = url.pathname.replace(/\/+$/, "");
      return url.pathname && url.pathname !== "/" ? `https://forms.gle${url.pathname}` : "";
    }
    if (host !== "docs.google.com" && host !== "forms.google.com") return "";
    const id = url.pathname.match(/^\/forms\/d\/(?:e\/)?([^/]+)\/(?:viewform|formResponse)\/?$/i)?.[1] || "";
    return id ? `https://docs.google.com/forms/d/e/${id}/viewform` : "";
  } catch { return ""; }
}

async function enrichApplicationCandidates(items, collectedAt) {
  const output = [];
  let enrichedCount = 0;
  let livePocketEnrichedCount = 0;
  let googleFormEnrichedCount = 0;

  for (const item of items) {
    let host = "";
    try { host = new URL(item.url || "").hostname.toLowerCase(); } catch {}
    const isLivePocket = host === "livepocket.jp" || host.endsWith(".livepocket.jp");
    const isGoogleForm = host === "forms.gle" || host === "docs.google.com" || host === "forms.google.com";
    if (!isLivePocket && !isGoogleForm) {
      output.push(item);
      continue;
    }

    const parser = isLivePocket ? "livepocket" : "google-form";
    const sourceLabel = isLivePocket ? "LivePocket" : "Googleフォーム";
    const officialDomains = isLivePocket ? ["livepocket.jp"] : ["docs.google.com", "forms.gle", "forms.google.com"];

    try {
      const page = await fetchDocument({ url: item.url });
      const resolvedUrl = isGoogleForm
        ? (canonicalGoogleFormUrl(page.finalUrl || item.url) || canonicalGoogleFormUrl(item.url) || item.url)
        : item.url;
      const [parsed] = parseSourceDocument({
        id: `x-${parser}-${item.xPostId || item.externalId}`,
        name: item.shop || sourceLabel,
        shop: item.shop || "",
        url: resolvedUrl,
        parser,
        type: item.type || "店舗",
        area: item.area || "全国",
        sourceKind: "x",
        publicSourceType: sourceLabel,
        officialDomains,
        purchaseStartPolicy: "catalog-release",
      }, page.html, collectedAt);
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
        if (isLivePocket) livePocketEnrichedCount += 1;
        if (isGoogleForm) googleFormEnrichedCount += 1;
      } else {
        output.push(item);
      }
    } catch {
      output.push(item);
    }
    if (!FIXTURE_PATH) await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return { items: output, enrichedCount, livePocketEnrichedCount, googleFormEnrichedCount };
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

function canonicalScopeUrl(value = "") {
  try {
    const url = new URL(String(value || ""));
    url.hash = "";
    for (const key of [...url.searchParams.keys()]) {
      if (/^(?:utm_|fbclid|gclid|yclid|_ga|ref$)/i.test(key)) url.searchParams.delete(key);
    }
    return url.href.replace(/\/$/, "");
  } catch { return String(value || "").trim(); }
}

function canonicalScopeShop(value = "") {
  const shop = String(value || "").normalize("NFKC").toLowerCase().replace(/\s+/g, "").trim();
  if (/古本市場|ふるいち|トレカパーク/.test(shop)) return "furuichi";
  if (/ホビーステーション|ホビステ/.test(shop)) return "hobby-station";
  return shop;
}

function replacementScopeKey(item = {}) {
  if (!item.shop || !item.url) return "";
  const shop = canonicalScopeShop(item.shop);
  const url = canonicalScopeUrl(item.url);
  return shop && url ? `${shop}|${url}` : "";
}


async function run() {
  const startedAt = new Date().toISOString();
  const rawRegistry = await readJson(SOURCES_PATH, { sources: [] });
  const registry = normalizeSourceRegistry(rawRegistry);
  const sourceDatabase = summarizeSourceRegistry(registry);
  if (registry.errors.length) {
    throw new Error(`Source registry validation failed: ${registry.errors.join(" / ")}`);
  }
  const enabledSources = registry.sources.filter((source) => source.enabled !== false);
  const blockedDestinationDomains = Array.isArray(registry.blockedDestinationDomains)
    ? registry.blockedDestinationDomains
    : [];
  const previousFeed = await readJson(FEED_PATH, { lotteries: [] });
  const productCatalog = await loadProductCatalog(PRODUCT_CATALOG_PATH);
  const trustedPrevious = (previousFeed.lotteries || []).filter((item) => item.qualityVersion >= 2 && item.verified === true);
  const previousDiscoveryState = await readJson(DISCOVERY_STATE_PATH, { version: 1, sources: {} });
  const discoveryTracker = new DiscoveryStateTracker(previousDiscoveryState, new Date(startedAt));
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
      const rootDocument = await fetchDocument(source);
      const rootOcr = await enrichHtmlWithImageOcr(source, rootDocument.html);
      rootDocument.html = rootOcr.html;
      const rootObservation = discoveryTracker.observeRoot(source, rootDocument.html);
      const documents = [{ source, html: rootDocument.html, kind: "root", ocr: rootOcr }];
      const discoveryResult = discoverCandidateLinksDetailed(source, rootDocument.html);
      const revisitCandidates = buildOfficialRevisitCandidates(
        source,
        trustedPrevious,
        discoveryResult.candidates,
        { maxPages: 6 },
      );
      const candidateMap = new Map();
      for (const candidate of [...discoveryResult.candidates, ...revisitCandidates]) {
        const key = canonicalScopeUrl(candidate.url || "");
        if (!key) continue;
        const previous = candidateMap.get(key);
        candidateMap.set(key, previous
          ? { ...previous, ...candidate, text: `${previous.text || ""} ${candidate.text || ""}`.trim() }
          : candidate);
      }
      const candidateList = [...candidateMap.values()];
      let crossSourceDuplicateCount = 0;
      let candidateFetchSuccessCount = 0;
      let candidateFetchFailureCount = 0;
      let relevantPageCount = 0;
      let irrelevantPageCount = 0;
      let newCandidateCount = 0;
      let changedCandidateCount = 0;
      let knownCandidateCount = 0;
      const childErrors = [];
      let officialRevisitFetchCount = 0;
      let officialRevisitItemCount = 0;

      for (const candidate of candidateList) {
        if (seenDocumentUrls.has(candidate.url)) {
          crossSourceDuplicateCount += 1;
          continue;
        }
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
          const childDocument = await fetchDocument(childSource);
          const childOcr = await enrichHtmlWithImageOcr(childSource, childDocument.html);
          childDocument.html = childOcr.html;
          candidateFetchSuccessCount += 1;
          const candidateObservation = discoveryTracker.observeCandidate(source, candidate.url, childDocument.html);
          if (candidateObservation.firstSeen) newCandidateCount += 1;
          else knownCandidateCount += 1;
          if (candidateObservation.changed) changedCandidateCount += 1;
          const relevant = candidate.officialRevisit === true || pageLooksRelevant(source, childDocument.html);
          if (relevant) {
            documents.push({
              source: childSource,
              html: childDocument.html,
              kind: candidate.officialRevisit ? "revisited" : "discovered",
              ocr: childOcr,
            });
            relevantPageCount += 1;
            if (candidate.officialRevisit) officialRevisitFetchCount += 1;
            let host = "";
            try { host = new URL(candidate.url).hostname.toLowerCase(); } catch {}
            if (host === "livepocket.jp" || host.endsWith(".livepocket.jp")) livePocketDiscoveredCount += 1;
          } else {
            irrelevantPageCount += 1;
          }
        } catch (error) {
          candidateFetchFailureCount += 1;
          if (childErrors.length < 3) childErrors.push(publicErrorMessage(error));
        }
        if (!FIXTURE_PATH) await new Promise((resolve) => setTimeout(resolve, 800));
      }

      const parsedDocuments = [];
      const parseErrors = [];
      for (const document of documents) {
        try {
          const documentItems = parseSourceDocument(document.source, document.html, startedAt);
          parsedDocuments.push({ ...document, items: documentItems });
        } catch (error) {
          if (parseErrors.length < 3) parseErrors.push(publicErrorMessage(error));
        }
      }
      const items = parsedDocuments.flatMap((document) => document.items);
      const rootItemCount = parsedDocuments
        .filter((document) => document.kind === "root")
        .reduce((sum, document) => sum + document.items.length, 0);
      const discoveredItemCount = parsedDocuments
        .filter((document) => document.kind === "discovered")
        .reduce((sum, document) => sum + document.items.length, 0);
      officialRevisitItemCount = parsedDocuments
        .filter((document) => document.kind === "revisited")
        .reduce((sum, document) => sum + document.items.length, 0);
      collected.push(...items);

      const parseFailureCount = parseErrors.length;
      sourceResults.push({
        id: source.id,
        name: source.name,
        parser: source.parser || "generic",
        livePocketSearch: isLivePocketSearchSource(source),
        ok: parseFailureCount === 0,
        itemCount: items.length,
        rootItemCount,
        discoveredItemCount,
        discoveredPages: relevantPageCount,
        candidateFetchSuccessCount,
        candidateFetchFailureCount,
        relevantPageCount,
        irrelevantPageCount,
        crossSourceDuplicateCount,
        officialRevisitCandidateCount: revisitCandidates.length,
        officialRevisitFetchCount,
        officialRevisitItemCount,
        rootFirstSeen: rootObservation.firstSeen,
        rootChanged: rootObservation.changed,
        newCandidateCount,
        changedCandidateCount,
        knownCandidateCount,
        discovery: discoveryResult.stats,
        fetch: {
          statusCode: rootDocument.statusCode,
          contentType: rootDocument.contentType,
          responseBytes: rootDocument.responseBytes,
          finalHostChanged: rootDocument.finalHostChanged,
        },
        parseFailureCount,
        ocrAppliedCount: documents.filter((document) => document.ocr?.applied).length,
        ocrImageCount: documents.reduce((sum, document) => sum + Number(document.ocr?.imageCount || 0), 0),
        ocrErrorCount: documents.reduce((sum, document) => sum + Number(document.ocr?.errors?.length || 0), 0),
        failureClass: parseFailureCount ? "parser_error" : "",
        severity: parseFailureCount ? "error" : "",
        childErrors,
        parseErrors,
        elapsedMs: Date.now() - started,
        error: parseFailureCount ? `Parser failed for ${parseFailureCount} document(s)` : "",
      });
    } catch (error) {
      const failure = classifySourceFailure(error);
      sourceResults.push({
        id: source.id,
        name: source.name,
        parser: source.parser || "generic",
        livePocketSearch: isLivePocketSearchSource(source),
        ok: false,
        itemCount: 0,
        rootItemCount: 0,
        discoveredItemCount: 0,
        discoveredPages: 0,
        candidateFetchSuccessCount: 0,
        candidateFetchFailureCount: 0,
        relevantPageCount: 0,
        irrelevantPageCount: 0,
        crossSourceDuplicateCount: 0,
        officialRevisitCandidateCount: 0,
        officialRevisitFetchCount: 0,
        officialRevisitItemCount: 0,
        rootFirstSeen: false,
        rootChanged: false,
        newCandidateCount: 0,
        changedCandidateCount: 0,
        knownCandidateCount: 0,
        discovery: {
          enabled: Boolean(source.discovery?.enabled),
          totalLinks: 0,
          acceptedBeforeDedupe: 0,
          returnedCount: 0,
          duplicateRejected: 0,
          truncatedCount: 0,
          rejected: {},
        },
        elapsedMs: Date.now() - started,
        failureClass: failure.failureClass,
        severity: failure.severity,
        error: publicErrorMessage(error),
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
    ? { items: xResult.items, enrichedCount: 0, livePocketEnrichedCount: 0, googleFormEnrichedCount: 0 }
    : await enrichApplicationCandidates(xResult.items, startedAt);
  collected.push(...xEnrichment.items);

  const expandedCollection = expandCatalogGroupCandidates(collected, productCatalog);
  const currentCollected = expandedCollection.items;
  const authoritativeScopes = new Set(
    currentCollected
      .filter((item) => item?.sourceKind !== "manual" && item?.manualEntry !== true)
      .map(replacementScopeKey)
      .filter(Boolean)
  );
  const retainedPrevious = trustedPrevious.filter((item) => {
    const scope = replacementScopeKey(item);
    return !scope || !authoritativeScopes.has(scope);
  });
  const replacedPreviousCount = trustedPrevious.length - retainedPrevious.length;
  const expandedPrevious = expandCatalogGroupCandidates(retainedPrevious, productCatalog);
  const merged = keepRelevant(dedupeItems([
    ...expandedPrevious.items,
    ...currentCollected,
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

  const webSourceResults = sourceResults.filter((result) => result.id !== "manual-admin");
  const failedSourceResults = webSourceResults.filter((result) => !result.ok);
  const zeroItemSourceResults = webSourceResults.filter((result) => result.ok && Number(result.itemCount || 0) === 0);
  const sourceDiagnostics = webSourceResults.map((result) => ({
    name: result.name,
    parser: result.parser || "generic",
    status: result.ok ? (Number(result.itemCount || 0) > 0 ? "items" : "no_items") : "failed",
    itemCount: Number(result.itemCount || 0),
    rootItemCount: Number(result.rootItemCount || 0),
    discoveredItemCount: Number(result.discoveredItemCount || 0),
    elapsedMs: Number(result.elapsedMs || 0),
    fetch: result.fetch || null,
    discovery: result.discovery || null,
    candidateFetchSuccessCount: Number(result.candidateFetchSuccessCount || 0),
    candidateFetchFailureCount: Number(result.candidateFetchFailureCount || 0),
    relevantPageCount: Number(result.relevantPageCount || 0),
    irrelevantPageCount: Number(result.irrelevantPageCount || 0),
    crossSourceDuplicateCount: Number(result.crossSourceDuplicateCount || 0),
    officialRevisitCandidateCount: Number(result.officialRevisitCandidateCount || 0),
    officialRevisitFetchCount: Number(result.officialRevisitFetchCount || 0),
    officialRevisitItemCount: Number(result.officialRevisitItemCount || 0),
    rootFirstSeen: Boolean(result.rootFirstSeen),
    rootChanged: Boolean(result.rootChanged),
    newCandidateCount: Number(result.newCandidateCount || 0),
    changedCandidateCount: Number(result.changedCandidateCount || 0),
    knownCandidateCount: Number(result.knownCandidateCount || 0),
    parseFailureCount: Number(result.parseFailureCount || 0),
    ocrAppliedCount: Number(result.ocrAppliedCount || 0),
    ocrImageCount: Number(result.ocrImageCount || 0),
    ocrErrorCount: Number(result.ocrErrorCount || 0),
    failureClass: result.failureClass || "",
    severity: result.severity || "",
    zeroItemReason: Number(result.itemCount || 0) === 0 ? zeroItemReason(result) : "",
    error: result.error || "",
    childErrors: result.childErrors || [],
    parseErrors: result.parseErrors || [],
  }));
  const sourceHealth = {
    checkedCount: webSourceResults.length,
    successfulCount: webSourceResults.filter((result) => result.ok).length,
    failedCount: failedSourceResults.length,
    withItemsCount: webSourceResults.filter((result) => result.ok && Number(result.itemCount || 0) > 0).length,
    zeroItemsCount: zeroItemSourceResults.length,
    discoveredPageCount: webSourceResults.reduce((sum, result) => sum + Number(result.discoveredPages || 0), 0),
    failedSources: failedSourceResults.map((result) => ({
      name: result.name,
      error: result.error || "Unknown error",
      failureClass: result.failureClass || "source_error",
      severity: result.severity || "error",
    })),
    zeroItemSources: zeroItemSourceResults.map((result) => ({
      name: result.name,
      reason: zeroItemReason(result),
    })),
  };

  const livePocketSourceResults = webSourceResults.filter((result) => result.livePocketSearch);
  const livePocketSearchSourceCount = livePocketSourceResults.length;
  const livePocketSearchSuccessfulCount = livePocketSourceResults.filter((result) => result.ok).length;
  const livePocketSearchFailedCount = livePocketSourceResults.filter((result) => !result.ok).length;
  const livePocketCandidateLinkCount = livePocketSourceResults.reduce(
    (sum, result) => sum + Number(result.discovery?.returnedCount || 0), 0
  );
  const livePocketSearchLinkCount = livePocketSourceResults.reduce(
    (sum, result) => sum + Number(result.discovery?.totalLinks || 0), 0
  );
  const livePocketCandidateFetchSuccessCount = livePocketSourceResults.reduce(
    (sum, result) => sum + Number(result.candidateFetchSuccessCount || 0), 0
  );
  const livePocketCandidateFetchFailureCount = livePocketSourceResults.reduce(
    (sum, result) => sum + Number(result.candidateFetchFailureCount || 0), 0
  );
  const livePocketRelevantPageCount = livePocketSourceResults.reduce(
    (sum, result) => sum + Number(result.relevantPageCount || 0), 0
  );
  const livePocketParsedItemCount = livePocketSourceResults.reduce(
    (sum, result) => sum + Number(result.discoveredItemCount || 0), 0
  );
  const livePocketCrossSourceDuplicateCount = livePocketSourceResults.reduce(
    (sum, result) => sum + Number(result.crossSourceDuplicateCount || 0), 0
  );

  let livePocketDiscoveryStatus = "not_configured";
  if (livePocketSearchSourceCount === 0) {
    livePocketDiscoveryStatus = "not_configured";
  } else if (livePocketSearchFailedCount === livePocketSearchSourceCount) {
    livePocketDiscoveryStatus = "search_failed";
  } else if (livePocketCandidateLinkCount === 0) {
    livePocketDiscoveryStatus = "no_candidates";
  } else if (livePocketCandidateFetchSuccessCount === 0 && livePocketCandidateFetchFailureCount > 0) {
    livePocketDiscoveryStatus = "candidate_fetch_failed";
  } else if (livePocketRelevantPageCount === 0) {
    livePocketDiscoveryStatus = "no_relevant_pages";
  } else if (livePocketParsedItemCount === 0) {
    livePocketDiscoveryStatus = "parser_returned_zero";
  } else if (livePocketSearchFailedCount > 0 || livePocketCandidateFetchFailureCount > 0) {
    livePocketDiscoveryStatus = "partial";
  } else {
    livePocketDiscoveryStatus = "ok";
  }

  const livePocketDiscovery = {
    status: livePocketDiscoveryStatus,
    searchSourceCount: livePocketSearchSourceCount,
    successfulSearchSourceCount: livePocketSearchSuccessfulCount,
    failedSearchSourceCount: livePocketSearchFailedCount,
    searchPageLinkCount: livePocketSearchLinkCount,
    candidateLinkCount: livePocketCandidateLinkCount,
    candidateFetchSuccessCount: livePocketCandidateFetchSuccessCount,
    candidateFetchFailureCount: livePocketCandidateFetchFailureCount,
    relevantPageCount: livePocketRelevantPageCount,
    parsedItemCount: livePocketParsedItemCount,
    crossSearchDuplicateCount: livePocketCrossSourceDuplicateCount,
  };

  const criticalLivePocketFailure = [
    "search_failed",
    "candidate_fetch_failed",
    "parser_returned_zero",
  ].includes(livePocketDiscoveryStatus);
  const fatalSourceResults = failedSourceResults.filter((result) => result.severity !== "warning");
  const warningSourceResults = failedSourceResults.filter((result) => result.severity === "warning");
  const allWebSourcesFailed = webSourceResults.length > 0 && webSourceResults.every((result) => !result.ok);
  const brokenOfficialDiscovery = webSourceResults.filter((result) =>
    ["hobby-station-news", "furuichi-news"].includes(result.parser)
    && result.ok
    && Number(result.itemCount || 0) === 0
    && Number(result.discovery?.totalLinks || 0) > 0
    && Number(result.discovery?.returnedCount || 0) === 0
  );
  const statusReasons = [
    ...fatalSourceResults.map((result) => `source_failed:${result.name}:${result.error || "unknown"}`),
    ...brokenOfficialDiscovery.map((result) => `official_discovery_broken:${result.name}`),
    ...(criticalLivePocketFailure ? [`livepocket:${livePocketDiscoveryStatus}`] : []),
    ...(allWebSourcesFailed ? ["all_web_sources_failed"] : []),
  ];
  const warningReasons = [
    ...warningSourceResults.map((result) => `source_warning:${result.name}:${result.error || "unknown"}`),
    ...(["no_candidates", "no_relevant_pages", "partial"].includes(livePocketDiscoveryStatus)
      ? [`livepocket_warning:${livePocketDiscoveryStatus}`]
      : []),
  ];
  const hasFatalFailure = fatalSourceResults.length > 0 || criticalLivePocketFailure || allWebSourcesFailed || brokenOfficialDiscovery.length > 0;
  const runStatus = hasFatalFailure ? "partial" : warningReasons.length > 0 ? "degraded" : "ok";

  const autoCollectedCount = collected.filter((item) => item.sourceKind !== "manual" && item.manualEntry !== true).length;
  const multiProductExpandedCount = currentCollected.filter((item) => item.collectionMode === "official-news-multi-product").length;
  const catalogGroupExpandedCount = expandedCollection.expandedCount + expandedPrevious.expandedCount;
  const ocrAppliedCount = sourceResults.reduce((sum, result) => sum + Number(result.ocrAppliedCount || 0), 0);
  const ocrImageCount = sourceResults.reduce((sum, result) => sum + Number(result.ocrImageCount || 0), 0);
  const discoveryStateResult = discoveryTracker.finalize();
  const discoveryEngine = {
    version: 1,
    sourceDatabase,
    newness: discoveryStateResult.metrics,
  };

  const finalPublished = dedupeItems(published);
  const postCanonicalDuplicateCount = published.length - finalPublished.length;
  const publishedValidation = validatePublishedLotteries(finalPublished, productCatalog);
  if (!publishedValidation.ok) {
    throw new Error(`Public feed quality validation failed: ${publishedValidation.errors.slice(0, 5).join(" / ")}`);
  }

  const quality = {
    qualityVersion: 2,
    candidateCount: merged.length,
    publishedCount: finalPublished.length,
    postCanonicalDuplicateCount,
    reviewCount: reviewQueue.length,
    rejectedCount: rejected.length,
    directVerifiedCount,
    catalogMatchedCount,
    autoCollectedCount,
    multiProductExpandedCount,
    catalogGroupExpandedCount,
    replacedPreviousCount,
    ocrAppliedCount,
    ocrImageCount,
    rule: "catalog+deadline+direct-destination-or-official-store-notice",
  };
  const meta = {
    collectorVersion: APP_VERSION,
    lastRunAt: startedAt,
    status: runStatus,
    statusReasons,
    warningReasons,
    reviewCount: reviewQueue.length,
    publishedCount: finalPublished.length,
    historyDays: 35,
    manualEntryCount: manualLotteries.length,
    checkedSourceCount: enabledSources.length,
    successfulSourceCount: webSourceResults.filter((result) => result.ok).length,
    failedSourceCount: failedSourceResults.length,
    sourceHealth,
    sourceDiagnostics,
    autoCollectedCount,
    multiProductExpandedCount,
    catalogGroupExpandedCount,
    replacedPreviousCount,
    ocrAppliedCount,
    ocrImageCount,
    livePocketDiscoveredCount,
    livePocketDiscoveryStatus,
    livePocketDiscovery,
    xLivePocketEnrichedCount: xEnrichment.livePocketEnrichedCount,
    xGoogleFormEnrichedCount: xEnrichment.googleFormEnrichedCount,
    xCollectorStatus: xResult.meta?.status || "not_configured",
    xOfficialAccountCount: Number(xResult.meta?.officialAccountCount || 0),
    xPostCount: Number(xResult.meta?.postCount || 0),
    xItemCount: Number(xResult.meta?.itemCount || 0),
    discoveryEngine,
    quality,
  };

  await writeJson(FEED_PATH, {
    version: 1,
    updatedAt: startedAt,
    meta,
    lotteries: finalPublished
      .sort((a, b) => String(b.collectedAt || "").localeCompare(String(a.collectedAt || "")))
      .map(sanitizeForPublic),
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
  await writeJson(DISCOVERY_STATE_PATH, discoveryStateResult.state);

  console.log(JSON.stringify({
    ok: runStatus === "ok",
    status: runStatus,
    statusReasons,
    warningReasons,
    collected: collected.length,
    published: finalPublished.length,
    review: reviewQueue.length,
    rejected: rejected.length,
    manualEntryCount: manualLotteries.length,
    autoCollectedCount,
    multiProductExpandedCount,
    catalogGroupExpandedCount,
    replacedPreviousCount,
    ocrAppliedCount,
    ocrImageCount,
    checkedSourceCount: enabledSources.length,
    successfulSourceCount: webSourceResults.filter((result) => result.ok).length,
    failedSourceCount: failedSourceResults.length,
    sourceHealth,
    sourceDiagnostics,
    discoveryEngine,
    livePocketDiscoveredCount,
    livePocketDiscovery,
    xLivePocketEnrichedCount: xEnrichment.livePocketEnrichedCount,
    xGoogleFormEnrichedCount: xEnrichment.googleFormEnrichedCount,
  }, null, 2));
  if (runStatus === "partial") {
    throw new Error(`Collector finished with fatal status: ${statusReasons.join(" / ") || "unknown"}`);
  }
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
