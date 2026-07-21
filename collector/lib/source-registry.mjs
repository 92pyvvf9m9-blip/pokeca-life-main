import crypto from "node:crypto";

const KNOWN_PARSERS = new Set([
  "generic",
  "livepocket",
  "livepocket-search",
  "google-form",
  "amiami",
  "rakuten-books",
  "hobby-search",
  "listing-intelligence-v1",
  "geo-news",
  "geo-lottery",
  "hobby-station-news",
  "furuichi-news",
]);

function text(value = "") {
  return String(value ?? "").trim();
}

function normalizedHost(value = "") {
  try {
    return new URL(value).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
}

function stringArray(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((entry) => text(entry)).filter(Boolean))];
}

function boundedNumber(value, fallback, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, number));
}

function stableSourceId(source) {
  const explicit = text(source.id);
  if (explicit) return explicit;
  const seed = `${text(source.name)}\n${text(source.url)}`;
  return `source-${crypto.createHash("sha256").update(seed).digest("hex").slice(0, 12)}`;
}

function inferPlatform(source) {
  const explicit = text(source.platform);
  if (explicit) return explicit;
  const parser = text(source.parser);
  const host = normalizedHost(source.url);
  if (parser.startsWith("livepocket") || host.endsWith("livepocket.jp")) return "livepocket";
  if (parser === "google-form" || ["forms.gle", "docs.google.com", "forms.google.com"].includes(host)) return "google_forms";
  if (host === "x.com" || host === "twitter.com") return "x";
  if (host) return "website";
  return "unknown";
}

function inferOfficialStatus(source) {
  const explicit = text(source.officialStatus || source.official_status);
  if (explicit) return explicit;
  if (source.official === true || source.officialNotice === true) return "official";
  if (source.sourceKind === "aggregated" || source.parser === "listing-intelligence-v1") return "aggregator";
  return "unverified";
}

function defaultInterval(priority) {
  if (priority >= 90) return 5;
  if (priority >= 70) return 15;
  if (priority >= 40) return 30;
  return 60;
}

function normalizeDiscovery(source) {
  const input = source.discovery && typeof source.discovery === "object" ? source.discovery : {};
  const livePocketSearch = source.parser === "livepocket-search";
  const output = {
    ...input,
    enabled: input.enabled === true,
    allowedHosts: stringArray(input.allowedHosts),
    requiredPathPatterns: stringArray(input.requiredPathPatterns),
    pageKeywords: stringArray(input.pageKeywords),
    childParser: text(input.childParser || source.childParser || (livePocketSearch ? "livepocket" : "")),
    sameHostOnly: input.sameHostOnly !== false,
    maxPages: Math.round(boundedNumber(input.maxPages, livePocketSearch ? 20 : 8, 1, 100)),
  };
  // include/exclude omitted in old registries must stay omitted so the
  // Discovery Engine's built-in Pokémon-card defaults continue to apply.
  if (Array.isArray(input.includePatterns)) output.includePatterns = stringArray(input.includePatterns);
  else delete output.includePatterns;
  if (Array.isArray(input.excludePatterns)) output.excludePatterns = stringArray(input.excludePatterns);
  else delete output.excludePatterns;
  return output;
}

function normalizeSource(source, index, warnings, errors) {
  const normalized = { ...source };
  normalized.id = stableSourceId(source);
  normalized.name = text(source.name) || `Unnamed source ${index + 1}`;
  normalized.url = text(source.url);
  normalized.parser = text(source.parser) || "generic";
  normalized.enabled = source.enabled !== false;
  normalized.platform = inferPlatform(source);
  normalized.officialStatus = inferOfficialStatus(source);
  normalized.prefecture = text(source.prefecture || source.area || "全国");
  normalized.priority = Math.round(boundedNumber(source.priority, 70, 0, 100));
  normalized.crawlIntervalMinutes = Math.round(boundedNumber(
    source.crawlIntervalMinutes,
    defaultInterval(normalized.priority),
    5,
    1440,
  ));
  normalized.discovery = normalizeDiscovery(normalized);

  if (!text(source.id)) warnings.push(`${normalized.name}: idがないため安定IDを自動生成しました`);
  if (!normalized.url) {
    errors.push(`${normalized.name}: urlがありません`);
    normalized.enabled = false;
  } else if (!normalizedHost(normalized.url)) {
    errors.push(`${normalized.name}: urlが不正です`);
    normalized.enabled = false;
  }
  if (!KNOWN_PARSERS.has(normalized.parser)) {
    warnings.push(`${normalized.name}: 未登録parser「${normalized.parser}」をgeneric互換として扱います`);
  }
  if (normalized.discovery.enabled && !normalized.discovery.childParser && normalized.parser === "generic") {
    warnings.push(`${normalized.name}: discovery.childParser未指定のため親parserを継承します`);
  }
  return normalized;
}

export function normalizeSourceRegistry(payload = {}) {
  const warnings = [];
  const errors = [];
  const rawSources = Array.isArray(payload.sources) ? payload.sources : [];
  if (!Array.isArray(payload.sources)) errors.push("sources配列がありません");

  const sources = rawSources.map((source, index) => normalizeSource(source || {}, index, warnings, errors));
  const seenIds = new Set();
  const seenUrls = new Set();
  for (const source of sources) {
    if (seenIds.has(source.id)) {
      errors.push(`${source.name}: source id「${source.id}」が重複しています`);
      source.enabled = false;
    }
    seenIds.add(source.id);

    const canonical = source.url.replace(/\/$/, "");
    if (canonical && seenUrls.has(canonical)) {
      warnings.push(`${source.name}: 同じ巡回URLが重複しています`);
    }
    if (canonical) seenUrls.add(canonical);
  }

  return {
    version: Number(payload.version || 1),
    blockedDestinationDomains: stringArray(payload.blockedDestinationDomains),
    sources,
    warnings,
    errors,
  };
}

export function summarizeSourceRegistry(registry = {}) {
  const sources = Array.isArray(registry.sources) ? registry.sources : [];
  const enabled = sources.filter((source) => source.enabled !== false);
  const countBy = (key) => Object.fromEntries(
    [...enabled.reduce((map, source) => {
      const value = text(source[key]) || "unknown";
      map.set(value, (map.get(value) || 0) + 1);
      return map;
    }, new Map()).entries()].sort((a, b) => a[0].localeCompare(b[0], "ja")),
  );

  return {
    registryVersion: Number(registry.version || 1),
    totalCount: sources.length,
    enabledCount: enabled.length,
    disabledCount: sources.length - enabled.length,
    discoveryEnabledCount: enabled.filter((source) => source.discovery?.enabled).length,
    officialCount: enabled.filter((source) => source.officialStatus === "official").length,
    warningCount: Array.isArray(registry.warnings) ? registry.warnings.length : 0,
    errorCount: Array.isArray(registry.errors) ? registry.errors.length : 0,
    byPlatform: countBy("platform"),
    byPrefecture: countBy("prefecture"),
    byParser: countBy("parser"),
  };
}

export function sourceIsDue(source, lastCheckedAt, now = new Date()) {
  if (!lastCheckedAt) return true;
  const last = new Date(lastCheckedAt).getTime();
  if (!Number.isFinite(last)) return true;
  const interval = Math.max(5, Number(source.crawlIntervalMinutes || 15)) * 60_000;
  return now.getTime() - last >= interval;
}
