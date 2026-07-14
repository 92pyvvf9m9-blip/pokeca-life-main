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
  const sourceHost = new URL(source.url).hostname;

  const candidates = extractLinks(html, source.url)
    .filter((link) => {
      const haystack = `${link.text} ${link.url}`;
      if (!matchesAny(haystack, include)) return false;
      if (matchesAny(haystack, exclude)) return false;
      if (sameHostOnly && new URL(link.url).hostname !== sourceHost) return false;
      return true;
    })
    .map((link) => ({
      ...link,
      score:
        (matchesAny(link.text, ["抽選", "応募", "エントリー"]) ? 3 : 0) +
        (matchesAny(link.text, ["ポケモンカード", "ポケカ"]) ? 3 : 0) +
        (matchesAny(link.url, ["lottery", "entry", "campaign"]) ? 2 : 0),
    }))
    .sort((a, b) => b.score - a.score);

  const unique = [];
  const seen = new Set();
  for (const item of candidates) {
    const normalized = item.url.replace(/[?#].*$/, "");
    if (seen.has(normalized)) continue;
    seen.add(normalized);
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
