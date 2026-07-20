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

function textOf(item = {}, evidence = "") {
  return [item.shop, item.appName, item.product, item.instructions, item.memo, item.url, item.sourceUrl, evidence]
    .filter(Boolean).join("\n").normalize("NFKC");
}

function profileFor(text = "") {
  return APP_PROFILES.find((profile) => profile.patterns.some((pattern) => pattern.test(text))) || null;
}

function hasAppIntent(item = {}, text = "") {
  if (item.destinationType === "app" || item.appName || item.appUrl) return true;
  return APP_INTENT_PATTERNS.some((pattern) => pattern.test(text));
}

function lineMiniAppUrl(item = {}) {
  return [item.appUrl, item.url, item.fallbackUrl, item.sourceUrl]
    .find((value) => /^https:\/\/(?:liff|miniapp)\.line\.me\//i.test(String(value || ""))) || "";
}

export function enrichAppDestination(item = {}, evidence = "") {
  const text = textOf(item, evidence);
  const profile = profileFor(text);
  if (!hasAppIntent(item, text)) return item;

  const appName = item.appName || profile?.name || "応募アプリ";
  const appUrl = item.appUrl || (profile?.lineMiniApp ? lineMiniAppUrl(item) : "");
  return {
    ...item,
    destinationType: "app",
    appId: item.appId || profile?.id || "",
    appName,
    appUrl,
    fallbackUrl: item.fallbackUrl || item.sourceUrl || item.url || profile?.appOfficialUrl || profile?.iosAppStoreUrl || "",
    iosAppStoreUrl: item.iosAppStoreUrl || profile?.iosAppStoreUrl || "",
    appOfficialUrl: item.appOfficialUrl || profile?.appOfficialUrl || "",
    instructions: item.instructions || `${appName}内の抽選案内から応募してください。`,
  };
}
