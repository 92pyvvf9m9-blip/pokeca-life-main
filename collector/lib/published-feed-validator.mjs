import { matchCatalogProduct } from "./quality-gate.mjs";

export function looksDescriptionLikeProductName(value = "") {
  const text = String(value || "").normalize("NFKC").replace(/\s+/g, " ").trim();
  if (!text) return false;
  if (text.length >= 110) return true;
  const proseSignals = [
    /この特性/, /このポケモン/, /手札から/, /山札を/, /基本エネルギー/, /ダメージ/, /相手のポケモン/,
    /デッキで戦/, /場に出すこと/, /収録されません/, /キャンペーン/, /遊び方の1つ/,
  ];
  return text.length >= 42 && proseSignals.some((pattern) => pattern.test(text));
}

export function validatePublishedLotteries(items = [], catalog = []) {
  const errors = [];
  for (const [index, item] of (Array.isArray(items) ? items : []).entries()) {
    const product = String(item?.product || "").trim();
    if (looksDescriptionLikeProductName(product)) {
      errors.push(`item ${index + 1}: 商品名に説明文が混入しています`);
      continue;
    }
    const matched = matchCatalogProduct(product, catalog);
    if (matched?.category === "商品グループ") {
      errors.push(`item ${index + 1}: 商品グループ「${matched.name}」が未分割です`);
    }
  }
  return { ok: errors.length === 0, errors };
}
