import { matchCatalogProduct } from "./quality-gate.mjs";

function normalize(value = "") {
  return String(value)
    .normalize("NFKC")
    .toLowerCase()
    .replace(/ポケモンカードゲーム|ポケモンカード|ポケカ|mega/g, "")
    .replace(/[^a-z0-9ぁ-んァ-ヶ一-龠]+/g, "")
    .trim();
}

function advertisedCount(value = "") {
  const match = String(value || "").match(/(\d+)\s*種/);
  return match ? Number(match[1]) : 0;
}

function groupStem(group = {}) {
  return normalize(String(group.name || "").replace(/\s*\d+\s*種.*$/, ""));
}

export function catalogGroupMembers(group = {}, catalog = []) {
  if (!group || group.category !== "商品グループ" || !group.releaseDate) return [];
  const stem = groupStem(group);
  if (!stem) return [];
  const members = (Array.isArray(catalog) ? catalog : [])
    .filter((product) => product?.id !== group.id)
    .filter((product) => product?.category !== "商品グループ")
    .filter((product) => product?.releaseDate === group.releaseDate)
    .filter((product) => normalize(product?.name || "").startsWith(stem));
  const count = advertisedCount(group.name);
  if (count && members.length !== count) return [];
  return members;
}

export function expandCatalogGroupCandidates(items = [], catalog = []) {
  const output = [];
  let expandedCount = 0;
  for (const raw of Array.isArray(items) ? items : []) {
    const item = { ...raw };
    if (!item.expandCatalogGroup) {
      output.push(item);
      continue;
    }
    const group = matchCatalogProduct(item.product, catalog);
    const members = catalogGroupMembers(group, catalog);
    if (!members.length) {
      output.push(item);
      continue;
    }
    for (const member of members) {
      const expanded = {
        ...item,
        product: member.name,
        productCatalogId: member.id,
        expandCatalogGroup: false,
        catalogGroupExpandedFrom: group.id,
        collectionMode: `${item.collectionMode || "official"}-catalog-group-expanded`,
      };
      output.push(expanded);
      expandedCount += 1;
    }
  }
  return { items: output, expandedCount };
}
