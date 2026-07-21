(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  root.PokecaRemoteFeedCore=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';

  function buildKeySet(items=[],identityFn){
    const keys=new Set();
    for(const item of Array.isArray(items)?items:[]){
      const key=String(identityFn?.(item)||'');
      if(key)keys.add(key);
    }
    return keys;
  }

  function findUniqueFallbackMatch(items=[],target={},fallbackKeyFn){
    if(typeof fallbackKeyFn!=='function')return null;
    const targetKey=String(fallbackKeyFn(target)||'');
    if(!targetKey)return null;
    const matches=(Array.isArray(items)?items:[]).filter(item=>
      item?.origin==='remote'&&String(fallbackKeyFn(item)||'')===targetKey
    );
    return matches.length===1?matches[0]:null;
  }

  function pruneMissingRemote(items=[],options={}){
    const identityFn=typeof options.identityFn==='function'?options.identityFn:(item=>String(item?.externalId||item?.remoteId||''));
    const baseKeys=options.baseKeys instanceof Set?options.baseKeys:new Set(options.baseKeys||[]);
    const manualKeys=options.manualKeys instanceof Set?options.manualKeys:new Set(options.manualKeys||[]);
    const baseAuthoritative=Boolean(options.baseAuthoritative);
    const manualAuthoritative=Boolean(options.manualAuthoritative);
    const kept=[];
    const removed=[];

    for(const item of Array.isArray(items)?items:[]){
      if(item?.origin!=='remote'){
        kept.push(item);
        continue;
      }
      const key=String(identityFn(item)||'');
      if(!key){
        kept.push(item);
        continue;
      }
      const manual=Boolean(item?.manualEntry||item?.adminPublished);
      const stale=manual
        ?(manualAuthoritative&&!manualKeys.has(key))
        :(baseAuthoritative&&!baseKeys.has(key));
      if(stale)removed.push(item);
      else kept.push(item);
    }
    return{items:kept,removed};
  }

  return{buildKeySet,findUniqueFallbackMatch,pruneMissingRemote};
});
