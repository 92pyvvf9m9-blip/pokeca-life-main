function canonicalUrl(value = "") {
  try {
    const url = new URL(String(value || ""));
    url.hash = "";
    for (const key of [...url.searchParams.keys()]) {
      if (/^(?:utm_|fbclid|gclid|yclid|_ga|ref$)/i.test(key)) url.searchParams.delete(key);
    }
    return url.href.replace(/\/$/, "");
  } catch {
    return "";
  }
}

function host(value = "") {
  try { return new URL(String(value || "")).hostname.toLowerCase().replace(/^www\./, ""); }
  catch { return ""; }
}

const REVISIT_PARSERS = new Set(["hobby-station-news", "furuichi-news"]);

/**
 * Revisit previously verified same-host official article URLs.
 *
 * Official archive/index pages can drop older lottery notices before the
 * purchase window ends. The public feed still knows the direct official URL,
 * so we re-fetch a small, deduplicated set instead of retaining stale parsed
 * data forever.
 */
export function buildOfficialRevisitCandidates(source = {}, previousItems = [], discovered = [], options = {}) {
  if (!REVISIT_PARSERS.has(String(source.parser || ""))) return [];
  const sourceHost = host(source.url);
  if (!sourceHost) return [];

  const root = canonicalUrl(source.url);
  const seen = new Set(
    (Array.isArray(discovered) ? discovered : [])
      .map((item) => canonicalUrl(item?.url || item))
      .filter(Boolean)
  );
  if (root) seen.add(root);

  const maxPages = Math.max(1, Math.min(12, Number(options.maxPages || 6)));
  const candidates = [];
  const sorted = [...(Array.isArray(previousItems) ? previousItems : [])]
    .filter((item) => item?.verified === true && Number(item?.qualityVersion || 0) >= 2)
    .sort((a, b) => String(b?.collectedAt || b?.updatedAt || "").localeCompare(String(a?.collectedAt || a?.updatedAt || "")));

  for (const item of sorted) {
    const url = canonicalUrl(item?.url || "");
    if (!url || seen.has(url) || host(url) !== sourceHost) continue;
    seen.add(url);
    candidates.push({
      url,
      text: String(item?.product || item?.shop || ""),
      parser: source.parser,
      officialRevisit: true,
      score: 20,
    });
    if (candidates.length >= maxPages) break;
  }
  return candidates;
}
