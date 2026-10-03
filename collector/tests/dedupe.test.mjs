import test from "node:test";
import assert from "node:assert/strict";
import { dedupeItems } from "../lib/dedupe.mjs";

test("same direct form, product, and application window collapses store-name aliases", () => {
  const items = dedupeItems([
    { shop: "エディオン", product: "30th CELEBRATION カードセット（9種類セット）", applyStartDate: "2026-10-02", applyEndDate: "2026-10-04", url: "https://docs.google.com/forms/d/e/FORM_ID/viewform?usp=sharing&utm_source=mail", sourceKind: "web" },
    { shop: "トレカ・キャピタル", product: "30th CELEBRATION カードセット 全9種セット", applyStartDate: "2026-10-02", applyEndDate: "2026-10-04", url: "https://docs.google.com/forms/d/e/FORM_ID/viewform", sourceKind: "official" },
  ]);
  assert.equal(items.length, 1);
  assert.equal(items[0].evidenceCount, 2);
});

test("the same form keeps later rounds and different products as separate listings", () => {
  const base = { shop: "カードショップ", product: "30th CELEBRATION カードセット 9種セット", url: "https://example.com/draw" };
  const items = dedupeItems([
    { ...base, applyStartDate: "2026-10-02", applyEndDate: "2026-10-04" },
    { ...base, applyStartDate: "2026-12-01", applyEndDate: "2026-12-07" },
    { ...base, product: "30th CELEBRATION BOX", applyStartDate: "2026-10-02", applyEndDate: "2026-10-04" },
  ]);
  assert.equal(items.length, 3);
});
