const ENTITIES = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

export function decodeHtmlEntities(value = "") {
  return String(value)
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&([a-z]+);/gi, (all, name) => ENTITIES[name.toLowerCase()] ?? all);
}

export function htmlToText(html = "") {
  return decodeHtmlEntities(
    String(html)
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "\n")
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, "\n")
      .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, "\n")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(?:p|div|li|section|article|h[1-6]|tr)>/gi, "\n")
      .replace(/<[^>]+>/g, " ")
  )
    .replace(/\r/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function extractLinks(html = "", baseUrl = "") {
  const output = [];
  const regex = /<a\b[^>]*href=["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let match;
  while ((match = regex.exec(String(html)))) {
    try {
      const url = new URL(decodeHtmlEntities(match[1]), baseUrl).href;
      const text = htmlToText(match[2]);
      output.push({ url, text });
    } catch {
      // Ignore invalid URLs.
    }
  }
  return output;
}

export function normalizeLines(text = "") {
  return String(text)
    .split("\n")
    .map((line) => line.replace(/^[\s・●■◆◇※]+/, "").trim())
    .filter(Boolean);
}
