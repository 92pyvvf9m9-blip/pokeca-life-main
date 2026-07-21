(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  root.PokecaRemoteFeedCore=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';

  function isManagedRemote(item={}){
    if(!item||typeof item!=='object')return false;
    if(item.manualEntry||item.adminPublished)return false;
    if(item.origin==='remote')return true;
    if(item.remoteId)return true;
    return Boolean(item.externalId&&(item.verified||item.collectedAt||item.qualityVersion>=2));
  }

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
      isManagedRemote(item)&&String(fallbackKeyFn(item)||'')===targetKey
    );
    return matches.length===1?matches[0]:null;
  }

  function pruneMissingRemote(items=[],options={}){
    const identityFn=typeof options.identityFn==='function'?options.identityFn:(item=>String(item?.externalId||item?.remoteId||''));
    const managedRemoteFn=typeof options.managedRemoteFn==='function'?options.managedRemoteFn:isManagedRemote;
    const baseKeys=options.baseKeys instanceof Set?options.baseKeys:new Set(options.baseKeys||[]);
    const manualKeys=options.manualKeys instanceof Set?options.manualKeys:new Set(options.manualKeys||[]);
    const baseAuthoritative=Boolean(options.baseAuthoritative);
    const manualAuthoritative=Boolean(options.manualAuthoritative);
    const kept=[];
    const removed=[];

    for(const item of Array.isArray(items)?items:[]){
      const manual=Boolean(item?.manualEntry||item?.adminPublished);
      if(!manual&&!managedRemoteFn(item)){
        kept.push(item);
        continue;
      }
      const key=String(identityFn(item)||'');
      if(!key){
        kept.push(item);
        continue;
      }
      const stale=manual
        ?(manualAuthoritative&&!manualKeys.has(key))
        :(baseAuthoritative&&!baseKeys.has(key));
      if(stale)removed.push(item);
      else kept.push(item);
    }
    return{items:kept,removed};
  }

  return{isManagedRemote,buildKeySet,findUniqueFallbackMatch,pruneMissingRemote};
});
