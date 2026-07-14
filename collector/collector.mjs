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

  const collected = [];
  const sourceResults = [];

  for (const source of enabledSources) {
    const started = Date.now();
    try {
      const html = await fetchHtml(source);
      const documents = [{ source, html }];
      const discovered = discoverCandidateLinks(source, html);

      for (const candidate of discovered) {
        const childSource = {
          ...source,
          url: candidate.url,
          discovery: { enabled: false },
        };
        try {
          const childHtml = await fetchHtml(childSource);
          if (pageLooksRelevant(source, childHtml)) {
            documents.push({ source: childSource, html: childHtml });
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
  collected.push(...xResult.items);

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
    const intelligence = candidate.sourceKind === "aggregated" || candidate.sourceKind === "intelligence" || candidate.sourceKind === "x";

    if (intelligence && candidate.url) {
      const verification = await verifyDestination(candidate, async ({ url }) => fetchHtml({ url }), { blockedDestinationDomains });
      candidate.destinationVerified = verification.ok;
      candidate.destinationHost = verification.host;
      candidate.destinationVerificationReason = verification.reason;
    } else if (!intelligence) {
      candidate.destinationVerified = candidate.url ? true : false;
    }

    let gate = evaluateCandidate(candidate, productCatalog, new Date(startedAt), { blockedDestinationDomains });
    if (gate.catalogProduct) {
      candidate.product = gate.catalogProduct.name;
      candidate.productCatalogId = gate.catalogProduct.id;
      catalogMatchedCount += 1;
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
  const quality = {
    qualityVersion: 2,
    candidateCount: merged.length,
    publishedCount: published.length,
    reviewCount: reviewQueue.length,
    rejectedCount: rejected.length,
    directVerifiedCount,
    catalogMatchedCount,
    rule: "catalog+deadline+direct-destination",
  };
  const meta = {
    collectorVersion: "1.14.0",
    lastRunAt: startedAt,
    status: failedCount === 0 ? "ok" : "partial",
    reviewCount: reviewQueue.length,
    publishedCount: published.length,
    historyDays: 35,
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
    checkedSourceCount: enabledSources.length,
    successfulSourceCount: successCount,
    failedSourceCount: failedCount,
  }, null, 2));
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
