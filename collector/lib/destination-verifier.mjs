import { htmlToText } from "./html.mjs";

function normalize(value = "") {
  return String(value).normalize("NFKC").toLowerCase().replace(/[^a-z0-9ぁ-んァ-ヶ一-龠]+/g, "");
}

function usefulProductTokens(value = "") {
  const text = normalize(value)
    .replace(/ポケモンカードゲーム|ポケモンカード|ポケカ|拡張パック|強化拡張パック|ハイクラスパック|box|ボックス/g, "");
  return [...new Set([text, ...text.match(/.{4,}/g) || []].filter((x) => x.length >= 4))];
}

export async function verifyDestination(candidate, fetchHtml, options = {}) {
  let host = "";
  try { host = new URL(candidate.url || "").hostname.replace(/^www\./, ""); } catch {}
  let discoveryHost = "";
  try { discoveryHost = new URL(candidate.sourceUrl || "").hostname.replace(/^www\./, ""); } catch {}
  const isDiscoveryPage = Boolean(discoveryHost && host === discoveryHost && candidate.sourceKind !== "web");
  const blockedDestinationDomains = new Set(
    (options.blockedDestinationDomains || [])
      .map((value) => String(value || "").toLowerCase().replace(/^www\./, ""))
      .filter(Boolean)
  );
  const blockedDestination = [...blockedDestinationDomains].some(
    (domain) => host === domain || host.endsWith(`.${domain}`)
  );
  if (!host || isDiscoveryPage || blockedDestination || /x\.com$|twitter\.com$/.test(host)) {
    return { ok: false, host, reason: "直接応募先ではありません" };
  }

  try {
    const html = await fetchHtml({ url: candidate.url });
    const text = htmlToText(html);
    const lotteryLanguage = /抽選|応募|エントリー|招待リクエスト|予約|受付/.test(text);
    const pokemonLanguage = /ポケモンカード|ポケカ/.test(text);
    const productMatch = usefulProductTokens(candidate.product).some((token) => normalize(text).includes(token));
    const ok = lotteryLanguage && (pokemonLanguage || productMatch);
    return {
      ok,
      host,
      reason: ok ? "" : "応募先ページで商品・抽選内容を確認できません",
      productMatch,
      lotteryLanguage,
    };
  } catch (error) {
    return { ok: false, host, reason: `応募先の取得失敗: ${String(error?.message || error)}` };
  }
}
