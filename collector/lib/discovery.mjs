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

function baseDiscoveryStats(source) {
  return {
    enabled: Boolean(source.discovery?.enabled),
    totalLinks: 0,
    acceptedBeforeDedupe: 0,
    returnedCount: 0,
    duplicateRejected: 0,
    truncatedCount: 0,
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
    "終了",
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

  const links = extractLinks(html, source.url);
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
    if (!matchesAny(haystack, include)) {
      stats.rejected.includePattern += 1;
      continue;
    }
    if (matchesAny(haystack, exclude)) {
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
    if (requiredPathPatterns.length && !matchesAny(parsed.pathname, requiredPathPatterns)) {
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
