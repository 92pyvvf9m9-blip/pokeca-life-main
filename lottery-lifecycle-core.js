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

  function applicationState(item={},now=new Date()){
    const start=parseJstDateTime(item.applyStartDate||'',item.applyStartTime||'');
    if(start&&start.getTime()>new Date(now).getTime())return 'upcoming';
    if(item.announcedUpcoming===true&&!item.applyStartDate)return 'announced';
    return 'active';
  }

  return{parseJstDateTime,applicationState};
});
