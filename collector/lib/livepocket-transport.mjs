import { execFile } from "node:child_process";
import { promisify } from "node:util";
const execute = promisify(execFile);

export const LIVEPOCKET_USER_AGENT = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

export function livePocketEventCount(html = "") {
  return new Set([...String(html).matchAll(/(?:https?:\/\/(?:[a-z0-9-]+\.)?livepocket\.jp)?\/e\/([a-z0-9_-]+)/gi)].map(match => match[1])).size;
}

export function livePocketResponseClass(html = "") {
  if (livePocketEventCount(html)) return "event_links";
  if (/captcha|verify you are human|just a moment|access denied|enable javascript and cookies|cf-chl-/i.test(html)) return "access_check";
  if (/<script\b/i.test(html) && !/<a\b/i.test(html)) return "script_only";
  return "no_event_links";
}

async function curlHtml(url) {
  const { stdout } = await execute("curl", ["--silent", "--show-error", "--fail", "--location", "--compressed", "--http1.1", "--max-time", "12", "--max-redirs", "3", "--user-agent", LIVEPOCKET_USER_AGENT, "--header", "Accept-Language: ja-JP,ja;q=0.9", "--", url], { timeout: 14000, maxBuffer: 8 * 1024 * 1024 });
  return stdout;
}

// An HTTP 200 shell is not proof that search results were actually received.
// Keep the primary response unless the second transport yields real event links.
export async function recoverLivePocketSearch(source, html, fallback = curlHtml) {
  let host = "";
  try { host = new URL(source.url).hostname; } catch {}
  if (source.parser !== "livepocket-search" || !/(^|\.)livepocket\.jp$/i.test(host) || livePocketEventCount(html)) return { html, fallbackUsed: false, responseClass: livePocketResponseClass(html) };
  try {
    const alternate = await fallback(source.url);
    if (livePocketEventCount(alternate)) return { html: alternate, fallbackUsed: true, responseClass: "event_links" };
  } catch { /* Retain the original response and its diagnostics. */ }
  return { html, fallbackUsed: false, responseClass: livePocketResponseClass(html) };
}
