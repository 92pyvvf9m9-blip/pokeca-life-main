import test from "node:test";
import assert from "node:assert/strict";
import "../../remote-feed-core.js";

const core=globalThis.PokecaRemoteFeedCore;
const identity=(item)=>item.key||"";

test("remote feed pruning removes only stale normal remote records",()=>{
  const items=[
    {id:"local",origin:"local",key:"local"},
    {id:"keep",origin:"remote",key:"base-1"},
    {id:"stale",origin:"remote",key:"base-old"},
    {id:"manual",origin:"remote",manualEntry:true,adminPublished:true,key:"manual-1"},
  ];
  const result=core.pruneMissingRemote(items,{
    identityFn:identity,
    baseKeys:new Set(["base-1"]),
    manualKeys:new Set(),
    baseAuthoritative:true,
    manualAuthoritative:false,
  });
  assert.deepEqual(result.items.map(item=>item.id),["local","keep","manual"]);
  assert.deepEqual(result.removed.map(item=>item.id),["stale"]);
});

test("manual records are pruned only after a successful authoritative manual sync",()=>{
  const items=[{id:"manual-old",origin:"remote",manualEntry:true,adminPublished:true,key:"manual-old"}];
  const preserved=core.pruneMissingRemote(items,{
    identityFn:identity,
    manualKeys:new Set(),
    manualAuthoritative:false,
  });
  assert.equal(preserved.removed.length,0);

  const pruned=core.pruneMissingRemote(items,{
    identityFn:identity,
    manualKeys:new Set(),
    manualAuthoritative:true,
  });
  assert.deepEqual(pruned.removed.map(item=>item.id),["manual-old"]);
});

test("empty or failed base feeds cannot erase cached remote records",()=>{
  const items=[{id:"cached",origin:"remote",key:"cached"}];
  const result=core.pruneMissingRemote(items,{
    identityFn:identity,
    baseKeys:new Set(),
    baseAuthoritative:false,
  });
  assert.equal(result.items.length,1);
  assert.equal(result.removed.length,0);
});


test("a single same-URL fallback record can migrate to a corrected product identity",()=>{
  const items=[
    {id:"old",origin:"remote",fallback:"url|shop|2026-07-12",status:"skipped"},
  ];
  const target={id:"new",origin:"remote",fallback:"url|shop|2026-07-12"};
  const found=core.findUniqueFallbackMatch(items,target,item=>item.fallback||"");
  assert.equal(found?.id,"old");
  assert.equal(found?.status,"skipped");
});

test("ambiguous same-URL fallback records are never auto-merged",()=>{
  const items=[
    {id:"a",origin:"remote",fallback:"same"},
    {id:"b",origin:"remote",fallback:"same"},
  ];
  assert.equal(core.findUniqueFallbackMatch(items,{fallback:"same"},item=>item.fallback||""),null);
});
