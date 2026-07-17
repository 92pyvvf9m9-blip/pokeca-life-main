import assert from "node:assert/strict";
import test from "node:test";
import { parseXPost } from "../lib/x-parser.mjs";
import { buildStoreIndex } from "../lib/location.mjs";

function post(text, url = "https://t.livepocket.jp/e/example") {
  return {
    id: String(Math.random()),
    created_at: "2026-07-17T03:00:00.000Z",
    text,
    entities: { urls: [{ expanded_url: url }] },
  };
}

test("店名の都市名から他県店舗を都道府県別に分類する", () => {
  const item = parseXPost(
    post("バトロコ東武宇都宮 拡張パック ストームエメラルダ 抽選受付中 店頭受取のみ"),
    { username: "batoloco_test", name: "バトロコ東武宇都宮" },
    new Set(["batoloco_test"])
  );
  assert.ok(item);
  assert.equal(item.type, "店舗");
  assert.equal(item.area, "栃木県");
});

test("オンライン配送は店名に都市名があっても全国通販にする", () => {
  const item = parseXPost(
    post("ヤマシロヤ オンラインショップ ポケモンカード MEGAドリームex 抽選販売 全国発送対応"),
    { username: "yamashiroya", name: "ヤマシロヤ" },
    new Set(["yamashiroya"]),
  );
  assert.ok(item);
  assert.equal(item.type, "通販");
  assert.equal(item.area, "全国");
});

test("店舗マスターの別名から広島県を補完する", () => {
  const storeIndex = buildStoreIndex({
    stores: [{ name: "フタバ図書TSUTAYA海田店", aliases: ["フタバ海田"], prefecture: "広島県" }],
  });
  const item = parseXPost(
    post("フタバ海田 強化拡張パック ストームエメラルダ 抽選応募 店頭購入"),
    { username: "kaitatosho", name: "フタバ海田" },
    new Set(["kaitatosho"]),
    { storeIndex },
  );
  assert.ok(item);
  assert.equal(item.type, "店舗");
  assert.equal(item.area, "広島県");
});

test("監視対象アカウントならポケカ表記がなくても商品名で拾う", () => {
  const item = parseXPost(
    post("拡張パック ストームエメラルダの抽選申込をLivePocketで開始しました。締切 2026年7月21日 23時59分"),
    { username: "hiroshimalabo", name: "広島カードショップ" },
    new Set(["hiroshimalabo"]),
  );
  assert.ok(item);
  assert.match(item.product, /ストームエメラルダ/);
  assert.equal(item.applyEndDate, "2026-07-21");
});
