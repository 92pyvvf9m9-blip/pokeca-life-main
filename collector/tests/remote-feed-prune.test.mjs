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

test("legacy auto-collected records without origin are still pruned",()=>{
  const items=[
    {id:"legacy",externalId:"legacy-old",verified:true,qualityVersion:2,collectedAt:"2026-07-01",key:"legacy-old"},
    {id:"user",externalId:"user-local",manualEntry:true,key:"user-local"},
  ];
  const result=core.pruneMissingRemote(items,{
    identityFn:identity,
    baseKeys:new Set(),
    baseAuthoritative:true,
  });
  assert.deepEqual(result.removed.map(item=>item.id),["legacy"]);
  assert.deepEqual(result.items.map(item=>item.id),["user"]);
});

test("legacy remote fallback can migrate before stale cleanup",()=>{
  const items=[
    {id:"legacy",externalId:"old",verified:true,collectedAt:"2026-07-01",fallback:"same"},
  ];
  const found=core.findUniqueFallbackMatch(items,{fallback:"same"},item=>item.fallback||"");
  assert.equal(found?.id,"legacy");
});

test("expired remote manual listings are removed after the shared 35-day history window",()=>{
  const items=[
    {id:"july",origin:"remote",manualEntry:true,adminPublished:true,purchaseEndDate:"2026-08-02"},
    {id:"active",origin:"remote",manualEntry:true,adminPublished:true,applyEndDate:"2026-10-04"},
    {id:"local",origin:"local",manualEntry:true,applyEndDate:"2026-01-01"},
  ];
  const result=core.pruneExpiredRemote(items,{now:new Date("2026-10-03T00:00:00Z")});
  assert.deepEqual(result.removed.map(item=>item.id),["july"]);
  assert.deepEqual(result.items.map(item=>item.id),["active","local"]);
});

test("remote expiry keeps a listing until its purchase period has aged out",()=>{
  const items=[
    {id:"recent-purchase",origin:"remote",applyEndDate:"2026-08-01",purchaseEndDate:"2026-09-10"},
    {id:"fallback-to-result",origin:"remote",resultDate:"2026-10-14"},
    {id:"invalid-date",origin:"remote",applyEndDate:"unknown"},
  ];
  const result=core.pruneExpiredRemote(items,{now:new Date("2026-10-03T00:00:00Z")});
  assert.deepEqual(result.removed,[]);
  assert.deepEqual(result.items.map(item=>item.id),["recent-purchase","fallback-to-result","invalid-date"]);
});

test("legacy Hobby Station product descriptions are repaired to the catalog name",()=>{
  const repaired=core.repairLegacyProductName(
    "拡張パック ストームエメラルダ 特性 はしゃのほうこうは、手札からベンチに出したとき、山札を上から4枚見て基本エネルギーを1枚つけることができるぞ！",
    [
      {id:"storm",name:"拡張パック ストームエメラルダ",category:"拡張パック",aliases:["ストームエメラルダ"]},
      {id:"abyss",name:"拡張パック アビスアイ",category:"拡張パック",aliases:["アビスアイ"]},
    ]
  );
  assert.equal(repaired,"拡張パック ストームエメラルダ");
});

test("normal product names are not rewritten",()=>{
  assert.equal(core.repairLegacyProductName("スタートデッキ100 バトルコレクション",[]),"スタートデッキ100 バトルコレクション");
});
