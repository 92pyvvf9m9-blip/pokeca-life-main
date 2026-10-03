import test from "node:test";
import assert from "node:assert/strict";
await import("../../lottery-lifecycle-core.js");
const lifecycle = globalThis.PokecaLotteryLifecycleCore;

test("future application windows are categorized as upcoming in Japan time", () => {
  assert.equal(lifecycle.applicationState({ applyStartDate: "2026-10-05", applyStartTime: "11:00" }, new Date("2026-10-03T00:00:00Z")), "upcoming");
  assert.equal(lifecycle.applicationState({ applyStartDate: "2026-10-02", applyStartTime: "10:00" }, new Date("2026-10-03T00:00:00Z")), "active");
});

test("officially announced draws without dates remain separate from active entries", () => {
  assert.equal(lifecycle.applicationState({ announcedUpcoming: true }, new Date("2026-10-03T00:00:00Z")), "announced");
  assert.equal(lifecycle.applicationState({ announcedUpcoming: true, applyStartDate: "2026-10-05" }, new Date("2026-10-03T00:00:00Z")), "upcoming");
  assert.equal(lifecycle.applicationState({}, new Date("2026-10-03T00:00:00Z")), "active");
});
