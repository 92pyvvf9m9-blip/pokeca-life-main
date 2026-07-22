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


  function normalizedProductText(value=''){
    return String(value||'')
      .normalize('NFKC')
      .toLowerCase()
      .replace(/[「」『』【】［］\[\]()（）・･\s　\-‐‑‒–—―_]/g,'')
      .replace(/ポケモンカードゲーム|ポケモンカード|ポケカ/g,'')
      .replace(/抽選販売|抽選受付|予約販売|応募フォーム|再販/g,'')
      .trim();
  }

  function looksDescriptionLikeProductName(value=''){
    const text=String(value||'').normalize('NFKC').replace(/\s+/g,' ').trim();
    if(!text)return false;
    if(text.length>=110)return true;
    const signals=[/この特性/,/このポケモン/,/手札から/,/山札を/,/基本エネルギー/,/ダメージ/,/相手のポケモン/,/デッキで戦/,/場に出すこと/,/収録されません/,/キャンペーン/,/遊び方の1つ/];
    return text.length>=42&&signals.some(pattern=>pattern.test(text));
  }

  function repairLegacyProductName(value='',products=[]){
    const original=String(value||'').trim();
    if(!looksDescriptionLikeProductName(original))return original;
    const target=normalizedProductText(original);
    let best=null;
    let bestScore=-1;
    for(const product of Array.isArray(products)?products:[]){
      if(!product||product.category==='商品グループ')continue;
      for(const label of [product.name,...(Array.isArray(product.aliases)?product.aliases:[])]){
        const key=normalizedProductText(label);
        if(!key||key.length<4||!target.includes(key))continue;
        const score=key.length;
        if(score>bestScore){best=product;bestScore=score;}
      }
    }
    return best?.name||original;
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

  return{isManagedRemote,looksDescriptionLikeProductName,repairLegacyProductName,buildKeySet,findUniqueFallbackMatch,pruneMissingRemote};
});
