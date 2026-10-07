// Server-side only. Never copy this registry into the public deployment.
// The old t.livepocket.jp search does not include the current livepocket.jp site.
function searchSource(id, word, prefecture = "") {
  const url = new URL("https://livepocket.jp/event/search");
  url.searchParams.set("word", word);
  url.searchParams.set("sort", "3");
  if (prefecture) url.searchParams.set("pref", prefecture);
  return {
    id, name: "LivePocket公開抽選", url: url.href,
    enabled: true, platform: "livepocket", parser: "livepocket-search",
    type: "店舗", area: "全国", prefecture: prefecture || "全国",
    officialDomains: ["livepocket.jp"], priority: 95,
    discovery: {
      enabled: true, sameHostOnly: false, allowedHosts: ["livepocket.jp"],
      requiredPathPatterns: ["^/e/"], childParser: "livepocket",
      maxPages: 24, maxSearchPages: 2,
    },
  };
}

export const MAINTAINED_SOURCES = [
  searchSource("livepocket-current-pokemon", "ポケモンカード"),
  searchSource("livepocket-current-pokeca", "ポケカ"),
  searchSource("livepocket-current-hiroshima", "ポケモンカード", "広島県"),
  {
    id: "yodobashi-official-lottery", name: "ヨドバシ・ドット・コム",
    url: "https://limited.yodobashi.com/entry/shared/", enabled: true,
    platform: "website", officialStatus: "official", officialDomains: ["yodobashi.com"],
    parser: "yodobashi", type: "通販", area: "全国", priority: 95,
  },
];

export const MAINTAINED_X_ACCOUNTS = [
  { username: "YS_INFO", label: "イエローサブマリン", area: "全国", official: true },
  { username: "YS_HIROSHIMAGS", label: "イエローサブマリン広島店", area: "広島県", official: true },
  { username: "hiroshimalabo", label: "カードラボ広島店", area: "広島県", official: true },
  { username: "hobibi_net", label: "ホビビ通販部", area: "全国", official: true },
  { username: "torepla_ec", label: "トレカプラザ55通販店", area: "全国", official: true },
  { username: "MS_GANGI", label: "GANGI HOBBYSHOP", area: "全国", official: true },
];

export function withMaintainedXAccounts(config = {}) {
  const configured = [...(config.accounts || []), ...(config.officialAccounts || [])];
  const names = new Set(configured.map(account => String(account.username || account).toLowerCase()));
  return { ...config, officialAccounts: [...(config.officialAccounts || []),
    ...MAINTAINED_X_ACCOUNTS.filter(account => !names.has(account.username.toLowerCase())).map(account => ({ ...account }))] };
}

function registryUrl(value) {
  try {
    const url = new URL(value);
    url.hash = "";
    url.searchParams.sort();
    return url.href.replace(/\/$/, "");
  } catch { return String(value || ""); }
}

export function withMaintainedSources(payload = {}) {
  const configured = Array.isArray(payload.sources) ? payload.sources : [];
  const additions = MAINTAINED_SOURCES.filter((entry) => !configured.some((source) =>
    source.id === entry.id || registryUrl(source.url) === registryUrl(entry.url)
  ));
  // A configured source (including an explicit disabled entry) always wins.
  return { ...payload, sources: [...configured, ...structuredClone(additions)] };
}
