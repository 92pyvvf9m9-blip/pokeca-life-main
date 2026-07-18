import test from "node:test";
import assert from "node:assert/strict";
import { parseDateRange } from "../lib/dates.mjs";

test("購入期限の単一日付は開始日ではなく終了日になる", () => {
  const parsed = parseDateRange("【購入期限】 8/2（日）営業時間終了まで", new Date("2026-07-19T12:00:00+09:00"));
  assert.equal(parsed.start, null);
  assert.equal(parsed.end?.date, "2026-08-02");
});

test("年末年始をまたぐ期間は終了日を翌年にする", () => {
  const parsed = parseDateRange("12/30〜1/2", new Date("2026-12-01T12:00:00+09:00"));
  assert.equal(parsed.start?.date, "2026-12-30");
  assert.equal(parsed.end?.date, "2027-01-02");
});
