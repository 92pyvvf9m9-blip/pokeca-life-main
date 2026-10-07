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

test("an explicitly verified undated application stays active only for seven days", () => {
  const item={openEndedApplication:true,verified:true,adminPublished:true,
    applicationConfirmedAt:'2026-10-07T10:00:00Z',applyStartDate:'2026-10-04',
    url:'https://example.com/application'};
  assert.equal(lifecycle.hasConfirmedOpenEndedApplication(item,new Date('2026-10-07T10:00:00Z')),true);
  assert.equal(lifecycle.applicationState(item,new Date('2026-10-08T10:00:00Z')),'active');
  assert.equal(lifecycle.applicationState(item,new Date('2026-10-14T10:00:00Z')),'unconfirmed');
  for(const invalid of [
    {...item,verified:false},{...item,adminPublished:false},{...item,applicationConfirmedAt:''},
    {...item,url:''},{...item,url:'javascript:alert(1)'},{...item,applyStartDate:''},
  ])assert.equal(lifecycle.hasConfirmedOpenEndedApplication(invalid,new Date('2026-10-07T10:00:00Z')),false);
  assert.equal(lifecycle.hasConfirmedOpenEndedApplication(item,new Date('2026-10-06T10:00:00Z')),false);
  assert.equal(lifecycle.applicationState({...item,applyEndDate:'2026-10-08'},new Date('2026-10-09T10:00:00Z')),'closed');
});
