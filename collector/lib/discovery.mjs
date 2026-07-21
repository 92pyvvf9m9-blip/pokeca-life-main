import { extractLinks, htmlToText } from "./html.mjs";

function matchesAny(value, patterns = []) {
  const text = String(value || "");
  return patterns.some((pattern) => {
    try {
      return new RegExp(pattern, "i").test(text);
    } catch {
      return text.toLowerCase().includes(String(pattern).toLowerCase());
    }
  });
}

function normalizeHost(value = "") {
  return String(value || "").toLowerCase().replace(/^www\./, "");
}

function hostAllowed(host, allowedHosts = []) {
  const normalized = normalizeHost(host);
  return allowedHosts.some((entry) => {
    const allowed = normalizeHost(entry);
    return normalized === allowed || normalized.endsWith(`.${allowed}`);
  });
}

function canonicalCandidateUrl(value) {
  const url = new URL(value);
  url.hash = "";
  // Event pages do not need tracking parameters; search/list pages may.
  if (/\/(?:e|event)\//.test(url.pathname)) url.search = "";
  return url.href;
}

function decodeHtmlEntities(value = "") {
  return String(value || "")
    .replace(/&amp;/gi, "&")
    .replace(/&#x2f;/gi, "/")
    .replace(/&#47;/g, "/")
    .replace(/\\\//g, "/")
    .replace(/\u002f/gi, "/");
}

/**
 * LivePocket search cards sometimes expose the event URL in JSON/data
 * attributes while the clickable anchor itself has no useful text. Scan the
 * raw response and keep a short nearby context so the normal keyword gate can
 * still reject unrelated pickup events.
 */
function extractEmbeddedLivePocketLinks(html = "") {
  const decoded = decodeHtmlEntities(html);
  const matches = [];
  const patterns = [
    /https?:\/\/(?:[a-z0-9-]+\.)?livepocket\.jp\/e\/[a-z0-9_-]+/gi,
    /(?:^|["'\s(=])\/e\/[a-z0-9_-]+/gi,
  ];
  const seen = new Set();

  for (const pattern of patterns) {
    for (const match of decoded.matchAll(pattern)) {
      let raw = String(match[0] || "").replace(/^["'\s(=]+/, "");
      if (!raw) continue;
      const index = Number(match.index || 0);
      const context = decoded
        .slice(Math.max(0, index - 500), index + raw.length + 500)
        .replace(/<[^>]+>/g, " ")
        .replace(/[{}[\]"']/g, " ")
        .replace(/\s+/g, " ")
        .trim();
      const url = raw.startsWith("/") ? new URL(raw, "https://t.livepocket.jp/").href : raw;
      if (seen.has(url)) continue;
      seen.add(url);
      matches.push({ url, text: context, embedded: true });
    }
  }

  return matches;
}


function extractContextualHobbyStationLinks(source, html = "") {
  if (source.parser !== "hobby-station-news") return [];
  const decoded = decodeHtmlEntities(html);
  const matches = [];
  const seen = new Set();
  const anchorPattern = /<a\b[^>]*href\s*=\s*(["'])([\s\S]*?)\1[^>]*>([\s\S]*?)<\/a>/gi;

  for (const match of decoded.matchAll(anchorPattern)) {
    let url;
    try { url = new URL(match[2], source.url); } catch { continue; }
    const host = normalizeHost(url.hostname);
    if (!(host === "hbst.net" || host.endsWith(".hbst.net"))) continue;
    if (!url.searchParams.has("p") && !/\/(?:news|blog)\//i.test(url.pathname)) continue;

    const index = Number(match.index || 0);
    const context = htmlToText(decoded.slice(Math.max(0, index - 900), index + match[0].length + 500));
    const anchorText = htmlToText(match[3]);
    const text = `${anchorText} ${context}`.replace(/\s+/g, " ").trim();
    if (!/ポケモンカード|ポケカ/i.test(text) || !/抽選|応募|LivePocket|ライブポケット/i.test(text)) continue;

    url.hash = "";
    const href = url.href;
    if (seen.has(href)) continue;
    seen.add(href);
    matches.push({ url: href, text, contextual: true });
  }
  return matches;
}

function extractContextualFuruichiLinks(source, html = "") {
  if (source.parser !== "furuichi-news") return [];
  const decoded = decodeHtmlEntities(html);
  const matches = [];
  const seen = new Set();
  const anchorPattern = /<a\b[^>]*href\s*=\s*(["'])([\s\S]*?)\1[^>]*>([\s\S]*?)<\/a>/gi;

  for (const match of decoded.matchAll(anchorPattern)) {
    let url;
    try { url = new URL(match[2], source.url); } catch { continue; }
    const host = normalizeHost(url.hostname);
    if (!(host === "furu1.net" || host.endsWith(".furu1.net"))) continue;
    if (!/\/news\/(?:news_information|news_campaign)\//i.test(url.pathname)) continue;

    const index = Number(match.index || 0);
    const context = htmlToText(decoded.slice(Math.max(0, index - 600), index + match[0].length + 600));
    const anchorText = htmlToText(match[3]);
    const text = `${anchorText} ${context}`.replace(/\s+/g, " ").trim();
    if (!/ポケモンカード|ポケカ/i.test(text) || !/抽選|受付/i.test(text)) continue;

    url.hash = "";
    const href = url.href;
    if (seen.has(href)) continue;
    seen.add(href);
    matches.push({ url: href, text, contextualFuruichi: true });
  }
  return matches;
}


function baseDiscoveryStats(source) {
  return {
    enabled: Boolean(source.discovery?.enabled),
    totalLinks: 0,
    acceptedBeforeDedupe: 0,
    returnedCount: 0,
    duplicateRejected: 0,
    truncatedCount: 0,
    embeddedEventLinks: 0,
    rejected: {
      invalidUrl: 0,
      protocol: 0,
      includePattern: 0,
      excludePattern: 0,
      host: 0,
      path: 0,
    },
  };
}

/**
 * Returns both candidate links and aggregate rejection counts.
 * Diagnostics intentionally contain no source or destination URLs so that they
 * can be written to the public status file without exposing collector sources.
 */
export function discoverCandidateLinksDetailed(source, html) {
  const stats = baseDiscoveryStats(source);
  if (!source.discovery?.enabled) return { candidates: [], stats };

  const include = source.discovery.includePatterns || [
    "ポケモンカード",
    "ポケカ",
    "抽選",
  ];
  const exclude = source.discovery.excludePatterns || [
    "過去",
    "規約",
    "faq",
  ];
  const sameHostOnly = source.discovery.sameHostOnly !== false;
  const sourceHost = normalizeHost(new URL(source.url).hostname);
  const allowedHosts = Array.isArray(source.discovery.allowedHosts)
    ? source.discovery.allowedHosts
    : [];
  const requiredPathPatterns = source.discovery.requiredPathPatterns || [];

  const normalLinks = extractLinks(html, source.url);
  const livePocketDiscovery = source.parser === "livepocket-search"
    || source.discovery?.childParser === "livepocket"
    || source.childParser === "livepocket";
  const embeddedLinks = livePocketDiscovery
    ? extractEmbeddedLivePocketLinks(html)
    : [];
  stats.embeddedEventLinks = embeddedLinks.length;
  const mergedLinks = new Map();
  for (const link of [...normalLinks, ...embeddedLinks]) {
    const key = String(link.url || "");
    if (!key) continue;
    const previous = mergedLinks.get(key);
    if (!previous) {
      mergedLinks.set(key, link);
      continue;
    }
    mergedLinks.set(key, {
      ...previous,
      text: String(previous.text || "").trim()
        ? previous.text
        : String(link.text || "").trim(),
      embedded: Boolean(previous.embedded || link.embedded),
    });
  }
  const contextualLinks = [
    ...extractContextualHobbyStationLinks(source, html),
    ...extractContextualFuruichiLinks(source, html),
  ];
  for (const link of contextualLinks) {
    const key = String(link.url || "");
    if (!key) continue;
    const previous = mergedLinks.get(key);
    mergedLinks.set(key, previous
      ? {
          ...previous,
          text: `${previous.text || ""} ${link.text || ""}`.trim(),
          contextual: Boolean(previous.contextual || link.contextual),
          contextualFuruichi: Boolean(previous.contextualFuruichi || link.contextualFuruichi),
        }
      : link);
  }
  const links = [...mergedLinks.values()];
  stats.totalLinks = links.length;

  const accepted = [];
  for (const link of links) {
    let parsed;
    try {
      parsed = new URL(link.url);
    } catch {
      stats.rejected.invalidUrl += 1;
      continue;
    }

    if (!/^https?:$/.test(parsed.protocol)) {
      stats.rejected.protocol += 1;
      continue;
    }

    const haystack = `${link.text} ${link.url}`;
    const trustedContextualFuruichi = Boolean(link.contextualFuruichi);
    if (!trustedContextualFuruichi && !matchesAny(haystack, include)) {
      stats.rejected.includePattern += 1;
      continue;
    }
    if (!trustedContextualFuruichi && matchesAny(haystack, exclude)) {
      stats.rejected.excludePattern += 1;
      continue;
    }

    const host = normalizeHost(parsed.hostname);
    if (sameHostOnly && host !== sourceHost) {
      stats.rejected.host += 1;
      continue;
    }
    if (!sameHostOnly && allowedHosts.length && !hostAllowed(host, allowedHosts)) {
      stats.rejected.host += 1;
      continue;
    }
    if (!trustedContextualFuruichi && requiredPathPatterns.length && !matchesAny(`${parsed.pathname}${parsed.search}`, requiredPathPatterns)) {
      stats.rejected.path += 1;
      continue;
    }

    const canonicalUrl = canonicalCandidateUrl(link.url);
    accepted.push({
      ...link,
      url: canonicalUrl,
      parser: source.discovery.childParser || source.childParser || "",
      score:
        (matchesAny(link.text, ["抽選", "応募", "エントリー", "受付中", "販売中"]) ? 4 : 0) +
        (matchesAny(link.text, ["ポケモンカード", "ポケカ"]) ? 4 : 0) +
        (matchesAny(link.url, ["/e/", "lottery", "entry", "campaign"]) ? 2 : 0),
    });
  }

  accepted.sort((a, b) => b.score - a.score);
  stats.acceptedBeforeDedupe = accepted.length;

  const unique = [];
  const seen = new Set();
  const maxPages = Number(source.discovery.maxPages || 8);
  for (const item of accepted) {
    if (seen.has(item.url)) {
      stats.duplicateRejected += 1;
      continue;
    }
    seen.add(item.url);
    if (unique.length >= maxPages) {
      stats.truncatedCount += 1;
      continue;
    }
    unique.push(item);
  }

  stats.returnedCount = unique.length;
  return { candidates: unique, stats };
}

export function discoverCandidateLinks(source, html) {
  return discoverCandidateLinksDetailed(source, html).candidates;
}

export function pageLooksRelevant(source, html) {
  const text = htmlToText(html);
  const required = source.discovery?.pageKeywords || source.keywords || [];
  return required.length
    ? required.some((keyword) => text.includes(keyword))
    : /ポケモンカード|ポケカ/i.test(text) && /抽選|応募|エントリー/i.test(text);
}
