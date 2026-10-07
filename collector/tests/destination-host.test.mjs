import test from "node:test";
import assert from "node:assert/strict";
import { sanitizeForPublic } from "../lib/dedupe.mjs";
import { verifyDestination } from "../lib/destination-verifier.mjs";
import { evaluateCandidate } from "../lib/quality-gate.mjs";

const url = "https://shoplottery.e-starbox.com/lottery/entry?code=RW9JoHbnD5";
const candidate = {
  shop: "カードボックス広島店",
  product: "拡張パック 30th CELEBRATION",
  applyStartDate: "2026-10-05",
  applyEndDate: "2026-10-08",
  url,
  sourceKind: "x",
  sourceUrl: "https://x.com/cbhiroshimafg/status/2100000000000000000",
  destinationVerified: true,
};

test("Cardbox application links survive public feed sanitization", () => {
  const item = sanitizeForPublic(candidate);
  assert.equal(item.url, url);
  assert.equal(item.sourceUrl, undefined);
});

test("Cardbox is a direct application host and can pass destination verification", async () => {
  let fetchedUrl = "";
  const result = await verifyDestination(candidate, async (source) => {
    fetchedUrl = source.url;
    return "<h1>ポケモンカードゲーム 30th CELEBRATION 購入権利抽選</h1><p>応募する</p>";
  });
  assert.equal(fetchedUrl, url);
  assert.equal(result.ok, true);
  const gate = evaluateCandidate(candidate, [{ id: "30th", name: candidate.product }], new Date("2026-10-06T12:00:00Z"));
  assert.equal(gate.accepted, true, gate.reasons.join(" / "));
  assert.equal(gate.checks.directDestination, true);
});

test("Actual X hosts still require a verified official notice", async () => {
  for (const host of ["x.com", "www.x.com", "twitter.com", "mobile.twitter.com"]) {
    const item = { ...candidate, url: `https://${host}/shop/status/123` };
    assert.equal(sanitizeForPublic(item).url, "");
    assert.equal((await verifyDestination(item, () => { throw new Error("must not fetch X as a direct application page"); })).ok, false);
    assert.equal(sanitizeForPublic({ ...item, noticeOnly: true }).url, item.url);
  }
});
