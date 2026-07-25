/* 개인연금 V2.6 · 그래프/연도 전환 최종 안정화 레이어 */
(()=>{
'use strict';
const BUILD='2.6.0';
const N=v=>Number.isFinite(Number(v))?Number(v):0;
const CHART=window.PensionCharts;
if(!CHART)throw new Error('차트 엔진을 불러오지 못했습니다.');
const {compactMoney,axisScale,smoothPath,areaToFloor,areaBetween,interpolatePoint,interpolateX,samplePathY,bindSmoothScrubber,bindDiscreteBarTargets}=CHART;
const THEME_VALUES=new Set(['auto','light','dark']);
const themeMedia=window.matchMedia?.('(prefers-color-scheme: dark)');

/* ---------- profile + theme ---------- */
state.profile=state.profile||{};
state.settings=state.settings||{};
state.meta=state.meta||{};
state.ui=state.ui||{};
if(state.meta.birthYearBasisVersion!=='year-age-v1'){
  const oldAge=N(state.profile.age),storedBirth=N(state.profile.birthYear);
  const ageFromBirth=storedBirth>=1900&&storedBirth<=CURRENT_YEAR?CURRENT_YEAR-storedBirth+1:0;
  if(oldAge>=18&&oldAge<=100&&(!storedBirth||(!state.meta.birthYearConfirmed&&ageFromBirth!==oldAge))){
    state.profile.birthYear=CURRENT_YEAR-oldAge+1;
  }
  state.meta.birthYearBasisVersion='year-age-v1';
}
const currentAge=()=>{
  const birth=N(state.profile?.birthYear);
  return birth>=1900&&birth<=CURRENT_YEAR?Math.max(1,CURRENT_YEAR-birth+1):N(state.profile?.age)||32;
};
function syncAge(){state.profile.age=currentAge()}
function themeMode(){return THEME_VALUES.has(state.settings.theme)?state.settings.theme:'auto'}
function resolvedTheme(mode=themeMode()){return mode==='dark'||(mode==='auto'&&themeMedia?.matches)?'dark':'light'}
function applyTheme(mode=themeMode(),persist=false){
  if(!THEME_VALUES.has(mode))mode='auto';
  state.settings.theme=mode;
  const resolved=resolvedTheme(mode),root=document.documentElement;
  root.dataset.theme=resolved;root.dataset.themeMode=mode;
  const color=resolved==='dark'?'#0d1421':'#f4f7fb';
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content',color);
  const apple=document.querySelector('meta[name="apple-mobile-web-app-status-bar-style"]');
  if(apple)apple.setAttribute('content',resolved==='dark'?'black-translucent':'default');
  if(persist)save();
}
if(themeMedia?.addEventListener)themeMedia.addEventListener('change',()=>{if(themeMode()==='auto')applyTheme('auto')});
else if(themeMedia?.addListener)themeMedia.addListener(()=>{if(themeMode()==='auto')applyTheme('auto')});
function refreshForNewLocalDate(){
  if(localYmd(new Date())===BOOT_LOCAL_DATE)return;
  if(document.querySelector('.overlay.open'))return;
  try{save()}catch(_){ }
  location.reload();
}
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')refreshForNewLocalDate()});
window.addEventListener('focus',refreshForNewLocalDate);
/* 자정을 넘긴 채 앱을 계속 열어 둔 경우에도 연도·월 기준을 새로 로드한다. */
const rolloverTimer=setInterval(refreshForNewLocalDate,60000);
const v23CloseSheet=closeSheet;
closeSheet=function(){
  const result=v23CloseSheet.apply(this,arguments);
  setTimeout(refreshForNewLocalDate,260);
  return result;
};
window.addEventListener('pagehide',()=>clearInterval(rolloverTimer),{once:true});

syncAge();applyTheme();
document.title='개인연금 V2.6';
state.meta.appVersion=BUILD;state.meta.uxBuild='v2.6-graph-rollover-final';
if(!['performance','cashflow','compare'].includes(state.ui.analysisPanel))state.ui.analysisPanel='performance';
if(state.ui.v21CashPeriod==='12m')state.ui.v21CashPeriod='1y';
state.ui.v21CashPeriod=['1y','3y','5y','all'].includes(state.ui.v21CashPeriod)?state.ui.v21CashPeriod:'5y';
state.ui.v21CashMetric=['dividend','realized'].includes(state.ui.v21CashMetric)?state.ui.v21CashMetric:'dividend';
state.ui.v21Scenario=['base','safe','custom'].includes(state.ui.v21Scenario)?state.ui.v21Scenario:'base';

/* Older annual-only data was once placed in December during migration. In the current year,
   a future-month synthetic cash-flow is impossible, so move only those synthetic legacy rows
   to the current month. Real user-entered records are never changed. */
function repairCurrentYearSyntheticCashflow(){
  let changed=false;
  for(const row of state.ledger||[]){
    const month=Number(String(row.monthKey||row.date||'').slice(5,7)),year=Number(String(row.monthKey||row.date||'').slice(0,4));
    const legacy=row.synthetic&&row.source==='v1.1-legacy-adjustment'&&['dividend-adjustment','dividend-account-allocation'].includes(row.type);
    if(!legacy||year!==CURRENT_YEAR||!Number.isFinite(month)||month<=CURRENT_MONTH)continue;
    row.monthKey=CURRENT_KEY;row.year=CURRENT_YEAR;row.date=`${CURRENT_KEY}-28T12:00:00.000Z`;row.updatedAt=new Date().toISOString();changed=true;
  }
  if(changed){state.meta.syntheticCashflowRepair='v2.6-current-month';window.PensionV11Ledger?.rebuild?.()}
}
repairCurrentYearSyntheticCashflow();

/* ---------- data helpers ---------- */
const rowsFor=(scope='all')=>{
  const src=scope==='all'?(state.years||{}):(state.accountYears?.[scope]||{});
  return Object.keys(src).map(Number).filter(Number.isFinite).sort((a,b)=>a-b).map(year=>({year,...src[year]}));
};
const scopeSelect=scope=>`<div class="v21Scope"><span>계좌</span><select id="v21Scope" aria-label="분석 계좌"><option value="all" ${scope==='all'?'selected':''}>전체</option><option value="pension" ${scope==='pension'?'selected':''}>연금저축</option><option value="irp" ${scope==='irp'?'selected':''}>IRP</option></select></div>`;
function bindScope(renderer){
  const s=document.getElementById('v21Scope');
  if(s)s.onchange=()=>{state.ui.analysisScope=s.value;state.ui.v21Point=999;renderer(document.getElementById('analysisContent'));save()};
}
function contributionInfo(){
  const row=state.years?.[CURRENT_YEAR]||{},paid=Math.max(0,N(row.contribution));
  const monthly=N(state.settings.monthly?.pension)+N(state.settings.monthly?.irp),plan=monthly*12,planToDate=monthly*CURRENT_MONTH;
  const status=currentContributionStatus(),planned=['pension','irp'].filter(k=>N(state.settings.monthly?.[k])>0),missing=planned.filter(k=>!status[k]);
  return {paid,monthly,plan,planToDate,pct:plan?clamp(paid/plan*100,0,100):0,onTrackPct:planToDate?paid/planToDate*100:100,missing,status};
}
function freshness(){
  const raw=String(state.lastUpdated||'').trim();if(!raw)return null;
  const d=new Date(raw.replace(/\./g,'-')+'T00:00:00');
  return Number.isNaN(d.getTime())?null:Math.max(0,Math.floor((Date.now()-d.getTime())/86400000));
}
function allocationSnapshot(){
  const totals=classTotals(),total=Object.values(totals).reduce((a,b)=>a+N(b),0)||1;
  const classes=(state.settings.assetClasses||[]).map(c=>({id:c.id,name:c.name,target:N(c.target),current:N(totals[c.id])/total*100})).map(x=>({...x,diff:x.current-x.target}));
  const holdings=['pension','irp'].flatMap(k=>(state.accounts?.[k]?.holdings||[]).map(h=>({...h,account:k}))).sort((a,b)=>N(b.value)-N(a.value));
  return {classes,total,top:holdings[0]||null,topPct:holdings[0]?N(holdings[0].value)/total*100:0};
}
function expectedHistory(rows){
  const annual=Math.max(-.95,N(state.settings.returnRate)/100),rm=Math.pow(1+annual,1/12)-1;
  let expected=rows.length?Math.max(0,N(rows[0].start)):0;
  return rows.map((d,i)=>{
    if(i===0&&expected===0)expected=Math.max(0,N(d.start));
    const months=d.year===CURRENT_YEAR?Math.max(1,CURRENT_MONTH):12;
    const contribution=Math.max(0,N(d.contribution)),monthlyContribution=contribution/months;
    for(let m=0;m<months;m++)expected=(expected+monthlyContribution)*(1+rm);
    return {...d,expected};
  });
}
function trailingDividendSums(){
  const values=[];
  for(let offset=23;offset>=0;offset--){
    const d=new Date(CURRENT_YEAR,CURRENT_MONTH-1-offset,1),row=state.years?.[d.getFullYear()]||{};
    values.push(N(row.monthly?.[d.getMonth()]));
  }
  return {previous:values.slice(0,12).reduce((a,b)=>a+b,0),recent:values.slice(12).reduce((a,b)=>a+b,0)};
}
function aiDecision(){
  const all=expectedHistory(rowsFor('all')),latest=all.at(-1)||{},alloc=allocationSnapshot(),fresh=freshness(),con=contributionInfo(),trailing=trailingDividendSums();
  const actual=N(latest.end),expected=N(latest.expected),deviation=expected?((actual/expected)-1)*100:0,latestReturn=N(latest.return);
  const dividendGrowth=trailing.previous?((trailing.recent/trailing.previous)-1)*100:0;
  if(fresh==null||fresh>60)return {level:'자료 확인',kind:'stale',title:'최신 잔고를 반영한 뒤 판단하세요',reason:`${fresh==null?'마지막 갱신일을 확인할 수 없습니다':`마지막 갱신이 ${fresh}일 전입니다`}. 오래된 보유내역과 비중으로 매매 결정을 내리면 현재 상태와 다를 수 있습니다.`,action:'자산현황 갱신'};
  if(alloc.topPct>=42)return {level:'집중 주의',kind:'concentration',title:'상위 종목 추가매수는 한 번 더 확인하세요',reason:`${alloc.top?.name||'상위 종목'}이 전체 개인연금의 ${alloc.topPct.toFixed(1)}%입니다. 기존 보유분을 급히 매도하기보다 다음 납입을 부족 자산군에 배분하는 방식이 더 단순합니다.`,action:'다음 납입을 부족 자산군에 배분'};
  if(dividendGrowth>=25&&latestReturn<0)return {level:'착시 주의',kind:'income',title:'분배금 증가와 총수익을 따로 보세요',reason:`최근 12개월 분배금은 이전 12개월보다 ${dividendGrowth.toFixed(0)}% 늘었지만 기록된 최근 투자수익률은 ${pct(latestReturn)}입니다. 현금흐름 증가만으로 운용 성과가 좋아졌다고 판단할 수 없습니다.`,action:'분배금보다 총수익 먼저 확인'};
  if(deviation>=15&&latestReturn>0)return {level:'기대치 주의',kind:'hot',title:'좋은 성과를 장기 기대수익률로 올리지 마세요',reason:`현재 자산은 실제 납입액에 설정 수익률을 적용한 기대경로보다 ${deviation.toFixed(1)}% 앞서 있습니다. 이는 실시간 시장 과열 판단이 아니라 계획 대비 성과 점검입니다.`,action:'장기 기대수익률은 그대로 유지'};
  if(deviation<=-15&&latestReturn<0)return {level:'매도 주의',kind:'cold',title:'손실률만으로 전량 매도하지 마세요',reason:`현재 자산은 기대경로보다 ${Math.abs(deviation).toFixed(1)}% 뒤에 있습니다. 납입 중단, 자산 집중, 투자 전제 변화가 있었는지 먼저 확인해야 합니다.`,action:'원인 확인 후 계획 유지 여부 판단'};
  if(con.planToDate>0&&con.onTrackPct<75&&CURRENT_MONTH>=3)return {level:'계획 이탈',kind:'stale',title:'투자판단보다 납입 계획부터 확인하세요',reason:`${CURRENT_MONTH}월까지 계획 납입은 ${man(con.planToDate)}인데 실제 기록은 ${man(con.paid)}입니다. 일시적인 지연인지 계획 자체가 바뀐 것인지 먼저 구분하는 편이 정확합니다.`,action:'월 납입 계획 재확인'};
  return {level:'특이사항 없음',kind:'ok',title:'현재 기록에서 즉시 바꿀 신호는 없습니다',reason:'기대경로, 납입, 목표 비중, 거래 기록에서 즉시 매매를 요구할 뚜렷한 신호가 없습니다. 실시간 시세의 급등·급락을 판단한 결과는 아닙니다.',action:'현재 계획 유지'};
}

/* ---------- chart helpers: charts.js 공통 엔진 사용 ---------- */

function triplePosition(id,chart,raw){
  const x=interpolateX(chart.pts,raw),fallback=interpolatePoint(chart.pts,raw),sel=document.getElementById(id+'Sel');
  if(sel){sel.setAttribute('x1',x);sel.setAttribute('x2',x)}
  const series=[['A','ActualPath','actual'],['E','ExpectedPath','expected'],['C','ContribPath','contrib']];
  for(const [suffix,pathSuffix,key] of series){
    const dot=document.getElementById(id+suffix);if(!dot)continue;
    dot.setAttribute('cx',x);dot.setAttribute('cy',samplePathY(id+pathSuffix,x,fallback[key]));
  }
}
function buildTripleChart(data,id){
  const W=640,H=270,p={l:58,r:18,t:18,b:34},scale=axisScale(data.flatMap(d=>[N(d.end),N(d.expected),N(d.cumulative)]),4,true),floor=H-p.b;
  const x=i=>p.l+(W-p.l-p.r)*(data.length<=1?.5:i/(data.length-1)),y=v=>p.t+(H-p.t-p.b)*(1-(N(v)-scale.min)/(scale.max-scale.min));
  const pts=data.map((d,i)=>({x:x(i),actual:y(d.end),expected:y(d.expected),contrib:y(d.cumulative)}));
  const ticks=scale.ticks.map(v=>{const yy=y(v);return `<line x1="${p.l}" x2="${W-p.r}" y1="${yy}" y2="${yy}" class="v21Grid"/><text x="${p.l-7}" y="${yy+4}" text-anchor="end" class="v21Axis">${compactMoney(v)}</text>`}).join('');
  const labelIdx=[0,Math.round((data.length-1)/2),data.length-1].filter((v,i,a)=>v>=0&&a.indexOf(v)===i),labels=labelIdx.map(i=>`<text x="${x(i)}" y="${H-8}" text-anchor="middle" class="v21Axis">${data[i].year}</text>`).join('');
  const contribPts=pts.map(q=>({x:q.x,y:q.contrib})),expectedPts=pts.map(q=>({x:q.x,y:q.expected})),actualPts=pts.map(q=>({x:q.x,y:q.actual}));
  return {pts,svg:`<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none"><defs><linearGradient id="${id}Fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#aab7c7" stop-opacity=".22"/><stop offset="1" stop-color="#aab7c7" stop-opacity=".04"/></linearGradient></defs>${ticks}${labels}<path d="${areaToFloor(contribPts,floor)}" fill="url(#${id}Fill)"/><path id="${id}ContribPath" d="${smoothPath(contribPts)}" class="v21Line v21Contrib"/><path id="${id}ExpectedPath" d="${smoothPath(expectedPts)}" class="v21Line v21Expected"/><path id="${id}ActualPath" d="${smoothPath(actualPts)}" class="v21Line v21Actual"/><line id="${id}Sel" class="v21Select" y1="${p.t}" y2="${H-p.b}"/><circle id="${id}A" class="v21Dot actual" r="6"/><circle id="${id}E" class="v21Dot expected" r="5"/><circle id="${id}C" class="v21Dot contrib" r="5"/><rect id="${id}Hit" class="v21Hit" x="${p.l}" y="${p.t}" width="${W-p.l-p.r}" height="${H-p.t-p.b}"/></svg>`};
}

/* ---------- home ---------- */
function renderV21Home(){
  syncAge();
  const total=totalAsset(),principal=totalPrincipal(),profit=total-principal,ret=principal?profit/principal*100:0,con=contributionInfo(),goal=goalStatus(),ai=aiDecision(),fresh=freshness();
  const aiHtml=ai.kind==='ok'?`<button class="v21AiCompact" id="v21Ai"><span><b>AI 코치</b><small>${esc(ai.title)}</small></span><i>›</i></button>`:`<button class="v21AiAlert ${ai.kind}" id="v21Ai"><div><span>AI 코치 · ${esc(ai.level)}</span><h3>${esc(ai.title)}</h3><p>${esc(ai.reason)}</p></div><b>${esc(ai.action)} ›</b></button>`;
  document.getElementById('home').innerHTML=`<div class="stack v21Home"><section class="card v21Hero v21HeroFixed"><div class="v21HeroMain"><div><span>개인연금 총자산</span><strong>${man(total)}</strong><small class="${profit>=0?'good':'bad'}">투자손익 ${profit>=0?'+':''}${man(profit)} · ${pct(ret)}</small></div><div><small>마지막 갱신</small><b>${fresh==null?'확인 필요':fresh===0?'오늘':`${fresh}일 전`}</b><button class="v21AccountLink" id="v21AccountLink">계좌별 보기</button></div></div><div class="v21Exact">정확한 금액 ${fmt(total)} · 누적 순납입 ${fmt(principal)}</div></section><div class="v21HomeGrid"><button class="card v21Mini" id="v21Contribution"><span>${CURRENT_YEAR}년 납입</span><strong>${man(con.paid)}</strong><div class="v21Progress"><i style="width:${con.pct}%"></i></div><small>${Math.round(con.pct)}% 완료 · 계획 ${man(con.plan)}</small></button><button class="card v21Mini" id="v21Future"><span>${state.profile.retirementAge}세 예상 월연금</span><strong>${man(goal.real)}</strong><small>${goal.real>=N(state.settings.goalMonthly)?'목표 달성권':'목표보다 '+man(Math.max(0,N(state.settings.goalMonthly)-goal.real))+' 부족'} · 자세히 ›</small></button></div>${aiHtml}<div class="v21Quick"><button id="v21Pay">이번 달 납입</button><button id="v21Snap">자산 갱신</button></div></div>`;
  document.getElementById('v21AccountLink').onclick=()=>navigate('account');
  document.getElementById('v21Contribution').onclick=()=>quickForm('contribution');
  document.getElementById('v21Future').onclick=()=>{scrollPos.future=0;navigate('future')};
  document.getElementById('v21Pay').onclick=()=>quickForm('contribution');
  document.getElementById('v21Snap').onclick=()=>quickForm('snapshot');
  document.getElementById('v21Ai').onclick=()=>{state.ui.analysisPanel='compare';scrollPos.analysis=0;navigate('analysis');renderAnalysis();save()};
}

/* ---------- performance ---------- */
function renderPerformance21(el){
  const scope=['all','pension','irp'].includes(state.ui.analysisScope)?state.ui.analysisScope:'all',rows=expectedHistory(rowsFor(scope));
  if(!rows.length){el.innerHTML=scopeSelect(scope)+`<div class="card empty"><b>성과 기록이 없어요</b><p>과거 연도와 현재 자산을 입력하면 생성됩니다.</p></div>`;bindScope(renderPerformance21);return}
  let idx=clamp(Number.isFinite(Number(state.ui.v21Point))?Number(state.ui.v21Point):rows.length-1,0,rows.length-1),lastCard=-1;const chart=buildTripleChart(rows,'v21Perf');
  el.innerHTML=`${scopeSelect(scope)}<div class="stack"><section class="card v21ChartCard"><div class="v21ChartHead"><div><h2>실제 · 기대 · 순납입</h2><p>실제 납입액은 그대로 두고 설정 수익률을 적용한 기대경로와 비교합니다.</p></div></div><div class="v21Legend"><span><i class="actual"></i>실제자산</span><span><i class="expected"></i>기대경로</span><span><i class="contrib"></i>누적 순납입</span></div><div class="v21Chart">${chart.svg}</div><div class="v21PointCard" id="v21PerfPoint"><div><span id="v21PerfLabel"></span><strong id="v21PerfValue"></strong></div><div class="v21PointGrid"><span>기대경로 <b id="v21PerfExpected"></b></span><span>누적 순납입 <b id="v21PerfContrib"></b></span><span>기대 대비 <b id="v21PerfVs"></b></span><span>누적 투자손익 <b id="v21PerfProfit"></b></span></div></div></section><details class="card v21Details"><summary>연도별 표 보기</summary><div class="v21TableWrap"><table><thead><tr><th>연도</th><th>실제</th><th>기대</th><th>순납입</th></tr></thead><tbody>${rows.slice().reverse().map(r=>`<tr><td>${r.year}</td><td>${man(r.end)}</td><td>${man(r.expected)}</td><td>${man(r.cumulative)}</td></tr>`).join('')}</tbody></table></div></details></div>`;
  const perfRefs={label:document.getElementById('v21PerfLabel'),value:document.getElementById('v21PerfValue'),expected:document.getElementById('v21PerfExpected'),contrib:document.getElementById('v21PerfContrib'),vs:document.getElementById('v21PerfVs'),profit:document.getElementById('v21PerfProfit')};
  const renderCard=i=>{if(i===lastCard)return;lastCard=i;idx=i;state.ui.v21Point=i;const d=rows[i],vs=N(d.end)-N(d.expected),profit=N(d.end)-N(d.cumulative);perfRefs.label.textContent=`${d.year}년 실제자산`;perfRefs.value.textContent=man(d.end);perfRefs.expected.textContent=man(d.expected);perfRefs.contrib.textContent=man(d.cumulative);perfRefs.vs.textContent=`${vs>=0?'+':''}${man(vs)}`;perfRefs.vs.className=vs>=0?'good':'bad';perfRefs.profit.textContent=`${profit>=0?'+':''}${man(profit)}`;perfRefs.profit.className=profit>=0?'good':'bad'};
  renderCard(idx);triplePosition('v21Perf',chart,idx);
  bindSmoothScrubber('v21PerfHit',rows.length,{initialRaw:idx,position:raw=>triplePosition('v21Perf',chart,raw),index:renderCard,commit:i=>{state.ui.v21Point=i;save()}});bindScope(renderPerformance21);
}

/* ---------- cashflow ---------- */
function ledgerMonthlyRealized(scope='all'){
  const map={};
  for(const r of state.ledger||[]){
    if(r?.status==='void'||!['sell','realized-adjustment'].includes(r?.type))continue;
    const key=r.monthKey||String(r.date||'').slice(0,7),account=r.accountKey||(['pension','irp'].find(k=>r.accountId===`account-${k}`)||'');
    if(!/^\d{4}-\d{2}$/.test(key)||scope!=='all'&&account!==scope)continue;
    map[key]=(map[key]||0)+N(r.amount);
  }
  return map;
}
function rowForYear(scope,year){return (scope==='all'?state.years?.[year]:state.accountYears?.[scope]?.[year])||{}}
function calendarYearMonths(scope='all',year=CURRENT_YEAR){
  const realized=ledgerMonthlyRealized(scope),row=rowForYear(scope,year),monthly=Array.isArray(row.monthly)?row.monthly:[];
  return Array.from({length:12},(_,i)=>{const month=i+1,key=`${year}-${String(month).padStart(2,'0')}`;return {key,year,month,label:`${month}월`,full:`${year}.${String(month).padStart(2,'0')}`,dividend:N(monthly[i]),realized:N(realized[key])}})
}
function calendarYearRows(scope='all',count=3){
  const realized=ledgerMonthlyRealized(scope),first=CURRENT_YEAR-count+1,out=[];
  for(let year=first;year<=CURRENT_YEAR;year++){
    const row=rowForYear(scope,year);let realizedValue=N(row.realized);
    const fromLedger=Object.entries(realized).filter(([key])=>key.startsWith(`${year}-`)).reduce((sum,[,value])=>sum+N(value),0);
    if(fromLedger||!realizedValue)realizedValue=fromLedger;
    out.push({label:String(year),full:`${year}년`,year,dividend:N(row.dividend),realized:realizedValue});
  }
  return out;
}
function allCalendarYears(scope='all'){
  const rowYears=Object.keys(scope==='all'?(state.years||{}):(state.accountYears?.[scope]||{})).map(Number).filter(Number.isFinite),ledgerYears=Object.keys(ledgerMonthlyRealized(scope)).map(k=>Number(k.slice(0,4))).filter(Number.isFinite),first=Math.min(CURRENT_YEAR,...rowYears,...ledgerYears);
  return calendarYearRows(scope,CURRENT_YEAR-first+1);
}
function cashData(period,scope){
  if(period==='1y')return calendarYearMonths(scope,CURRENT_YEAR);
  if(period==='3y')return calendarYearRows(scope,3);
  if(period==='5y')return calendarYearRows(scope,5);
  return allCalendarYears(scope);
}
function cashPeriodMeta(period){return period==='1y'?{average:'월평균',peak:'최대 월'}:{average:'연평균',peak:'최대 연도'}}
function buildCashChart(data,id,metric){
  const W=640,H=220,p={l:58,r:18,t:18,b:36},values=data.map(d=>N(d[metric])),scale=axisScale(values,4,true),plotW=W-p.l-p.r,slot=plotW/Math.max(1,data.length),bar=Math.max(10,Math.min(periodBarWidth(data.length),slot*.46));
  const x=i=>p.l+slot*(i+.5),y=v=>p.t+(H-p.t-p.b)*(1-(N(v)-scale.min)/(scale.max-scale.min)),zero=y(0),pts=data.map((d,i)=>({x:x(i),value:y(d[metric]),raw:N(d[metric])}));
  const bars=pts.map((q,i)=>{
    if(q.raw===0)return '';
    const h=Math.abs(zero-q.value),visible=Math.max(2,h),yy=q.raw>0?zero-visible:zero,hitWidth=Math.max(bar+14,Math.min(slot*.82,64));
    return `<rect x="${q.x-bar/2}" y="${yy}" width="${bar}" height="${visible}" rx="${Math.min(8,bar/2)}" class="v21CashBar" data-bar-index="${i}"/><rect x="${q.x-hitWidth/2}" y="${p.t}" width="${hitWidth}" height="${H-p.t-p.b}" class="v21CashBarHit" data-bar-hit-index="${i}" aria-label="${esc(data[i].full)} ${man(q.raw)}"/>`;
  }).join('');
  const labels=data.map((d,i)=>{
    const show=data.length<=12||i===0||i===data.length-1||i%Math.ceil(data.length/6)===0;
    return show?`<text x="${x(i)}" y="${H-8}" text-anchor="middle" class="v21Axis v21CashAxis">${d.label}</text>`:''
  }).join('');
  const guides=scale.ticks.map(v=>{const yy=y(v);return `<line x1="${p.l}" x2="${W-p.r}" y1="${yy}" y2="${yy}" class="v21Grid"/><text x="${p.l-7}" y="${yy+4}" text-anchor="end" class="v21Axis">${compactMoney(v)}</text>`}).join('');
  return {pts,svg:`<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">${guides}<line x1="${p.l}" x2="${W-p.r}" y1="${zero}" y2="${zero}" class="v21CashBase"/>${bars}${labels}</svg>`};
}
function periodBarWidth(length){return length<=3?30:length<=5?26:length<=12?18:14}
function renderCashflow21(el){
  const scope=['all','pension','irp'].includes(state.ui.analysisScope)?state.ui.analysisScope:'all',period=state.ui.v21CashPeriod,metric=state.ui.v21CashMetric,data=cashData(period,scope),chart=buildCashChart(data,'v21Cash',metric),meta=cashPeriodMeta(period);
  const values=data.map(d=>N(d[metric])),nonZero=values.map((v,i)=>v!==0?i:-1).filter(i=>i>=0),requested=Number(state.ui.v21CashPoint);
  let idx=Number.isFinite(requested)&&requested>=0&&requested<data.length&&values[requested]!==0?Math.round(requested):(nonZero.at(-1)??Math.max(0,data.length-1)),lastCard=-1;
  const total=values.reduce((a,b)=>a+b,0),average=data.length?total/data.length:0,peak=values.length?values.reduce((best,v)=>Math.abs(v)>Math.abs(best)?v:best,0):0,metricName=metric==='dividend'?'배당·분배금':'매도손익';
  el.innerHTML=`${scopeSelect(scope)}<div class="v21Period"><button data-period="1y" class="${period==='1y'?'active':''}">1년</button><button data-period="3y" class="${period==='3y'?'active':''}">3년</button><button data-period="5y" class="${period==='5y'?'active':''}">5년</button><button data-period="all" class="${period==='all'?'active':''}">전체</button></div><section class="card v21ChartCard v21CashCard"><div class="v21ChartHead v21CashHead"><div><h2>현금흐름</h2><p>기간과 항목을 바꿔 수익 흐름을 확인하세요.</p></div><div class="v21MetricToggle"><button data-cash-metric="dividend" class="${metric==='dividend'?'active':''}">배당·분배금</button><button data-cash-metric="realized" class="${metric==='realized'?'active':''}">매도손익</button></div></div><div class="v21CashSummary"><div><span>${metricName} 합계</span><strong class="${metric==='realized'&&total<0?'bad':''}">${total>=0?'+':''}${man(total)}</strong></div><div><span>${meta.average}</span><b>${average>=0?'':'-'}${man(Math.abs(average))}</b></div><div><span>${meta.peak}</span><b class="${metric==='realized'&&peak<0?'bad':''}">${peak>=0?'+':''}${man(peak)}</b></div></div><div class="v21Chart v21CashChart">${chart.svg}</div><div class="v21PointCard v21CashPoint" id="v21CashPoint"></div><div class="v21CashNote">배당·분배금은 보유 중 받은 소득, 매도손익은 매도 시 확정된 손익입니다. 재투자는 별도 매수로 기록합니다.</div></section>`;
  const renderCard=i=>{if(i===lastCard)return;lastCard=i;idx=i;state.ui.v21CashPoint=i;const d=data[i],value=N(d[metric]);document.querySelectorAll('[data-bar-index]').forEach(bar=>bar.classList.toggle('selected',Number(bar.dataset.barIndex)===i));document.getElementById('v21CashPoint').innerHTML=`<div><span>${d.full}</span><strong class="${metric==='realized'&&value<0?'bad':''}">${value>=0?'+':''}${man(value)}</strong></div><div class="v21PointGrid"><span>배당·분배금 <b>${man(d.dividend)}</b></span><span>매도손익 <b class="${d.realized>=0?'good':'bad'}">${d.realized>=0?'+':''}${man(d.realized)}</b></span></div>`};
  renderCard(idx);
  bindDiscreteBarTargets('[data-bar-hit-index]',{initialIndex:idx,select:renderCard,commit:i=>{state.ui.v21CashPoint=i;save()}});bindScope(renderCashflow21);
  document.querySelectorAll('[data-period]').forEach(b=>b.onclick=()=>{state.ui.v21CashPeriod=b.dataset.period;state.ui.v21CashPoint=999;renderCashflow21(el);save()});
  document.querySelectorAll('[data-cash-metric]').forEach(b=>b.onclick=()=>{state.ui.v21CashMetric=b.dataset.cashMetric;state.ui.v21CashPoint=999;renderCashflow21(el);save()});
}

/* ---------- plan check ---------- */
function renderCompare21(el){
  const rows=expectedHistory(rowsFor('all')),latest=rows.at(-1)||{},expected=N(latest.expected),actual=N(latest.end),gap=actual-expected,con=contributionInfo(),alloc=allocationSnapshot(),ai=aiDecision();
  const classes=[...alloc.classes].filter(c=>c.target>0||c.current>0).sort((a,b)=>Math.abs(b.diff)-Math.abs(a.diff)).slice(0,5),basisRate=N(state.settings.returnRate),monthLabel=`${CURRENT_MONTH}월까지 계획`;
  const aiBody=ai.kind==='ok'?`<section class="card v21AiPanel compact ${ai.kind}"><div class="v21AiHead"><span>AI 코치</span><em>자동 점검</em></div><div class="v21AiCompactResult"><div><h2>${esc(ai.title)}</h2><p>${esc(ai.reason)}</p></div><b>${esc(ai.action)}</b></div><div class="v21AiCriteria"><span>기대경로</span><span>납입</span><span>목표 비중</span><span>거래 기록</span></div><button class="btn light full" id="v21Ask">이 판단을 AI에게 묻기</button></section>`:`<section class="card v21AiPanel ${ai.kind}"><div class="v21AiHead"><span>AI 코치</span><em>자동 점검 · ${esc(ai.level)}</em></div><h2>${esc(ai.title)}</h2><p>${esc(ai.reason)}</p><div class="v21AiAction"><small>권장 행동</small><b>${esc(ai.action)}</b></div><div class="v21AiCriteria"><span>기대경로</span><span>납입</span><span>목표 비중</span><span>거래 기록</span></div><button class="btn light full" id="v21Ask">이 판단을 AI에게 묻기</button></section>`;
  el.innerHTML=`<div class="stack"><section class="card v21CompareHero"><div class="v21ChartHead"><div><h2>계획대로 가고 있나</h2><p>실제 납입액을 같은 시점에 넣고 연 ${basisRate.toFixed(1)}% 기대수익률을 적용한 경로와 비교합니다.</p></div></div><div class="v21CompareKpis"><div><span>실제자산</span><b>${man(actual)}</b></div><div><span>기대경로</span><b>${man(expected)}</b></div><div><span>차이</span><b class="${gap>=0?'good':'bad'}">${gap>=0?'+':''}${man(gap)}</b></div></div></section><section class="card v21CompareCombined"><div class="v21CompareBlock"><div class="sectionTitle">납입 계획</div><div class="v21CompareRows"><div><span>연간 계획</span><b>${man(con.plan)}</b></div><div><span>실제 기록</span><b>${man(con.paid)}</b></div><div><span>남은 금액</span><b>${man(Math.max(0,con.plan-con.paid))}</b></div></div><div class="v21PlanStatus ${con.onTrackPct>=90?'goodState':'warnState'}"><span>${monthLabel} ${man(con.planToDate)}</span><b>${con.onTrackPct>=90?'현재 일정에 맞음':`${man(Math.max(0,con.planToDate-con.paid))} 늦음`}</b></div></div><div class="v21CompareDivider"></div><div class="v21CompareBlock"><div class="sectionTitle">목표 비중과 현재 비중</div><div class="v21Alloc">${classes.map(c=>`<div><div class="v21AllocTitle"><span>${esc(c.name)}</span><b>현재 ${c.current.toFixed(1)}% / 목표 ${c.target.toFixed(0)}%</b></div><div><i style="width:${clamp(c.current,0,100)}%"></i><em style="left:${clamp(c.target,0,100)}%"></em></div><small class="${Math.abs(c.diff)<=3?'':c.diff>0?'bad':'good'}">목표보다 ${Math.abs(c.diff).toFixed(1)}%p ${c.diff>0?'높음':c.diff<0?'낮음':'동일'}</small></div>`).join('')}</div></div></section>${aiBody}<div class="v21AiNote standalone">현재 자동 점검은 앱에 저장된 데이터만 사용합니다. 자유질문형 AI는 인증된 클라우드 연결 후 활성화됩니다.</div></div>`;
  document.getElementById('v21Ask').onclick=()=>toast('AI 자유질문은 클라우드 연결 단계에서 활성화됩니다');
}

renderAnalysis=function(){
  if(!['performance','cashflow','compare'].includes(state.ui.analysisPanel))state.ui.analysisPanel='performance';
  const cls=state.ui.analysisPanel==='cashflow'?'i1':state.ui.analysisPanel==='compare'?'i2':'';
  document.getElementById('analysis').innerHTML=`<div class="segment three v21Tabs"><i class="segmentIndicator ${cls}"></i><button data-v21-tab="performance" class="${state.ui.analysisPanel==='performance'?'active':''}">성과</button><button data-v21-tab="cashflow" class="${state.ui.analysisPanel==='cashflow'?'active':''}">현금흐름</button><button data-v21-tab="compare" class="${state.ui.analysisPanel==='compare'?'active':''}">계획점검</button></div><div id="analysisContent"></div>`;
  document.querySelectorAll('[data-v21-tab]').forEach(b=>b.onclick=()=>{state.ui.analysisPanel=b.dataset.v21Tab;renderAnalysis();save()});renderAnalysisContent();
};
renderAnalysisContent=function(){const el=document.getElementById('analysisContent');if(state.ui.analysisPanel==='performance')renderPerformance21(el);else if(state.ui.analysisPanel==='cashflow')renderCashflow21(el);else renderCompare21(el)};

/* ---------- future ---------- */
function futureCustom(){
  const currentMonthly=N(state.settings.monthly.pension)+N(state.settings.monthly.irp),c=state.ui.v21Custom||{};
  return {monthly:Number.isFinite(Number(c.monthly))?Math.max(0,Number(c.monthly)):currentMonthly,rate:Number.isFinite(Number(c.rate))?Number(c.rate):N(state.settings.returnRate),retAge:N(c.retAge)||N(state.profile.retirementAge),name:'내 가정'};
}
function scenarioProjection(key){
  const age=currentAge(),custom=futureCustom(),cfg={base:{name:'기준',rate:N(state.settings.returnRate),monthly:N(state.settings.monthly.pension)+N(state.settings.monthly.irp),retAge:N(state.profile.retirementAge)},safe:{name:'보수적',rate:Math.max(0,N(state.settings.returnRate)-2),monthly:N(state.settings.monthly.pension)+N(state.settings.monthly.irp),retAge:N(state.profile.retirementAge)},custom}[key];
  const c=cfg||cfg.base,years=Math.max(0,c.retAge-age),rm=Math.pow(1+c.rate/100,1/12)-1;let bal=totalAsset(),cum=totalPrincipal();const out=[{age,end:bal,cumulative:cum,operating:bal-cum}];
  for(let i=0;i<years;i++){for(let m=0;m<12;m++){bal*=1+rm;bal+=c.monthly}cum+=c.monthly*12;out.push({age:age+i+1,end:bal,cumulative:cum,operating:bal-cum})}return {cfg:c,data:out};
}
function buildFutureAreaChart(data,id){
  const W=640,H=240,p={l:58,r:18,t:18,b:34},scale=axisScale(data.flatMap(d=>[N(d.end),N(d.cumulative)]),4,true),floor=H-p.b;
  const x=i=>p.l+(W-p.l-p.r)*(data.length<=1?.5:i/(data.length-1)),y=v=>p.t+(H-p.t-p.b)*(1-(N(v)-scale.min)/(scale.max-scale.min));
  const pts=data.map((d,i)=>({x:x(i),total:y(d.end),contrib:y(d.cumulative),age:d.age})),totalPts=pts.map(q=>({x:q.x,y:q.total})),contribPts=pts.map(q=>({x:q.x,y:q.contrib})),totalLine=smoothPath(totalPts),contribLine=smoothPath(contribPts);
  const contributionArea=areaToFloor(contribPts,floor),growthArea=areaBetween(totalPts,contribPts);
  const ticks=scale.ticks.map(v=>{const yy=y(v);return `<line x1="${p.l}" x2="${W-p.r}" y1="${yy}" y2="${yy}" class="v21Grid"/><text x="${p.l-7}" y="${yy+4}" text-anchor="end" class="v21Axis">${compactMoney(v)}</text>`}).join('');
  const labelIdx=[0,Math.round((data.length-1)/2),data.length-1].filter((v,i,a)=>a.indexOf(v)===i),labels=labelIdx.map(i=>`<text x="${x(i)}" y="${H-8}" text-anchor="middle" class="v21Axis">${data[i].age}세</text>`).join('');
  const milestones=pts.filter((q,i)=>i===0||i===pts.length-1||q.age%5===0).map(q=>`<circle cx="${q.x}" cy="${q.total}" r="3.5" class="v21Milestone"/>`).join('');
  return {pts,svg:`<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none"><defs><linearGradient id="${id}Growth" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2f87ea" stop-opacity=".34"/><stop offset="1" stop-color="#2f87ea" stop-opacity=".07"/></linearGradient></defs>${ticks}${labels}<path d="${contributionArea}" class="v21FutureContribArea"/><path d="${growthArea}" fill="url(#${id}Growth)"/><path id="${id}ContribPath" d="${contribLine}" class="v21Line v21Contrib"/><path id="${id}ActualPath" d="${totalLine}" class="v21Line v21Actual"/>${milestones}<line id="${id}Sel" class="v21Select" y1="${p.t}" y2="${floor}"/><circle id="${id}A" class="v21Dot actual" r="6"/><circle id="${id}C" class="v21Dot contrib" r="5"/><rect id="${id}Hit" class="v21Hit" x="${p.l}" y="${p.t}" width="${W-p.l-p.r}" height="${H-p.t-p.b}"/></svg>`};
}
function futurePosition(id,chart,raw){const x=interpolateX(chart.pts,raw),fallback=interpolatePoint(chart.pts,raw),sel=document.getElementById(id+'Sel'),a=document.getElementById(id+'A'),c=document.getElementById(id+'C');if(sel){sel.setAttribute('x1',x);sel.setAttribute('x2',x)}if(a){a.setAttribute('cx',x);a.setAttribute('cy',samplePathY(id+'ActualPath',x,fallback.total))}if(c){c.setAttribute('cx',x);c.setAttribute('cy',samplePathY(id+'ContribPath',x,fallback.contrib))}}
function openFutureEditor(){
  const c=futureCustom();document.getElementById('formTitle').textContent='내 가정 설정';document.getElementById('formBody').innerHTML=`<div class="sheetNotice">기본 계획은 그대로 두고 비교용 가정만 만듭니다.</div><div class="field"><label>월 납입액</label><input id="v21CustomMonthly" inputmode="numeric" value="${Number(c.monthly).toLocaleString('ko-KR')}"></div><div class="twoFields"><div class="field"><label>기대수익률</label><input id="v21CustomRate" type="number" step="0.1" value="${c.rate}"></div><div class="field"><label>연금 개시 나이</label><input id="v21CustomRet" type="number" value="${c.retAge}"></div></div><button class="btn primary full" id="v21CustomSave" style="margin-top:16px">비교 가정 적용</button>`;openSheet('formSheet');
  const monthly=document.getElementById('v21CustomMonthly');monthly.onblur=()=>{const n=parseMoney(monthly.value);monthly.value=n?Number(n).toLocaleString('ko-KR'):''};
  document.getElementById('v21CustomSave').onclick=()=>{const m=parseMoney(monthly.value),rate=N(document.getElementById('v21CustomRate').value),ret=N(document.getElementById('v21CustomRet').value);if(m<0||rate<0||rate>20||ret<=currentAge()||ret>80){toast('가정 값을 확인하세요');return}state.ui.v21Custom={monthly:m,rate,retAge:ret};state.ui.v21Scenario='custom';state.ui.futureAge=ret;closeSheet('formSheet');renderFutureContent();save()};
}
renderFuture=function(){document.getElementById('future').innerHTML='<div id="futureContent"></div>';renderFutureContent()};
renderFutureContent=function(){
  const key=['base','safe','custom'].includes(state.ui.v21Scenario)?state.ui.v21Scenario:'base',pack=scenarioProjection(key),data=pack.data,final=data.at(-1),sim=withdrawalSim(final.end,'balanced'),monthly=presentValueMonthly(sim.startMonthly),goal=N(state.settings.goalMonthly),gap=monthly-goal;let idx=data.findIndex(d=>d.age===N(state.ui.futureAge));if(idx<0)idx=data.length-1;let lastCard=-1;const chart=buildFutureAreaChart(data,'v21Future');
  document.getElementById('futureContent').innerHTML=`<div class="v21Scenario"><button data-scenario="base" class="${key==='base'?'active':''}">기준</button><button data-scenario="safe" class="${key==='safe'?'active':''}">보수적</button><button data-scenario="custom" class="${key==='custom'?'active':''}">내 가정</button></div><div class="stack"><section class="card v21FutureSummary"><div class="v21FutureTop"><div><span>${pack.cfg.retAge}세 예상자산</span><strong>${man(final.end)}</strong></div>${key==='custom'?'<button class="v21EditChip" id="v21EditCustom">가정 편집</button>':''}</div><div class="v21FutureKpi"><span>예상 월연금 <b>${man(monthly)}</b></span><span>${gap>=0?'목표보다':'목표까지'} <b class="${gap>=0?'good':'bad'}">${man(Math.abs(gap))}${gap>=0?' 여유':' 부족'}</b></span></div><small>오늘 돈 가치 · ${state.settings.withdrawYears}년 수령 가정 · 국민연금·세금·수수료 제외</small></section><section class="card v21ChartCard v21FutureCard"><div class="v21ChartHead"><div><h2>${pack.cfg.name} 자산 경로</h2><p>회색은 누적 순납입, 파란 영역은 예상 운용수익입니다.</p></div></div><div class="v21Legend"><span><i class="actual"></i>예상자산</span><span><i class="contrib"></i>누적 순납입</span></div><div class="v21Chart v21FutureGraph">${chart.svg}</div><div class="v21PointCard" id="v21FuturePoint"><div><span id="v21FutureLabel"></span><strong id="v21FutureValue"></strong></div><div class="v21PointGrid"><span>누적 순납입 <b id="v21FutureContrib"></b></span><span>예상 운용수익 <b id="v21FutureProfit"></b></span></div></div></section><button class="btn light full" id="v21Settings">기본 계획 설정</button></div>`;
  const futureRefs={label:document.getElementById('v21FutureLabel'),value:document.getElementById('v21FutureValue'),contrib:document.getElementById('v21FutureContrib'),profit:document.getElementById('v21FutureProfit')};
  const renderCard=i=>{if(i===lastCard)return;lastCard=i;idx=i;state.ui.futureAge=data[i].age;const d=data[i],profit=N(d.end)-N(d.cumulative);futureRefs.label.textContent=`${d.age}세 예상자산`;futureRefs.value.textContent=man(d.end);futureRefs.contrib.textContent=man(d.cumulative);futureRefs.profit.textContent=`${profit>=0?'+':''}${man(profit)}`;futureRefs.profit.className=profit>=0?'good':'bad'};
  renderCard(idx);futurePosition('v21Future',chart,idx);
  bindSmoothScrubber('v21FutureHit',data.length,{initialRaw:idx,position:raw=>futurePosition('v21Future',chart,raw),index:renderCard,commit:i=>{state.ui.futureAge=data[i].age;save()}});
  document.querySelectorAll('[data-scenario]').forEach(b=>b.onclick=()=>{if(b.dataset.scenario==='custom'&&!state.ui.v21Custom){openFutureEditor();return}state.ui.v21Scenario=b.dataset.scenario;state.ui.futureAge=scenarioProjection(b.dataset.scenario).cfg.retAge;renderFutureContent();save()});
  document.getElementById('v21EditCustom')?.addEventListener('click',openFutureEditor);
  document.getElementById('v21Settings').onclick=()=>{renderSettings();openSheet('settingsSheet')};
};

/* ---------- monthly summary ---------- */
function upsertMonthlySummary(){
  state.extensions=state.extensions||{};const list=Array.isArray(state.extensions.monthlySummaries)?state.extensions.monthlySummaries:[],alloc=allocationSnapshot();
  const summary={month:CURRENT_KEY,updatedAt:new Date().toISOString(),totalAsset:Math.round(totalAsset()),pensionAsset:Math.round(accountTotal(state.accounts.pension)),irpAsset:Math.round(accountTotal(state.accounts.irp)),cumulativePrincipal:Math.round(totalPrincipal()),investmentProfit:Math.round(totalAsset()-totalPrincipal()),topHoldingPct:Number(alloc.topPct.toFixed(2)),allocation:Object.fromEntries(alloc.classes.map(x=>[x.id,Number(x.current.toFixed(2))])),dividend:Math.round(N(state.years?.[CURRENT_YEAR]?.monthly?.[CURRENT_MONTH-1]))};
  const i=list.findIndex(x=>x&&x.month===CURRENT_KEY);if(i>=0)list[i]=summary;else list.push(summary);list.sort((a,b)=>String(a.month).localeCompare(String(b.month)));state.extensions.monthlySummaries=list;return summary;
}
const previousUpdateYearFromAssets=updateYearFromAssets;
updateYearFromAssets=function(){previousUpdateYearFromAssets();upsertMonthlySummary()};

/* ---------- settings ---------- */
const previousSettings=renderSettings;
renderSettings=function(){
  previousSettings();
  const body=document.getElementById('settingsBody'),error=document.getElementById('settingsError');if(!body||!error)return;
  let selectedTheme=themeMode();
  const section=document.createElement('div');section.className='settingsSection v21ThemeSection';section.innerHTML=`<div class="settingsTitle">화면 테마</div><div class="v21ThemePicker" role="radiogroup" aria-label="화면 테마"><button type="button" data-theme-option="auto" class="${selectedTheme==='auto'?'active':''}">자동<small>기기 설정</small></button><button type="button" data-theme-option="light" class="${selectedTheme==='light'?'active':''}">라이트<small>항상 밝게</small></button><button type="button" data-theme-option="dark" class="${selectedTheme==='dark'?'active':''}">다크<small>항상 어둡게</small></button></div></div>`;
  error.before(section);
  section.querySelectorAll('[data-theme-option]').forEach(b=>b.onclick=()=>{selectedTheme=b.dataset.themeOption;section.querySelectorAll('[data-theme-option]').forEach(x=>x.classList.toggle('active',x===b))});
  const btn=document.getElementById('saveSettings'),old=btn?.onclick;if(!btn||!old)return;
  btn.onclick=()=>{error.textContent='';old();if(error.textContent)return;state.settings.theme=selectedTheme;state.meta.appVersion=BUILD;applyTheme(selectedTheme);save();renderAll(true)};
};

/* ---------- final render wrapper ---------- */
const prevAll=renderAll;
renderAll=function(keep=false){
  syncAge();state.meta.appVersion=BUILD;applyTheme();document.title='개인연금 V2.6';prevAll(keep);syncAge();state.meta.appVersion=BUILD;renderV21Home();if(state.ui.screen==='analysis')renderAnalysis();if(state.ui.screen==='future')renderFuture();const sub=document.getElementById('headerSub');if(sub)sub.textContent=`${currentAge()}세 · ${state.profile.retirementAge}세 연금 개시 계획`;
};
window.PensionV21={build:BUILD,aiDecision,expectedHistory,scenarioProjection,upsertMonthlySummary,applyTheme,compactMoney,axisScale};
document.title='개인연금 V2.6';renderAll(true);save();
})();
