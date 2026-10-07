(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  root.PokecaLotteryLifecycleCore=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';

  function parseJstDateTime(dateValue,timeValue='',endOfDay=false){
    const date=String(dateValue||'').trim();
    if(!/^\d{4}-\d{2}-\d{2}$/.test(date))return null;
    const time=String(timeValue||'').trim();
    const normalizedTime=/^\d{1,2}:\d{2}$/.test(time)
      ?`${time.padStart(5,'0')}:00`
      :endOfDay?'23:59:59':'00:00:00';
    const parsed=new Date(`${date}T${normalizedTime}+09:00`);
    return Number.isNaN(parsed.getTime())?null:parsed;
  }

  // An undated application needs an explicit, recent human confirmation.
  // A missing deadline alone must never turn an incomplete notice into a draw.
  function hasConfirmedOpenEndedApplication(item={},now=new Date()){
    if(item.openEndedApplication!==true||item.verified!==true||item.adminPublished!==true)return false;
    if(item.applyEndDate||item.deadline)return false;
    const confirmed=new Date(item.applicationConfirmedAt||'').getTime();
    const age=new Date(now).getTime()-confirmed;
    if(!Number.isFinite(age)||age<0||age>=7*86400000)return false;
    const start=parseJstDateTime(item.applyStartDate,item.applyStartTime);
    if(!start||start.getTime()>new Date(now).getTime())return false;
    return [item.url,item.appUrl,item.fallbackUrl].some(value=>{
      try{const url=new URL(value);return ['https:','http:'].includes(url.protocol)&&Boolean(url.hostname)}catch{return false}
    });
  }

  function applicationState(item={},now=new Date()){
    const end=parseJstDateTime(item.applyEndDate||item.deadline||'',item.applyEndTime||'',true);
    if(end&&end.getTime()<new Date(now).getTime())return 'closed';
    const start=parseJstDateTime(item.applyStartDate||'',item.applyStartTime||'');
    if(start&&start.getTime()>new Date(now).getTime())return 'upcoming';
    if(item.announcedUpcoming===true&&!item.applyStartDate)return 'announced';
    if(item.openEndedApplication===true&&!hasConfirmedOpenEndedApplication(item,now))return 'unconfirmed';
    return 'active';
  }

  function lifecycleEnd(item={}){
    const tracked=['applied','waiting','won'].includes(item.status);
    const periods=item.historyOnly&&!tracked
      ?[[item.applyEndDate||item.deadline,item.applyEndTime]]
      :[
        [item.applyEndDate||item.deadline,item.applyEndTime],
        [item.resultEndDate,item.resultEndTime],
        [item.resultStartDate||item.resultDate,item.resultStartTime],
        [item.purchaseEndDate||item.purchaseDeadline,item.purchaseEndTime]
      ];
    const dates=periods.map(([date,time])=>parseJstDateTime(date,time,true)).filter(Boolean);
    return dates.length?new Date(Math.max(...dates.map(date=>date.getTime()))):null;
  }

  function isHistory(item={},now=new Date()){
    const end=lifecycleEnd(item);
    return Boolean(end&&end.getTime()<new Date(now).getTime());
  }

  return{parseJstDateTime,hasConfirmedOpenEndedApplication,applicationState,lifecycleEnd,isHistory};
});
