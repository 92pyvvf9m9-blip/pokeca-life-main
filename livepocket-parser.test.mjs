import assert from "node:assert/strict";
import fs from "node:fs/promises";
import test from "node:test";
import { parseLivePocketPage } from "../lib/livepocket-parser.mjs";
import { buildStoreIndex } from "../lib/location.mjs";

const html = await fs.readFile(new URL("../fixtures/livepocket-sample.html", import.meta.url), "utf8");
const storeIndex = buildStoreIndex({
  stores: [{
    name: "フタバ図書TSUTAYA海田店",
    aliases: ["フタバ海田"],
    prefecture: "広島県",
  }],
});

test("LivePocketの店舗抽選から商品・期間・都道府県を取得する", () => {
  const item = parseLivePocketPage({
    html,
    url: "https://t.livepocket.jp/e/example",
    fallbackShop: "フタバ図書",
    collectedAt: "2026-07-17T09:00:00+09:00",
    storeIndex,
  });

  assert.equal(item.ok, true);
  assert.equal(item.shop, "フタバ図書TSUTAYA海田店");
  assert.match(item.product, /ストームエメラルダ/);
  assert.equal(item.type, "店舗");
  assert.equal(item.area, "広島県");
  assert.equal(item.applyStartDate, "2026-07-17");
  assert.equal(item.applyEndDate, "2026-07-21");
  assert.equal(item.resultStartDate, "2026-07-23");
  assert.equal(item.purchaseEndDate, "2026-07-27");
});
