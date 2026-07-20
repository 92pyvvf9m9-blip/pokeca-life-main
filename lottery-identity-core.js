(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  root.PokecaLotteryIdentityCore=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';

  function clean(value=''){
    return String(value||'').normalize('NFKC').toLowerCase()
      .replace(/https?:\/\/[^\s]+/g,'')
      .replace(/[\s　「」『』【】［］\[\]()（）・･\-‐‑‒–—―_]/g,'')
      .trim();
  }
  function normalizeHttpUrl(value=''){
    const text=String(value||'').trim();
    if(!text)return '';
    if(!/^https?:\/\//i.test(text))return '';
    try{
      const url=new URL(text);
      const host=url.hostname.toLowerCase();
      const livePocketSlug=url.pathname.match(/^\/e\/([A-Za-z0-9_-]+)/)?.[1]||'';
      if(livePocketSlug&&/(^|\.)livepocket\.jp$/i.test(host))return `https://livepocket.jp/e/${livePocketSlug}`;
      const googleFormId=(host==='docs.google.com'||host==='forms.google.com')
        ?(url.pathname.match(/^\/forms\/d\/(?:e\/)?([^/]+)\/(?:viewform|formResponse)\/?$/i)?.[1]||'')
        :'';
      if(googleFormId)return `https://docs.google.com/forms/d/e/${googleFormId}/viewform`;
      if(host==='forms.gle'){
        url.hash='';url.search='';url.pathname=url.pathname.replace(/\/+$/,'');
        return url.pathname&&url.pathname!=='/'?`https://forms.gle${url.pathname}`:'';
      }
      for(const key of [...url.searchParams.keys()]){
        if(/^utm_|^(ref|source|from|fbclid|gclid)$/i.test(key))url.searchParams.delete(key);
      }
      url.hash='';url.hostname=host;
      return `${url.origin}${url.pathname}${url.search}`.replace(/\/$/,'');
    }catch{return text;}
  }
  function applicationUrl(item={}){
    return normalizeHttpUrl(item.url||'')||normalizeHttpUrl(item.appUrl||'')||normalizeHttpUrl(item.fallbackUrl||'')||'';
  }
  function variantKey(item={}){
    const shop=clean(item.shop||'');
    const product=clean(item.product||'');
    const deadline=String(item.applyEndDate||item.deadline||'').trim();
    return [shop,product,deadline].join('|');
  }
  function identity(item={}){
    const url=applicationUrl(item);
    const variant=variantKey(item);
    if(url)return `url:${url}|variant:${variant}`;
    const external=String(item.externalId||item.remoteId||'').trim();
    if(external&&!/^https?:\/\//i.test(external))return `external:${external}|variant:${variant}`;
    return `fallback:${variant}`;
  }
  function same(a={},b={}){return identity(a)===identity(b);}
  return {clean,normalizeHttpUrl,applicationUrl,variantKey,identity,same};
});
