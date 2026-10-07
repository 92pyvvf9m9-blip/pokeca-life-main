import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";

test("Japanese application dates and weekdays do not depend on the collector host timezone", () => {
  const datesUrl = new URL("../lib/dates.mjs", import.meta.url).href;
  const gateUrl = new URL("../lib/quality-gate.mjs", import.meta.url).href;
  const script = `
    import { parseDateRange, parseJapaneseDateToken } from ${JSON.stringify(datesUrl)};
    import { evaluateCandidate } from ${JSON.stringify(gateUrl)};
    const range = parseDateRange('応募期間：2026年10月5日17:00～10月8日23:59');
    const inferred = parseJapaneseDateToken('10月8日', new Date('2026-03-31T16:00:00Z'));
    const gate = evaluateCandidate({product:'拡張パック 30th CELEBRATION',url:'https://shoplottery.e-starbox.com/lottery/entry?code=test',applyEndDate:'2026-10-08',rawApplyText:'10/8(木)'}, [{name:'拡張パック 30th CELEBRATION'}], new Date('2026-10-06T12:00:00Z'));
    console.log(JSON.stringify({range,inferred,accepted:gate.accepted}));
  `;
  for (const timezone of ["UTC", "Asia/Tokyo", "America/Toronto"]) {
    const result = JSON.parse(execFileSync(process.execPath, ["--input-type=module", "-e", script], {env:{...process.env,TZ:timezone},encoding:"utf8"}));
    assert.equal(result.range.start.date, "2026-10-05", timezone);
    assert.equal(result.range.end.date, "2026-10-08", timezone);
    assert.equal(result.range.end.time, "23:59", timezone);
    assert.equal(result.inferred.date, "2026-10-08", timezone);
    assert.equal(result.accepted, true, timezone);
  }
});
