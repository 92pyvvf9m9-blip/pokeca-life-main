(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  root.PokecaAppDestinationCore=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';

  const IOS_BASE='https://apps.apple.com/jp/app/id';
  const APP_PROFILES=[
    {
      id:'geo',name:'ゲオアプリ',patterns:[/\bGEO\b/i,/ゲオ(?!ルグ)/],
      iosStoreUrl:`${IOS_BASE}590190880`,officialUrl:'https://geo-online.co.jp/'
    },
    {
      id:'bookoff',name:'ブックオフ公式アプリ',patterns:[/BOOK\s*OFF/i,/ブックオフ/],
      iosStoreUrl:`${IOS_BASE}1369113760`,officialUrl:'https://www.bookoff.co.jp/members/redirect.html'
    },
    {
      id:'kojima',name:'コジマアプリ',patterns:[/コジマ(?!プロダクション)/,/KOJIMA/i],
      iosStoreUrl:`${IOS_BASE}1216586207`,officialUrl:'https://www.kojima.net/shop/app/kojima_appli.html'
    },
    {
      id:'yamada',name:'ヤマダデジタル会員',patterns:[/ヤマダ(?:デンキ|電機)?/i,/YAMADA/i],
      iosStoreUrl:`${IOS_BASE}364504659`,officialUrl:'https://www.yamada-denki.jp/'
    },
    {
      id:'aeon',name:'イオンお買物アプリ',patterns:[/イオン(?:スタイル|リテール|お買物)?/i,/AEON/i],
      iosStoreUrl:`${IOS_BASE}634744681`,officialUrl:'https://www.aeonretail.jp/'
    },
    {
      id:'majica',name:'majicaアプリ',patterns:[/majica/i,/ドン[・･]?キホーテ/i,/MEGAドン/i,/アピタ|ピアゴ/],
      iosStoreUrl:`${IOS_BASE}1001883210`,officialUrl:'https://www.majica-net.com/'
    },
    {
      id:'biccamera',name:'ビックカメラアプリ',patterns:[/ビックカメラ/i,/BIC\s*CAMERA/i],
      iosStoreUrl:`${IOS_BASE}518593576`,officialUrl:'https://www.biccamera.com/'
    },
    {
      id:'edion',name:'エディオンアプリ',patterns:[/エディオン/i,/EDION/i],
      iosStoreUrl:`${IOS_BASE}434823849`,officialUrl:'https://www.edion.com/'
    },
    {
      id:'nojima',name:'ノジマアプリ',patterns:[/ノジマ/i,/NOJIMA/i],
      iosStoreUrl:`${IOS_BASE}451436140`,officialUrl:'https://www.nojima.co.jp/'
    },
    {
      id:'furuichi',name:'LINE（ふるいちアプリ）',patterns:[/ふるいち/i,/古本市場/i,/トレカパーク/i],
      officialUrl:'https://www.furu1.net/point-card.html',lineMiniApp:true
    },
    {
      id:'tsutaya',name:'本コレアプリ（TSUTAYA）',patterns:[/TSUTAYA/i,/蔦屋書店/i,/ツタヤ/i],
      iosStoreUrl:`${IOS_BASE}391429128`,officialUrl:'https://tsutaya.tsite.jp/'
    },
    {
      id:'x',name:'X',patterns:[/\bX\b/i,/Twitter/i,/ツイッター/i],
      officialUrl:'https://x.com/'
    }
  ];

  const APP_INTENT_PATTERNS=[
    /アプリ(?:内|から|で|限定)?[^\n]{0,24}(?:応募|抽選|申込|申し込み|エントリー|受付)/i,
    /(?:応募|抽選|申込|申し込み|エントリー|受付)[^\n]{0,24}アプリ/i,
    /WEB事前抽選[^\n]{0,20}アプリ/i,
    /アプリ抽選/i,
    /アプリ会員限定/i,
    /[（(]\s*アプリ\s*[）)]/i
  ];

  function clean(value=''){return String(value||'').normalize('NFKC').replace(/\s+/g,' ').trim()}
  function textFor(item={}){
    return clean([item.shop,item.appName,item.product,item.instructions,item.memo,item.sourceType,item.sourceUrl,item.url].filter(Boolean).join('\n'));
  }
  function isHttpUrl(value=''){return /^https?:\/\//i.test(String(value||'').trim())}
  function isCustomScheme(value=''){
    const text=String(value||'').trim();
    return /^[a-z][a-z0-9+.-]*:\/\//i.test(text)&&!/^https?:\/\//i.test(text);
  }
  function isAppStoreUrl(value=''){return /apps\.apple\.com|itunes\.apple\.com|play\.google\.com/i.test(String(value||''))}
  function normalizeLaunchUrl(value=''){
    const text=String(value||'').trim();
    if(!text)return '';
    if(isHttpUrl(text)||isCustomScheme(text)||/^intent:\/\//i.test(text))return text;
    return '';
  }
  function profileById(id=''){return APP_PROFILES.find(profile=>profile.id===id)||null}
  function profileByText(value=''){
    const text=clean(value);
    if(!text)return null;
    return APP_PROFILES.find(profile=>profile.patterns.some(pattern=>pattern.test(text)))||null;
  }
  function hasAppIntent(item={}){
    if(item.destinationType==='app'||item.appName||item.appUrl||item.iosAppStoreUrl||item.androidAppStoreUrl)return true;
    const text=textFor(item);
    return APP_INTENT_PATTERNS.some(pattern=>pattern.test(text));
  }
  function inferProfile(item={}){
    const explicit=profileById(item.appId||item.applicationAppId||'');
    if(explicit)return explicit;
    return profileByText([item.appName,item.shop,item.instructions,item.memo,item.url].filter(Boolean).join('\n'));
  }
  function lineMiniAppUrl(item={}){
    const candidates=[item.appUrl,item.url,item.fallbackUrl,item.sourceUrl];
    return candidates.map(normalizeLaunchUrl).find(url=>/^https:\/\/(?:liff|miniapp)\.line\.me\//i.test(url))||'';
  }
  function resolve(item={},platform=''){
    const original={...item};
    const appIntent=hasAppIntent(original);
    const profile=inferProfile(original);
    if(!appIntent)return {
      destinationType:original.destinationType||'direct',
      isApp:false,
      appId:'',appName:'',launchUrl:'',fallbackUrl:normalizeLaunchUrl(original.fallbackUrl||original.url||''),
      iosStoreUrl:'',androidStoreUrl:'',officialUrl:'',label:''
    };

    const detectedPlatform=platform||detectPlatform();
    const explicitLaunch=normalizeLaunchUrl(original.appUrl||original.appLaunchUrl||'');
    const miniApp=profile?.lineMiniApp?lineMiniAppUrl(original):'';
    const sourceUniversal=normalizeLaunchUrl(original.appUniversalUrl||'');
    const launchUrl=explicitLaunch||miniApp||sourceUniversal||'';
    const iosStoreUrl=normalizeLaunchUrl(original.iosAppStoreUrl||profile?.iosStoreUrl||'');
    const androidStoreUrl=normalizeLaunchUrl(original.androidAppStoreUrl||profile?.androidStoreUrl||'');
    const officialUrl=normalizeLaunchUrl(original.appOfficialUrl||profile?.officialUrl||'');
    let fallbackUrl=normalizeLaunchUrl(original.fallbackUrl||'');
    if(!fallbackUrl){
      fallbackUrl=detectedPlatform==='android'?(androidStoreUrl||officialUrl||iosStoreUrl):(iosStoreUrl||officialUrl||androidStoreUrl);
    }
    return {
      destinationType:'app',isApp:true,
      appId:original.appId||profile?.id||'',
      appName:clean(original.appName||profile?.name||'応募アプリ'),
      launchUrl,
      fallbackUrl,
      iosStoreUrl,
      androidStoreUrl,
      officialUrl,
      label:`${clean(original.appName||profile?.name||'アプリ')}で応募`,
      hasDirectLaunch:Boolean(launchUrl&&!isAppStoreUrl(launchUrl))
    };
  }
  function enrich(item={},platform=''){
    const resolved=resolve(item,platform);
    if(!resolved.isApp)return {...item};
    return {
      ...item,
      destinationType:'app',
      appId:item.appId||resolved.appId,
      appName:item.appName||resolved.appName,
      appUrl:normalizeLaunchUrl(item.appUrl||resolved.launchUrl),
      fallbackUrl:normalizeLaunchUrl(item.fallbackUrl||resolved.fallbackUrl),
      iosAppStoreUrl:normalizeLaunchUrl(item.iosAppStoreUrl||resolved.iosStoreUrl),
      androidAppStoreUrl:normalizeLaunchUrl(item.androidAppStoreUrl||resolved.androidStoreUrl),
      appOfficialUrl:normalizeLaunchUrl(item.appOfficialUrl||resolved.officialUrl)
    };
  }
  function detectPlatform(userAgent=''){
    const ua=String(userAgent||(typeof navigator!=='undefined'?navigator.userAgent:''));
    if(/android/i.test(ua))return 'android';
    if(/iphone|ipad|ipod/i.test(ua))return 'ios';
    return 'other';
  }
  function preferredFallback(resolved={},platform=''){
    const detected=platform||detectPlatform();
    if(detected==='android')return resolved.androidStoreUrl||resolved.fallbackUrl||resolved.officialUrl||resolved.iosStoreUrl||'';
    if(detected==='ios')return resolved.iosStoreUrl||resolved.fallbackUrl||resolved.officialUrl||resolved.androidStoreUrl||'';
    return resolved.officialUrl||resolved.fallbackUrl||resolved.iosStoreUrl||resolved.androidStoreUrl||'';
  }

  return {
    APP_PROFILES,APP_INTENT_PATTERNS,clean,isHttpUrl,isCustomScheme,isAppStoreUrl,normalizeLaunchUrl,
    profileById,profileByText,hasAppIntent,inferProfile,resolve,enrich,detectPlatform,preferredFallback
  };
});
