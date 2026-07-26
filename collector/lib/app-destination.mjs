const IOS_BASE = "https://apps.apple.com/jp/app/id";

export const APP_PROFILES = [
  { id: "geo", name: "ゲオアプリ", patterns: [/\bGEO\b/i, /ゲオ(?!ルグ)/], iosAppStoreUrl: `${IOS_BASE}590190880`, appOfficialUrl: "https://geo-online.co.jp/" },
  { id: "bookoff", name: "ブックオフ公式アプリ", patterns: [/BOOK\s*OFF/i, /ブックオフ/], iosAppStoreUrl: `${IOS_BASE}1369113760`, appOfficialUrl: "https://www.bookoff.co.jp/members/redirect.html" },
  { id: "kojima", name: "コジマアプリ", patterns: [/コジマ(?!プロダクション)/, /KOJIMA/i], iosAppStoreUrl: `${IOS_BASE}1216586207`, appOfficialUrl: "https://www.kojima.net/shop/app/kojima_appli.html" },
  { id: "yamada", name: "ヤマダデジタル会員", patterns: [/ヤマダ(?:デンキ|電機)?/i, /YAMADA/i], iosAppStoreUrl: `${IOS_BASE}364504659`, appOfficialUrl: "https://www.yamada-denki.jp/" },
  { id: "aeon", name: "イオンお買物アプリ", patterns: [/イオン(?:スタイル|リテール|お買物)?/i, /AEON/i], iosAppStoreUrl: `${IOS_BASE}634744681`, appOfficialUrl: "https://www.aeonretail.jp/" },
  { id: "majica", name: "majicaアプリ", patterns: [/majica/i, /ドン[・･]?キホーテ/i, /MEGAドン/i, /アピタ|ピアゴ/], iosAppStoreUrl: `${IOS_BASE}1001883210`, appOfficialUrl: "https://www.majica-net.com/" },
  { id: "biccamera", name: "ビックカメラアプリ", patterns: [/ビックカメラ/i, /BIC\s*CAMERA/i], iosAppStoreUrl: `${IOS_BASE}518593576`, appOfficialUrl: "https://www.biccamera.com/" },
  { id: "edion", name: "エディオンアプリ", patterns: [/エディオン/i, /EDION/i], iosAppStoreUrl: `${IOS_BASE}434823849`, appOfficialUrl: "https://www.edion.com/" },
  { id: "nojima", name: "ノジマアプリ", patterns: [/ノジマ/i, /NOJIMA/i], iosAppStoreUrl: `${IOS_BASE}451436140`, appOfficialUrl: "https://www.nojima.co.jp/" },
  { id: "furuichi", name: "LINE（ふるいちアプリ）", patterns: [/ふるいち/i, /古本市場/i, /トレカパーク/i], appOfficialUrl: "https://www.furu1.net/point-card.html", lineMiniApp: true },
  { id: "tsutaya", name: "本コレアプリ（TSUTAYA）", patterns: [/TSUTAYA/i, /蔦屋書店/i, /ツタヤ/i], iosAppStoreUrl: `${IOS_BASE}391429128`, appOfficialUrl: "https://tsutaya.tsite.jp/" },
];

const APP_INTENT_PATTERNS = [
  /アプリ(?:内|から|で|限定)?[^\n]{0,24}(?:応募|抽選|申込|申し込み|エントリー|受付)/i,
  /(?:応募|抽選|申込|申し込み|エントリー|受付)[^\n]{0,24}アプリ/i,
  /WEB事前抽選[^\n]{0,20}アプリ/i,
  /アプリ抽選/i,
  /アプリ会員限定/i,
  /[（(]\s*アプリ\s*[）)]/i,
];

const APP_KEYS = ["appId", "appName", "appUrl", "iosAppStoreUrl", "androidAppStoreUrl", "appOfficialUrl"];

function normalize(value = "") { return String(value || "").normalize("NFKC"); }
function profileFor(text = "") { return APP_PROFILES.find((p) => p.patterns.some((re) => re.test(normalize(text)))) || null; }
function identityText(item = {}) { return [item.shop, item.url, item.sourceUrl].filter(Boolean).join("\n"); }
function explicitText(item = {}) { return [item.appName, item.instructions, item.memo].filter(Boolean).join("\n"); }
function intentText(item = {}, evidence = "") { return [item.instructions, item.memo, evidence].filter(Boolean).join("\n"); }
function profileById(id = "") { return APP_PROFILES.find((p) => p.id === id) || null; }

function clearAppFields(item = {}) {
  const output = { ...item, destinationType: item.destinationType === "app" ? "direct" : (item.destinationType || "direct") };
  for (const key of APP_KEYS) output[key] = "";
  if (/アプリ内の抽選案内|ゲオアプリ内/.test(String(output.instructions || ""))) output.instructions = "";
  if (/geo-online\.co\.jp|apps\.apple\.com\/jp\/app\/id590190880/.test(String(output.fallbackUrl || ""))) output.fallbackUrl = output.url || output.sourceUrl || "";
  return output;
}

export function normalizeAppDestinationFields(item = {}) {
  let output = { ...item };
  const identityProfile = profileFor(identityText(output));
  const declaredProfile = profileById(output.appId) || profileFor(output.appName || "");
  const explicitApp = output.destinationType === "app" || Boolean(output.appName || output.appUrl);

  // A stored app profile may only survive when it agrees with the record's own
  // store/URL identity. This removes historical GEO metadata leaked into unrelated records.
  if (explicitApp && declaredProfile && identityProfile && declaredProfile.id !== identityProfile.id) {
    output = clearAppFields(output);
  } else if (explicitApp && declaredProfile && !identityProfile) {
    const shopText = normalize(output.shop || "");
    const shopMatchesDeclared = declaredProfile.patterns.some((re) => re.test(shopText));
    const trustedExplicit = Boolean(output.appUrl) || shopMatchesDeclared;
    if (!trustedExplicit) output = clearAppFields(output);
  }
  return output;
}

function hasAppIntent(item = {}, evidence = "") {
  if (item.destinationType === "app" || item.appName || item.appUrl) return true;
  return APP_INTENT_PATTERNS.some((pattern) => pattern.test(normalize(intentText(item, evidence))));
}

function lineMiniAppUrl(item = {}) {
  return [item.appUrl, item.url, item.fallbackUrl, item.sourceUrl]
    .find((value) => /^https:\/\/(?:liff|miniapp)\.line\.me\//i.test(String(value || ""))) || "";
}

export function enrichAppDestination(item = {}, evidence = "") {
  const normalized = normalizeAppDestinationFields(item);
  const identityProfile = profileFor(identityText(normalized));
  const declaredProfile = profileById(normalized.appId) || profileFor(normalized.appName || "");
  const explicitApp = normalized.destinationType === "app" || Boolean(normalized.appName || normalized.appUrl);
  const evidenceProfile = profileFor(evidence);
  const intent = hasAppIntent(normalized, evidence);

  // Page-wide evidence is allowed to prove app intent, but never to choose a chain.
  // Without a profile tied to this record, generic page text must not convert it to an app.
  const profile = identityProfile || (explicitApp ? declaredProfile : null);
  if (!intent) return normalized;
  if (!profile && evidenceProfile && !explicitApp) return normalized;
  if (!profile) {
    return {
      ...normalized,
      destinationType: "app",
      appId: "",
      appName: normalized.appName || "応募アプリ",
      appUrl: normalized.appUrl || "",
      fallbackUrl: normalized.fallbackUrl || normalized.sourceUrl || normalized.url || "",
      instructions: normalized.instructions || "アプリ内の抽選案内から応募してください。",
    };
  }

  const appName = profile.name;
  const appUrl = normalized.appUrl || (profile.lineMiniApp ? lineMiniAppUrl(normalized) : "");
  return {
    ...normalized,
    destinationType: "app",
    appId: profile.id,
    appName,
    appUrl,
    fallbackUrl: normalized.fallbackUrl || normalized.sourceUrl || normalized.url || profile.appOfficialUrl || profile.iosAppStoreUrl || "",
    iosAppStoreUrl: normalized.iosAppStoreUrl || profile.iosAppStoreUrl || "",
    appOfficialUrl: normalized.appOfficialUrl || profile.appOfficialUrl || "",
    instructions: normalized.instructions || `${appName}内の抽選案内から応募してください。`,
  };
}
