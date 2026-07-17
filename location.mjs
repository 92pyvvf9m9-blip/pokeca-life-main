const PREFECTURES = [
  "北海道","青森県","岩手県","宮城県","秋田県","山形県","福島県",
  "茨城県","栃木県","群馬県","埼玉県","千葉県","東京都","神奈川県",
  "新潟県","富山県","石川県","福井県","山梨県","長野県","岐阜県",
  "静岡県","愛知県","三重県","滋賀県","京都府","大阪府","兵庫県",
  "奈良県","和歌山県","鳥取県","島根県","岡山県","広島県","山口県",
  "徳島県","香川県","愛媛県","高知県","福岡県","佐賀県","長崎県",
  "熊本県","大分県","宮崎県","鹿児島県","沖縄県",
];

// 店名で頻出する都市・駅名。曖昧な地名は、誤判定を避けるためここへ入れない。
const PLACE_TO_PREFECTURE = [
  ["札幌", "北海道"], ["函館", "北海道"], ["旭川", "北海道"],
  ["青森", "青森県"], ["弘前", "青森県"], ["八戸", "青森県"],
  ["盛岡", "岩手県"], ["仙台", "宮城県"], ["秋田", "秋田県"], ["山形", "山形県"], ["福島", "福島県"], ["郡山", "福島県"],
  ["水戸", "茨城県"], ["つくば", "茨城県"], ["宇都宮", "栃木県"], ["高崎", "群馬県"], ["前橋", "群馬県"],
  ["大宮", "埼玉県"], ["所沢", "埼玉県"], ["川越", "埼玉県"], ["浦和", "埼玉県"],
  ["千葉", "千葉県"], ["船橋", "千葉県"], ["柏", "千葉県"], ["津田沼", "千葉県"],
  ["渋谷", "東京都"], ["新宿", "東京都"], ["池袋", "東京都"], ["秋葉原", "東京都"], ["日本橋店", "東京都"], ["町田", "東京都"], ["立川", "東京都"], ["八王子", "東京都"], ["吉祥寺", "東京都"],
  ["横浜", "神奈川県"], ["川崎", "神奈川県"], ["藤沢", "神奈川県"], ["相模原", "神奈川県"],
  ["新潟", "新潟県"], ["長岡", "新潟県"], ["富山", "富山県"], ["金沢", "石川県"], ["福井", "福井県"],
  ["甲府", "山梨県"], ["長野", "長野県"], ["松本", "長野県"], ["岐阜", "岐阜県"],
  ["静岡", "静岡県"], ["浜松", "静岡県"], ["沼津", "静岡県"],
  ["名古屋", "愛知県"], ["豊橋", "愛知県"], ["岡崎", "愛知県"], ["一宮", "愛知県"],
  ["四日市", "三重県"], ["津駅", "三重県"], ["大津", "滋賀県"], ["草津", "滋賀県"],
  ["京都", "京都府"], ["梅田", "大阪府"], ["難波", "大阪府"], ["なんば", "大阪府"], ["天王寺", "大阪府"], ["心斎橋", "大阪府"], ["堺", "大阪府"],
  ["神戸", "兵庫県"], ["三宮", "兵庫県"], ["姫路", "兵庫県"], ["西宮", "兵庫県"],
  ["奈良", "奈良県"], ["和歌山", "和歌山県"], ["鳥取", "鳥取県"], ["米子", "鳥取県"], ["松江", "島根県"], ["出雲", "島根県"],
  ["岡山", "岡山県"], ["倉敷", "岡山県"],
  ["広島", "広島県"], ["海田", "広島県"], ["東広島", "広島県"], ["西条中央", "広島県"], ["可部", "広島県"], ["三次", "広島県"], ["福山", "広島県"], ["呉市", "広島県"], ["イオン広店", "広島県"], ["サンモール店", "広島県"],
  ["下関", "山口県"], ["山口", "山口県"], ["徳島", "徳島県"], ["高松", "香川県"], ["松山", "愛媛県"], ["高知", "高知県"],
  ["博多", "福岡県"], ["天神", "福岡県"], ["北九州", "福岡県"], ["小倉", "福岡県"], ["久留米", "福岡県"],
  ["佐賀", "佐賀県"], ["長崎", "長崎県"], ["佐世保", "長崎県"], ["熊本", "熊本県"], ["大分", "大分県"],
  ["宮崎", "宮崎県"], ["鹿児島", "鹿児島県"], ["那覇", "沖縄県"], ["沖縄", "沖縄県"],
];

const PICKUP_PATTERN = /店頭受(?:取|け取り)|店舗受(?:取|け取り)|受取店舗|当選店舗|店頭購入|来店購入|来店受取|店頭引換|店頭販売|店舗で購入|レジで購入|受け取り店舗/i;
const SHIPPING_PATTERN = /全国発送|発送(?:可能|対応|あり|いたします|します)?|配送(?:可能|対応|あり|いたします|します)?|郵送|宅配|送料|オンラインショップ|オンラインストア|通販|ECサイト/i;
const BRANCH_PATTERN = /(?:店|支店|本店|駅前|モール|センター|店舗)(?:\s|$|・|／|\/)/i;

function normalized(value = "") {
  return String(value).normalize("NFKC").replace(/\s+/g, "").toLowerCase();
}

export function buildStoreIndex(payload = {}) {
  const stores = Array.isArray(payload) ? payload : Array.isArray(payload?.stores) ? payload.stores : [];
  const entries = [];
  for (const store of stores) {
    const prefecture = String(store?.prefecture || "").trim();
    if (!PREFECTURES.includes(prefecture)) continue;
    for (const label of [store?.name, ...(store?.aliases || [])]) {
      const key = normalized(label);
      if (key.length >= 3) entries.push({ key, prefecture, name: String(store?.name || label) });
    }
  }
  return entries.sort((a, b) => b.key.length - a.key.length);
}

export function inferPrefecture(text = "", storeIndex = []) {
  const raw = String(text || "");
  const explicit = PREFECTURES.find((prefecture) => raw.includes(prefecture));
  if (explicit) return explicit;

  const key = normalized(raw);
  const store = (storeIndex || []).find((entry) => key.includes(entry.key));
  if (store) return store.prefecture;

  for (const [place, prefecture] of PLACE_TO_PREFECTURE) {
    if (raw.includes(place)) return prefecture;
  }
  return "";
}

export function inferFulfillment(text = "", shop = "", fallbackType = "") {
  const combined = `${shop}\n${text}`;
  const hasPickup = PICKUP_PATTERN.test(combined);
  const hasShipping = SHIPPING_PATTERN.test(combined);

  if (hasPickup && !hasShipping) return "店舗";
  if (hasShipping && !hasPickup) return "通販";

  if (hasPickup && hasShipping) {
    // 発送も選択できる案件は、遠方ユーザーも利用できるため通販扱い。
    if (/発送も|配送も|発送対応|配送対応|店頭受取または配送|受取(?:方法)?[^。\n]*(?:発送|配送)/i.test(combined)) return "通販";
    return "店舗";
  }

  const prefecture = inferPrefecture(combined);
  if (prefecture && BRANCH_PATTERN.test(`${shop} `)) return "店舗";
  if (fallbackType === "店舗" || fallbackType === "通販") return fallbackType;
  return prefecture ? "店舗" : "通販";
}

export function inferLotteryLocation({ text = "", shop = "", fallbackArea = "", fallbackType = "", storeIndex = [] } = {}) {
  const combined = `${shop}\n${text}`;
  const prefecture = inferPrefecture(combined, storeIndex);
  const type = inferFulfillment(text, shop, fallbackType);
  const explicitShipping = SHIPPING_PATTERN.test(combined) && !PICKUP_PATTERN.test(combined);

  if (type === "通販" && (explicitShipping || !prefecture)) {
    return { type: "通販", area: "全国", prefecture };
  }
  if (type === "店舗") {
    return {
      type: "店舗",
      area: prefecture || (PREFECTURES.includes(fallbackArea) ? fallbackArea : "未判定"),
      prefecture,
    };
  }
  return {
    type,
    area: prefecture || fallbackArea || (type === "通販" ? "全国" : "未判定"),
    prefecture,
  };
}

export { PREFECTURES };
