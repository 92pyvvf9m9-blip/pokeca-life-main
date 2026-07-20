(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  root.PokecaOcrCore=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';

  const PREFECTURES=['北海道','青森県','岩手県','宮城県','秋田県','山形県','福島県','茨城県','栃木県','群馬県','埼玉県','千葉県','東京都','神奈川県','新潟県','富山県','石川県','福井県','山梨県','長野県','岐阜県','静岡県','愛知県','三重県','滋賀県','京都府','大阪府','兵庫県','奈良県','和歌山県','鳥取県','島根県','岡山県','広島県','山口県','徳島県','香川県','愛媛県','高知県','福岡県','佐賀県','長崎県','熊本県','大分県','宮崎県','鹿児島県','沖縄県'];
  const PREF_SHORT=Object.fromEntries(PREFECTURES.map(name=>[name.replace(/[都道府県]$/,''),name]));
  const CHAIN_PATTERN='ブックオフ|BOOKOFF|ホビーステーション|ホビステ|カードラボ|古本市場|ふるいち|フタバ図書|駿河屋|ゲオ|GEO|イオンスタイル|イオン|ヤマダデンキ|ジョーシン|エディオン|ビックカメラ|トイザらス|TSUTAYA|ポケモンセンター|カードボックス|レプトン|晴れる屋2|ドラゴンスター|GIRAFULL|ジラフル|ホビーゾーン|おたいち|お宝市番館|トレカ|カードショップ';
  const SECTION_LABELS={
    apply:/応募期間|応募受付期間|応募受付|受付期間|申込期間|お申し込み期間|申込み期間|応募締切|締切|〆切/,
    result:/当選発表|結果発表|抽選結果|当落発表|当選通知/,
    purchase:/購入期間|購入期限|受取期間|受け取り期間|引取期間|販売期間|受取期限/,
    stop:/注意事項|応募条件|応募方法|対象店舗|商品概要|概要|その他注意事項|応募に関して/
  };

  function normalizeText(value=''){
    return String(value||'').normalize('NFKC')
      .replace(/\u00a0/g,' ')
      .replace(/[　\t]+/g,' ')
      .replace(/[：﹕]/g,':')
      .replace(/[～〜]/g,'〜')
      .replace(/[／⁄∕]/g,'/')
      .replace(/\r/g,'')
      .replace(/\n{3,}/g,'\n\n')
      .trim();
  }
  function cleanLine(value=''){
    return normalizeText(value)
      .replace(/https?:\/\/\S+/gi,'')
      .replace(/^[\s■□◆◇●○・※✓✅☑️📣🎯👉〆締]+/u,'')
      .replace(/[（(][^）)]*(?:抽選|広島|東京|大阪|店舗)[^）)]*[）)]\s*で?$/u,'')
      .replace(/\s{2,}/g,' ')
      .trim();
  }
  function isoDate(year,month,day){
    return `${String(year).padStart(4,'0')}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
  }
  function normalizeDateGlyphs(value=''){
    const fixPart=part=>String(part).replace(/[Oo]/g,'0').replace(/[Il|]/g,'1');
    return normalizeText(value)
      .replace(/\b([0-9OoIl|]{1,4})([\/.\-])([0-9OoIl|]{1,2})(?:([\/.\-])([0-9OoIl|]{1,2}))?\b/g,(match,a,sep,b,sep2,c)=>{
        const first=fixPart(a),second=fixPart(b);
        return c===undefined?`${first}${sep}${second}`:`${first}${sep}${second}${sep2}${fixPart(c)}`;
      });
  }
  function dateTokens(value='',baseYear=new Date().getFullYear()){
    const text=normalizeDateGlyphs(value)
      .replace(/[（(][月火水木金土日](?:・祝)?[）)]/g,' ')
      .replace(/[（(]祝[）)]/g,' ');
    const pattern=/(?:(20\d{2})\s*(?:年|[\/.\-])\s*)?(\d{1,2})\s*(?:月|[\/.\-])\s*(\d{1,2})\s*日?(?:\s*(?:[（(][^）)]*[）)]))?(?:\s*(\d{1,2})\s*(?::|時)\s*(\d{1,2})?\s*分?)?/g;
    const matches=[...text.matchAll(pattern)];
    if(!matches.length)return[];
    let inheritedYear=Number(matches.find(m=>m[1])?.[1]||baseYear);
    let previousMonth=null;
    const output=[];
    for(const match of matches){
      if(match[1])inheritedYear=Number(match[1]);
      const month=Number(match[2]),day=Number(match[3]);
      if(month<1||month>12||day<1||day>31)continue;
      if(!match[1]&&previousMonth!==null&&previousMonth>=11&&month<=2)inheritedYear+=1;
      previousMonth=month;
      output.push({
        date:isoDate(inheritedYear,month,day),
        time:match[4]?`${String(match[4]).padStart(2,'0')}:${String(match[5]||'00').padStart(2,'0')}`:'',
        index:match.index||0,
        raw:match[0]
      });
    }
    return output;
  }
  function sectionAfterLabel(text,labelPattern){
    const lines=normalizeText(text).split('\n').map(line=>line.trim()).filter(Boolean);
    for(let i=0;i<lines.length;i++){
      if(!labelPattern.test(lines[i]))continue;
      const out=[lines[i]];
      for(let j=i+1;j<Math.min(lines.length,i+10);j++){
        const line=lines[j];
        const isOther=[SECTION_LABELS.apply,SECTION_LABELS.result,SECTION_LABELS.purchase,SECTION_LABELS.stop]
          .some(pattern=>pattern.test(line));
        if(isOther&&!labelPattern.test(line))break;
        out.push(line);
      }
      return out.join(' ');
    }
    return'';
  }
  function parsePeriod(text,kind,baseYear){
    const section=sectionAfterLabel(text,SECTION_LABELS[kind]);
    if(!section)return{section:''};
    const tokens=dateTokens(section,baseYear);
    if(!tokens.length)return{section};
    if(tokens.length===1){
      const only=tokens[0];
      if(kind==='apply')return{startDate:'',startTime:'',endDate:only.date,endTime:only.time,section};
      if(kind==='result')return{startDate:only.date,startTime:only.time,endDate:'',endTime:'',section};
      const endOnly=/まで|締切|期限/.test(section)&&!/から|より|開始|〜/.test(section);
      return endOnly
        ?{startDate:'',startTime:'',endDate:only.date,endTime:only.time,section}
        :{startDate:only.date,startTime:only.time,endDate:'',endTime:'',section};
    }
    return{
      startDate:tokens[0].date,startTime:tokens[0].time,
      endDate:tokens[tokens.length-1].date,endTime:tokens[tokens.length-1].time,
      section
    };
  }
  function detectPrefecture(text=''){
    const source=normalizeText(text);
    const exact=PREFECTURES.find(name=>source.includes(name));
    if(exact)return exact;
    for(const [shortName,fullName] of Object.entries(PREF_SHORT)){
      if(new RegExp(`[（(\\s]${shortName}[）)\\s]`).test(source))return fullName;
    }
    return'';
  }
  function detectShop(text=''){
    const lines=normalizeText(text).split('\n').map(cleanLine).filter(Boolean);
    const chainRegex=new RegExp(`(?:${CHAIN_PATTERN})`,'i');
    for(const line of lines){
      if(!chainRegex.test(line)||!/店/.test(line))continue;
      let candidate=line
        .replace(/^.*?(?=(?:ブックオフ|BOOKOFF|ホビーステーション|ホビステ|カードラボ|古本市場|ふるいち|フタバ図書|駿河屋|ゲオ|GEO|イオンスタイル|イオン|ヤマダデンキ|ジョーシン|エディオン|ビックカメラ|トイザらス|TSUTAYA|ポケモンセンター|カードボックス|レプトン|晴れる屋2|ドラゴンスター|GIRAFULL|ジラフル|ホビーゾーン|おたいち|お宝市番館|トレカ|カードショップ))/i,'')
        .replace(/[（(](?:北海道|青森|岩手|宮城|秋田|山形|福島|茨城|栃木|群馬|埼玉|千葉|東京|神奈川|新潟|富山|石川|福井|山梨|長野|岐阜|静岡|愛知|三重|滋賀|京都|大阪|兵庫|奈良|和歌山|鳥取|島根|岡山|広島|山口|徳島|香川|愛媛|高知|福岡|佐賀|長崎|熊本|大分|宮崎|鹿児島|沖縄)[）)]\s*で?.*$/,'')
        .replace(/\s*(?:で|にて)?\s*(?:「|『)?.*?(?:抽選販売|抽選受付|抽選).*/,'')
        .replace(/\s{2,}/g,' ')
        .trim();
      const end=candidate.indexOf('店');
      if(end>=0)candidate=candidate.slice(0,end+1);
      if(candidate.length>=3&&candidate.length<=80)return candidate;
    }
    const fallback=normalizeText(text).match(new RegExp(`((?:${CHAIN_PATTERN})[^\n「」]{0,50}店)`,'i'));
    return fallback?cleanLine(fallback[1]):'';
  }
  function detectProduct(text='',products=[]){
    const source=normalizeText(text);
    const candidates=[];
    for(const product of products||[]){
      const names=[product?.name,...(product?.aliases||[])].filter(Boolean);
      for(const name of names){
        const normalized=normalizeText(name);
        if(normalized&&source.includes(normalized))candidates.push({name:product.name||normalized,length:normalized.length});
      }
    }
    if(candidates.length)return candidates.sort((a,b)=>b.length-a.length)[0].name;
    const quoted=[...source.matchAll(/[「『“\"]([^」』”\"]{2,120})[」』”\"]/g)]
      .map(match=>cleanLine(match[1]))
      .filter(value=>/エメラルダ|ポケモン|カード|BOX|デッキ|パック|セット|ex|MEGA/i.test(value));
    if(quoted.length)return quoted.sort((a,b)=>b.length-a.length)[0];
    const line=source.split('\n').map(cleanLine).find(value=>
      /エメラルダ|拡張パック|強化拡張パック|ハイクラスパック|スタートデッキ|スターターセット|プレミアムトレーナーボックス|ポケモンカード/i.test(value)&&
      !/抽選販売|応募期間|当選発表|受取期間|注意事項/.test(value)
    );
    return line?line.replace(/^.*?(?:商品|対象商品)\s*[:：]?\s*/,'').slice(0,120):'';
  }
  function countFields(item){
    return['shop','product','applyEndDate','resultStartDate','purchaseStartDate','purchaseEndDate'].filter(key=>item[key]).length;
  }
  function extractLotteryInfo(text='',options={}){
    const source=normalizeText(text);
    const baseYear=Number(options.baseYear||new Date().getFullYear());
    const apply=parsePeriod(source,'apply',baseYear);
    const result=parsePeriod(source,'result',baseYear);
    const purchase=parsePeriod(source,'purchase',baseYear);
    const shop=detectShop(source);
    const product=detectProduct(source,options.products||[]);
    const area=detectPrefecture(`${shop}\n${source}`)||'全国';
    const item={
      shop,product,url:'',
      applyStartDate:apply.startDate||'',applyStartTime:apply.startTime||'',applyEndDate:apply.endDate||'',applyEndTime:apply.endTime||'',
      resultStartDate:result.startDate||'',resultStartTime:result.startTime||'',resultEndDate:result.endDate||'',resultEndTime:result.endTime||'',resultNote:/順次/.test(result.section||'')?'順次発表':'',
      purchaseStartDate:purchase.startDate||'',purchaseStartTime:purchase.startTime||'',purchaseEndDate:purchase.endDate||'',purchaseEndTime:purchase.endTime||'',
      type:shop?'店舗':'通販',area:shop?area:'全国',memo:'スクショ画像から文字・日付を自動読取'
    };
    const fieldCount=countFields(item);
    return{item,confidence:Math.min(1,fieldCount/6),fieldCount,sourceText:source,evidence:{apply:apply.section||'',result:result.section||'',purchase:purchase.section||''}};
  }
  function mergeLotteryInfo(primary={},fallback={},url=''){
    const output={...fallback,...primary};
    const keys=['shop','product','applyStartDate','applyStartTime','applyEndDate','applyEndTime','resultStartDate','resultStartTime','resultEndDate','resultEndTime','resultNote','purchaseStartDate','purchaseStartTime','purchaseEndDate','purchaseEndTime','area'];
    for(const key of keys){if(!primary?.[key]&&fallback?.[key])output[key]=fallback[key]}
    if(fallback?.shop&&(!primary?.shop||primary?.type==='通販')){
      output.shop=fallback.shop;output.type=fallback.type||'店舗';output.area=fallback.area||output.area||'全国';
    }
    if(url)output.url=url;
    const notes=[primary?.memo,fallback?.memo].filter(Boolean);
    output.memo=[...new Set(notes.join('\n').split('\n').map(x=>x.trim()).filter(Boolean))].join('\n');
    return output;
  }

  return{normalizeText,dateTokens,detectShop,detectProduct,detectPrefecture,extractLotteryInfo,mergeLotteryInfo};
});
