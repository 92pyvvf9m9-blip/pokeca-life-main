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

export function discoverCandidateLinks(source, html) {
  if (!source.discovery?.enabled) return [];

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

  const candidates = extractLinks(html, source.url)
    .filter((link) => {
      let parsed;
      try { parsed = new URL(link.url); } catch { return false; }
      if (!/^https?:$/.test(parsed.protocol)) return false;
      const haystack = `${link.text} ${link.url}`;
      if (!matchesAny(haystack, include)) return false;
      if (matchesAny(haystack, exclude)) return false;
      const host = normalizeHost(parsed.hostname);
      if (sameHostOnly && host !== sourceHost) return false;
      if (!sameHostOnly && allowedHosts.length && !hostAllowed(host, allowedHosts)) return false;
      if (requiredPathPatterns.length && !matchesAny(parsed.pathname, requiredPathPatterns)) return false;
      return true;
    })
    .map((link) => {
      const canonicalUrl = canonicalCandidateUrl(link.url);
      return {
        ...link,
        url: canonicalUrl,
        parser: source.discovery.childParser || source.childParser || "",
        score:
          (matchesAny(link.text, ["抽選", "応募", "エントリー", "受付中", "販売中"]) ? 4 : 0) +
          (matchesAny(link.text, ["ポケモンカード", "ポケカ"]) ? 4 : 0) +
          (matchesAny(link.url, ["/e/", "lottery", "entry", "campaign"]) ? 2 : 0),
      };
    })
    .sort((a, b) => b.score - a.score);

  const unique = [];
  const seen = new Set();
  for (const item of candidates) {
    if (seen.has(item.url)) continue;
    seen.add(item.url);
    unique.push(item);
    if (unique.length >= Number(source.discovery.maxPages || 8)) break;
  }
  return unique;
}

export function pageLooksRelevant(source, html) {
  const text = htmlToText(html);
  const required = source.discovery?.pageKeywords || source.keywords || [];
  return required.length
    ? required.some((keyword) => text.includes(keyword))
    : /ポケモンカード|ポケカ/i.test(text) && /抽選|応募|エントリー/i.test(text);
}
