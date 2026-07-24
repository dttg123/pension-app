/* 개인연금 V2.1 사용자 중심 최종 개편 */
(()=>{
'use strict';
const BUILD='2.1.2';
const LABEL={all:'전체',pension:'연금저축',irp:'IRP'};
const N=v=>Number.isFinite(Number(v))?Number(v):0;
/* V2.1부터 나이는 저장값이 아니라 출생연도로 계산한다.
   이전 검토판이 임시로 만든 출생연도와 기존 나이가 충돌하면, 최초 1회는 기존 나이를 우선해 이관한다. */
state.profile=state.profile||{}; state.meta=state.meta||{};
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
syncAge();
document.title='개인연금 V2.1';
state.meta=state.meta||{}; state.meta.appVersion=BUILD; state.meta.uxBuild='v2.1';
state.ui=state.ui||{};
if(!['performance','cashflow','compare'].includes(state.ui.analysisPanel)) state.ui.analysisPanel='performance';
state.ui.v21CashPeriod=state.ui.v21CashPeriod||'5y';
state.ui.v21Scenario=['base','safe','custom'].includes(state.ui.v21Scenario)?state.ui.v21Scenario:'base';
state.ui.v21CashMetric=state.ui.v21CashMetric||'dividend';

const rowsFor=(scope='all')=>{
  const src=scope==='all'?(state.years||{}):(state.accountYears?.[scope]||{});
  return Object.keys(src).map(Number).filter(Number.isFinite).sort((a,b)=>a-b).map(year=>({year,...src[year]}));
};
const scopeSelect=scope=>`<div class="v21Scope"><span>계좌</span><select id="v21Scope"><option value="all" ${scope==='all'?'selected':''}>전체</option><option value="pension" ${scope==='pension'?'selected':''}>연금저축</option><option value="irp" ${scope==='irp'?'selected':''}>IRP</option></select></div>`;
function bindScope(renderer){const s=document.getElementById('v21Scope');if(s)s.onchange=()=>{state.ui.analysisScope=s.value;state.ui.v21Point=999;renderer(document.getElementById('analysisContent'));save()}}
function contributionInfo(){
  const row=state.years?.[CURRENT_YEAR]||{},paid=Math.max(0,N(row.contribution));
  const plan=(N(state.settings.monthly?.pension)+N(state.settings.monthly?.irp))*12;
  const status=currentContributionStatus(),planned=['pension','irp'].filter(k=>N(state.settings.monthly?.[k])>0),missing=planned.filter(k=>!status[k]);
  return {paid,plan,pct:plan?clamp(paid/plan*100,0,100):0,missing,status};
}
function freshness(){
  const raw=String(state.lastUpdated||'').trim(); if(!raw)return null;
  const d=new Date(raw.replace(/\./g,'-')+'T00:00:00'); return Number.isNaN(d.getTime())?null:Math.max(0,Math.floor((Date.now()-d.getTime())/86400000));
}
function allocationSnapshot(){
  const totals=classTotals(),total=Object.values(totals).reduce((a,b)=>a+N(b),0)||1;
  const classes=(state.settings.assetClasses||[]).map(c=>({id:c.id,name:c.name,target:N(c.target),current:N(totals[c.id])/total*100})).map(x=>({...x,diff:x.current-x.target}));
  const holdings=['pension','irp'].flatMap(k=>(state.accounts?.[k]?.holdings||[]).map(h=>({...h,account:k}))).sort((a,b)=>N(b.value)-N(a.value));
  return {classes,total,top:holdings[0]||null,topPct:holdings[0]?N(holdings[0].value)/total*100:0};
}
function expectedHistory(rows){
  const rate=N(state.settings.returnRate)/100;
  let expected=rows.length?N(rows[0].start):0;
  return rows.map((d,i)=>{
    const contribution=Math.max(0,N(d.contribution));
    if(i===0&&expected===0) expected=Math.max(0,N(d.start));
    expected=expected*(1+rate)+contribution*(1+rate/2);
    return {...d,expected};
  });
}
function aiDecision(){
  const all=expectedHistory(rowsFor('all')),
    latest=all.at(-1)||{}, prev=all.at(-2)||{}, alloc=allocationSnapshot(), fresh=freshness();
  const actual=N(latest.end),expected=N(latest.expected),deviation=expected?((actual/expected)-1)*100:0;
  const latestReturn=N(latest.return),prevDividend=N(prev.dividend),dividendGrowth=prevDividend?((N(latest.dividend)/prevDividend)-1)*100:0;
  const con=contributionInfo();
  if(fresh==null||fresh>60)return {level:'자료 확인',kind:'stale',title:'최신 잔고를 반영한 뒤 판단하세요',reason:`${fresh==null?'마지막 갱신일을 확인할 수 없습니다':`마지막 갱신이 ${fresh}일 전입니다`}. 오래된 보유내역과 비중으로 매매 결정을 내리면 현재 상태와 다를 수 있습니다.`,action:'자산현황 갱신',question:'지금 매매 판단을 미루는 게 맞을까?'};
  if(alloc.topPct>=42)return {level:'집중 주의',kind:'concentration',title:'상위 종목 추가매수는 한 번 더 확인하세요',reason:`${alloc.top?.name||'상위 종목'}이 전체 개인연금의 ${alloc.topPct.toFixed(1)}%입니다. 기존 보유분을 급히 매도하기보다 다음 납입을 부족 자산군에 배분하는 방식이 더 단순합니다.`,action:'다음 납입을 부족 자산군에 배분',question:'리밸런싱을 매도로 할까, 납입으로 할까?'};
  if(dividendGrowth>=25&&latestReturn<0)return {level:'착시 주의',kind:'income',title:'분배금 증가와 총수익을 따로 보세요',reason:`분배금은 전년보다 ${dividendGrowth.toFixed(0)}% 늘었지만 기록된 최근 투자수익률은 ${pct(latestReturn)}입니다. 현금흐름이 늘었다는 이유만으로 운용 성과가 개선됐다고 판단할 수 없습니다.`,action:'분배금보다 총수익 먼저 확인',question:'배당형 비중이 너무 높은가?'};
  if(deviation>=15&&latestReturn>0)return {level:'계획 점검',kind:'hot',title:'좋은 성과를 장기 기대치로 올리지 마세요',reason:`현재 자산은 앱의 기대 경로보다 ${deviation.toFixed(1)}% 앞서 있습니다. 이는 입력된 연간 기록을 기준으로 한 비교이며 실시간 시장 과열 판단은 아닙니다.`,action:'기대수익률은 그대로 유지',question:'현재 성과 때문에 계획을 바꿔도 될까?'};
  if(deviation<=-15&&latestReturn<0)return {level:'계획 점검',kind:'cold',title:'손실률만으로 전량 매도하지 마세요',reason:`현재 자산은 앱의 기대 경로보다 ${Math.abs(deviation).toFixed(1)}% 뒤에 있습니다. 손실 자체보다 납입 중단, 자산 집중, 투자 전제 변화가 있었는지 먼저 확인해야 합니다.`,action:'원인 확인 후 계획 유지 여부 판단',question:'지금 매도해야 할 근거가 충분할까?'};
  if(con.plan>0&&con.paid<con.plan*0.5&&CURRENT_MONTH>=7)return {level:'계획 이탈',kind:'stale',title:'투자판단보다 납입 계획부터 확인하세요',reason:`올해 실제 납입은 계획의 ${Math.round(con.pct)}%입니다. 자산배분 판단 전에 납입이 일시적으로 밀린 것인지 계획 자체가 바뀐 것인지 구분하는 편이 정확합니다.`,action:'올해 납입 계획 재확인',question:'월 납입 계획을 현실적으로 바꿀까?'};
  return {level:'특이사항 없음',kind:'ok',title:'현재 기록에서 즉시 바꿀 신호는 없습니다',reason:'현재 비중, 납입, 계획 대비 자산 흐름에서 즉시 매매를 요구할 만한 뚜렷한 이상 신호가 없습니다. 실시간 시세의 급등·급락을 판단한 결과는 아닙니다.',action:'현재 계획 유지',question:'지금 계획을 유지해도 될까?'};
}

function path(points){return points.map((p,i)=>`${i?'L':'M'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ')}
function buildTripleChart(data,id){
  const W=640,H=270,p={l:34,r:18,t:18,b:34};
  const max=Math.max(1,...data.flatMap(d=>[N(d.end),N(d.expected),N(d.cumulative)]))*1.04;
  const x=i=>p.l+(W-p.l-p.r)*(data.length<=1?.5:i/(data.length-1));
  const y=v=>p.t+(H-p.t-p.b)*(1-N(v)/max);
  const floor=H-p.b;
  const pts=data.map((d,i)=>({x:x(i),actual:y(d.end),expected:y(d.expected),contrib:y(d.cumulative)}));
  const ticks=[.25,.5,.75,1].map(t=>{const yy=p.t+(H-p.t-p.b)*(1-t);return `<line x1="${p.l}" x2="${W-p.r}" y1="${yy}" y2="${yy}" class="v21Grid"/><text x="${p.l}" y="${yy-6}" class="v21Axis">${man(max*t)}</text>`}).join('');
  const labelIdx=[0,Math.round((data.length-1)/2),data.length-1].filter((v,i,a)=>v>=0&&a.indexOf(v)===i);
  const labels=labelIdx.map(i=>`<text x="${x(i)}" y="${H-8}" text-anchor="middle" class="v21Axis">${data[i].year}</text>`).join('');
  const contribPath=path(pts.map(q=>({x:q.x,y:q.contrib})))+` L ${pts.at(-1).x} ${floor} L ${pts[0].x} ${floor} Z`;
  return {W,H,p,pts,svg:`<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none"><defs><linearGradient id="${id}ContribFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#b8c4d3" stop-opacity=".24"/><stop offset="1" stop-color="#b8c4d3" stop-opacity=".05"/></linearGradient></defs>${ticks}${labels}<path d="${contribPath}" fill="url(#${id}ContribFill)"/><path d="${path(pts.map(q=>({x:q.x,y:q.contrib})))}" class="v21Line v21Contrib"/><path d="${path(pts.map(q=>({x:q.x,y:q.expected})))}" class="v21Line v21Expected"/><path d="${path(pts.map(q=>({x:q.x,y:q.actual})))}" class="v21Line v21Actual"/><line id="${id}Sel" class="v21Select" x1="${pts[0].x}" x2="${pts[0].x}" y1="${p.t}" y2="${H-p.b}"/><circle id="${id}A" class="v21Dot actual" r="6"/><circle id="${id}E" class="v21Dot expected" r="5"/><circle id="${id}C" class="v21Dot contrib" r="5"/><rect id="${id}Hit" class="v21Hit" x="${p.l}" y="${p.t}" width="${W-p.l-p.r}" height="${H-p.t-p.b}"/></svg>`};
}
function selectTriple(id,chart,i){
  const q=chart.pts[i]; if(!q)return;
  const sel=document.getElementById(id+'Sel'); if(sel){sel.setAttribute('x1',q.x);sel.setAttribute('x2',q.x)}
  for(const [s,y] of [['A',q.actual],['E',q.expected],['C',q.contrib]]){const c=document.getElementById(id+s);if(c){c.setAttribute('cx',q.x);c.setAttribute('cy',y)}}
}
function bindPointer(hitId,count,update){const hit=document.getElementById(hitId);if(!hit)return;let drag=false;const nearest=e=>{const r=hit.getBoundingClientRect(),pct=clamp((e.clientX-r.left)/Math.max(1,r.width),0,1);return Math.round(pct*Math.max(0,count-1))};hit.onpointerdown=e=>{drag=true;try{hit.setPointerCapture(e.pointerId)}catch(_){} update(nearest(e),false)};hit.onpointermove=e=>{if(drag)update(nearest(e),false)};hit.onpointerup=e=>{drag=false;update(nearest(e),true)};hit.onpointercancel=()=>drag=false}

function renderV21Home(){
  syncAge();
  const total=totalAsset(),principal=totalPrincipal(),profit=total-principal,ret=principal?profit/principal*100:0,con=contributionInfo(),goal=goalStatus(),ai=aiDecision(),fresh=freshness();
  const accounts=Object.entries(state.accounts).map(([k,a])=>{const v=accountTotal(a),p=v-N(a.principal),yearPaid=N(state.accountYears?.[k]?.[CURRENT_YEAR]?.contribution);return `<button class="v21Account" data-account-link="${k}"><span><b>${esc(a.name)}</b><small>올해 납입 ${man(yearPaid)}</small></span><span><b>${man(v)}</b><small class="${p>=0?'good':'bad'}">손익 ${p>=0?'+':''}${man(p)}</small></span><i>›</i></button>`}).join('');
  const aiHtml=ai.kind==='ok'?`<button class="v21AiCompact" id="v21Ai"><span><b>AI 판단</b><small>${esc(ai.title)}</small></span><i>›</i></button>`:`<button class="v21AiAlert ${ai.kind}" id="v21Ai"><div><span>AI 판단 · ${esc(ai.level)}</span><h3>${esc(ai.title)}</h3><p>${esc(ai.reason)}</p></div><b>${esc(ai.action)} ›</b></button>`;
  const expandLabel=state.ui.homeExpanded?'간단히 보기':'계좌별 보기';
  document.getElementById('home').innerHTML=`<div class="stack v21Home"><section class="card v21Hero"><button class="v21HeroMain" id="v21Total"><div><span>개인연금 총자산</span><strong>${man(total)}</strong><small class="${profit>=0?'good':'bad'}">투자손익 ${profit>=0?'+':''}${man(profit)} · ${pct(ret)}</small></div><div><small>마지막 갱신</small><b>${fresh==null?'확인 필요':fresh===0?'오늘':`${fresh}일 전`}</b><em class="v21ExpandLabel" id="v21ExpandLabel">${expandLabel}</em></div></button><div class="expand ${state.ui.homeExpanded?'open':''}" id="v21Accounts"><div><div>${accounts}</div><div class="v21Exact">정확한 금액 ${fmt(total)} · 누적 순납입 ${fmt(principal)}</div></div></div></section><div class="v21HomeGrid"><button class="card v21Mini" id="v21Contribution"><span>${CURRENT_YEAR}년 납입</span><strong>${man(con.paid)}</strong><div class="v21Progress"><i style="width:${con.pct}%"></i></div><small>${Math.round(con.pct)}% 완료 · 계획 ${man(con.plan)}</small></button><button class="card v21Mini" id="v21Future"><span>${state.profile.retirementAge}세 예상 월연금</span><strong>${man(goal.real)}</strong><small>${goal.real>=N(state.settings.goalMonthly)?'목표 달성권':'목표보다 '+man(Math.max(0,N(state.settings.goalMonthly)-goal.real))+' 부족'} · 자세히 ›</small></button></div>${aiHtml}<div class="v21Quick"><button id="v21Pay">이번 달 납입</button><button id="v21Snap">자산 갱신</button></div></div>`;
  document.getElementById('v21Total').onclick=()=>{state.ui.homeExpanded=!state.ui.homeExpanded;document.getElementById('v21Accounts').classList.toggle('open',state.ui.homeExpanded);document.getElementById('v21ExpandLabel').textContent=state.ui.homeExpanded?'간단히 보기':'계좌별 보기';save()};
  document.querySelectorAll('[data-account-link]').forEach(b=>b.onclick=e=>{e.stopPropagation();navigate('account',b.dataset.accountLink)});
  document.getElementById('v21Contribution').onclick=()=>quickForm('contribution');
  document.getElementById('v21Future').onclick=()=>navigate('future');
  document.getElementById('v21Pay').onclick=()=>quickForm('contribution');
  document.getElementById('v21Snap').onclick=()=>quickForm('snapshot');
  document.getElementById('v21Ai').onclick=()=>{state.ui.analysisPanel='compare';navigate('analysis');renderAnalysis();save()};
}

function renderPerformance21(el){
  const scope=['all','pension','irp'].includes(state.ui.analysisScope)?state.ui.analysisScope:'all',rows=expectedHistory(rowsFor(scope));
  if(!rows.length){el.innerHTML=scopeSelect(scope)+`<div class="card empty"><b>성과 기록이 없어요</b><p>과거 연도와 현재 자산을 입력하면 생성됩니다.</p></div>`;bindScope(renderPerformance21);return}
  let idx=clamp(Number.isFinite(Number(state.ui.v21Point))?Number(state.ui.v21Point):rows.length-1,0,rows.length-1);const chart=buildTripleChart(rows,'v21Perf');
  el.innerHTML=`${scopeSelect(scope)}<div class="stack"><section class="card v21ChartCard"><div class="v21ChartHead"><div><h2>실제 · 기대 · 순납입</h2><p>그래프를 좌우로 움직여 연도별 차이를 확인하세요.</p></div></div><div class="v21Legend"><span><i class="actual"></i>실제자산</span><span><i class="expected"></i>기대경로</span><span><i class="contrib"></i>누적 순납입</span></div><div class="v21Chart">${chart.svg}</div><div class="v21PointCard" id="v21PerfPoint"></div></section><details class="card v21Details"><summary>연도별 표 보기</summary><div class="v21TableWrap"><table><thead><tr><th>연도</th><th>실제</th><th>기대</th><th>순납입</th></tr></thead><tbody>${rows.slice().reverse().map(r=>`<tr><td>${r.year}</td><td>${man(r.end)}</td><td>${man(r.expected)}</td><td>${man(r.cumulative)}</td></tr>`).join('')}</tbody></table></div></details></div>`;
  const update=(i,commit)=>{idx=i;state.ui.v21Point=i;const d=rows[i],vsExpected=N(d.end)-N(d.expected),profit=N(d.end)-N(d.cumulative);selectTriple('v21Perf',chart,i);document.getElementById('v21PerfPoint').innerHTML=`<div><span>${d.year}년 실제자산</span><strong>${man(d.end)}</strong></div><div class="v21PointGrid"><span>기대경로 <b>${man(d.expected)}</b></span><span>누적 순납입 <b>${man(d.cumulative)}</b></span><span>기대 대비 <b class="${vsExpected>=0?'good':'bad'}">${vsExpected>=0?'+':''}${man(vsExpected)}</b></span><span>누적 투자손익 <b class="${profit>=0?'good':'bad'}">${profit>=0?'+':''}${man(profit)}</b></span></div>`;if(commit)save()};
  update(idx,false);bindPointer('v21PerfHit',rows.length,update);bindScope(renderPerformance21);
}
function cashData(period,scope){
  const rows=rowsFor(scope); if(period==='12m'){
    const out=[];for(let offset=11;offset>=0;offset--){const d=new Date(CURRENT_YEAR,CURRENT_MONTH-1-offset,1),y=d.getFullYear(),m=d.getMonth(),row=(scope==='all'?state.years?.[y]:state.accountYears?.[scope]?.[y])||{};out.push({label:`${String(m+1).padStart(2,'0')}월`,full:`${y}.${String(m+1).padStart(2,'0')}`,dividend:N(row.monthly?.[m]),realized:0})}return out;
  }
  const count=period==='3y'?3:period==='5y'?5:999;return rows.slice(-count).map(r=>({label:String(r.year),full:`${r.year}년`,dividend:N(r.dividend),realized:N(r.realized)}));
}
function buildCashChart(data,id,metric){
  const W=640,H=220,p={l:26,r:16,t:18,b:34};
  const values=data.map(d=>N(d[metric]));
  const min=metric==='realized'?Math.min(0,...values):0,max=Math.max(1,...values),span=max-min||1;
  const plotW=W-p.l-p.r,step=plotW/Math.max(1,data.length),bar=Math.max(8,Math.min(26,step*.46));
  const x=i=>p.l+step*i+step/2,y=v=>p.t+(H-p.t-p.b)*(1-(N(v)-min)/span),zero=y(0);
  const pts=data.map((d,i)=>({x:x(i),value:y(d[metric]),raw:N(d[metric])}));
  const bars=pts.map((q,i)=>{const h=Math.abs(zero-q.value),visible=Math.max(4,h),yy=q.raw>=0?zero-visible:zero;return `<rect x="${q.x-bar/2}" y="${yy}" width="${bar}" height="${visible}" rx="${Math.min(8,bar/2)}" class="v21CashBar ${q.raw===0?'zero':''}" data-bar-index="${i}"/>`}).join('');
  const labelStep=data.length>=10?3:1;
  const labels=data.map((d,i)=>(i%labelStep===0||i===data.length-1)?`<text x="${x(i)}" y="${H-8}" text-anchor="middle" class="v21Axis">${d.label}</text>`:'').join('');
  const guides=[.5,1].map(t=>{const yy=p.t+(H-p.t-p.b)*(1-t);return `<line x1="${p.l}" x2="${W-p.r}" y1="${yy}" y2="${yy}" class="v21Grid"/>`}).join('');
  return {W,H,p,pts,svg:`<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">${guides}<line x1="${p.l}" x2="${W-p.r}" y1="${zero}" y2="${zero}" class="v21CashBase"/>${bars}${labels}<line id="${id}Sel" class="v21Select" y1="${p.t}" y2="${H-p.b}"/><circle id="${id}D" class="v21Dot cash" r="6"/><rect id="${id}Hit" class="v21Hit" x="${p.l}" y="${p.t}" width="${W-p.l-p.r}" height="${H-p.t-p.b}"/></svg>`};
}
function renderCashflow21(el){
  const scope=['all','pension','irp'].includes(state.ui.analysisScope)?state.ui.analysisScope:'all',period=state.ui.v21CashPeriod||'5y',metric=state.ui.v21CashMetric==='realized'?'realized':'dividend',data=cashData(period,scope),chart=buildCashChart(data,'v21Cash',metric);let idx=clamp(Number.isFinite(Number(state.ui.v21CashPoint))?Number(state.ui.v21CashPoint):data.length-1,0,data.length-1);
  const values=data.map(d=>N(d[metric])),total=values.reduce((a,b)=>a+b,0),nonzero=values.filter(v=>v!==0),average=data.length?total/data.length:0,peak=nonzero.length?Math.max(...nonzero.map(Math.abs)):0;
  const metricName=metric==='dividend'?'배당·분배금':'매도 실현손익';
  el.innerHTML=`${scopeSelect(scope)}<div class="v21Period"><button data-period="12m" class="${period==='12m'?'active':''}">12개월</button><button data-period="3y" class="${period==='3y'?'active':''}">3년</button><button data-period="5y" class="${period==='5y'?'active':''}">5년</button><button data-period="all" class="${period==='all'?'active':''}">전체</button></div><section class="card v21ChartCard v21CashCard"><div class="v21ChartHead v21CashHead"><div><h2>현금흐름</h2><p>기간과 항목을 바꿔 흐름만 빠르게 확인하세요.</p></div><div class="v21MetricToggle"><button data-cash-metric="dividend" class="${metric==='dividend'?'active':''}">분배금</button><button data-cash-metric="realized" class="${metric==='realized'?'active':''}">실현손익</button></div></div><div class="v21CashSummary"><div><span>${metricName} 합계</span><strong class="${metric==='realized'&&total<0?'bad':''}">${total>=0?'+':''}${man(total)}</strong></div><div><span>기간 평균</span><b>${man(average)}</b></div><div><span>최대 기록</span><b>${man(peak)}</b></div></div><div class="v21Chart v21CashChart">${chart.svg}</div><div class="v21PointCard v21CashPoint" id="v21CashPoint"></div></section>`;
  const update=(i,commit)=>{idx=i;state.ui.v21CashPoint=i;const d=data[i],q=chart.pts[i],value=N(d[metric]);const sel=document.getElementById('v21CashSel');if(sel){sel.setAttribute('x1',q.x);sel.setAttribute('x2',q.x)}const dot=document.getElementById('v21CashD');if(dot){dot.setAttribute('cx',q.x);dot.setAttribute('cy',q.value)}document.querySelectorAll('[data-bar-index]').forEach((bar,n)=>bar.classList.toggle('selected',n===i));document.getElementById('v21CashPoint').innerHTML=`<div><span>${d.full}</span><strong class="${metric==='realized'&&value<0?'bad':''}">${value>=0?'+':''}${man(value)}</strong></div><div class="v21PointGrid"><span>배당·분배금 <b>${man(d.dividend)}</b></span><span>실현손익 <b class="${d.realized>=0?'good':'bad'}">${d.realized>=0?'+':''}${man(d.realized)}</b></span></div>`;if(commit)save()};
  update(idx,false);bindPointer('v21CashHit',data.length,update);bindScope(renderCashflow21);
  document.querySelectorAll('[data-period]').forEach(b=>b.onclick=()=>{state.ui.v21CashPeriod=b.dataset.period;state.ui.v21CashPoint=999;renderCashflow21(el);save()});
  document.querySelectorAll('[data-cash-metric]').forEach(b=>b.onclick=()=>{state.ui.v21CashMetric=b.dataset.cashMetric;state.ui.v21CashPoint=999;renderCashflow21(el);save()});
}

function renderCompare21(el){
  const rows=expectedHistory(rowsFor('all')),latest=rows.at(-1)||{},expected=N(latest.expected),actual=N(latest.end),gap=actual-expected,con=contributionInfo(),alloc=allocationSnapshot(),ai=aiDecision();
  const classes=[...alloc.classes].sort((a,b)=>Math.abs(b.diff)-Math.abs(a.diff)).slice(0,4);
  el.innerHTML=`<div class="stack"><section class="card v21CompareHero"><div class="v21CompareEyebrow">계획 대비 현재</div><div class="v21CompareMain"><strong class="${gap>=0?'good':'bad'}">${gap>=0?'+':''}${man(gap)}</strong><small>실제 ${man(actual)} · 기대 ${man(expected)}</small></div><div class="v21Progress"><i style="width:${clamp(expected?actual/expected*100:0,0,100)}%"></i></div></section><section class="card v21CompareCombined"><div class="v21CompareBlock"><div class="sectionTitle">올해 납입</div><div class="v21CompareRows"><div><span>계획</span><b>${man(con.plan)}</b></div><div><span>기록</span><b>${man(con.paid)}</b></div><div><span>남음</span><b>${man(Math.max(0,con.plan-con.paid))}</b></div></div></div><div class="v21CompareDivider"></div><div class="v21CompareBlock"><div class="sectionTitle">목표 비중 차이</div><div class="v21Alloc">${classes.map(c=>`<div><span>${esc(c.name)}</span><div><i style="width:${clamp(c.current,0,100)}%"></i><em style="left:${clamp(c.target,0,100)}%"></em></div><b class="${Math.abs(c.diff)<=3?'':c.diff>0?'bad':'good'}">현재 ${c.current.toFixed(1)}% · ${c.diff>=0?'+':''}${c.diff.toFixed(1)}%p</b></div>`).join('')}</div></div></section><section class="card v21AiPanel ${ai.kind}"><div class="v21AiHead"><span>AI 판단</span><em>${esc(ai.level)}</em></div><h2>${esc(ai.title)}</h2><p>${esc(ai.reason)}</p><div class="v21AiAction"><small>권장 행동</small><b>${esc(ai.action)}</b></div><button class="btn light full" id="v21Ask">AI에게 이 판단 물어보기</button><div class="v21AiNote">월별 요약·거래·납입·비중만 사용합니다. 실시간 시세의 급등·급락은 판단하지 않습니다.</div></section></div>`;
  document.getElementById('v21Ask').onclick=()=>toast('AI 자유질문은 클라우드 연결 단계에서 활성화됩니다');
}

renderAnalysis=function(){
  if(!['performance','cashflow','compare'].includes(state.ui.analysisPanel))state.ui.analysisPanel='performance';
  const cls=state.ui.analysisPanel==='cashflow'?'i1':state.ui.analysisPanel==='compare'?'i2':'';
  document.getElementById('analysis').innerHTML=`<div class="segment three v21Tabs"><i class="segmentIndicator ${cls}"></i><button data-v21-tab="performance" class="${state.ui.analysisPanel==='performance'?'active':''}">성과</button><button data-v21-tab="cashflow" class="${state.ui.analysisPanel==='cashflow'?'active':''}">현금흐름</button><button data-v21-tab="compare" class="${state.ui.analysisPanel==='compare'?'active':''}">비교</button></div><div id="analysisContent"></div>`;
  document.querySelectorAll('[data-v21-tab]').forEach(b=>b.onclick=()=>{state.ui.analysisPanel=b.dataset.v21Tab;renderAnalysis();save()});
  renderAnalysisContent();
};
renderAnalysisContent=function(){const el=document.getElementById('analysisContent');if(state.ui.analysisPanel==='performance')renderPerformance21(el);else if(state.ui.analysisPanel==='cashflow')renderCashflow21(el);else renderCompare21(el)};

function futureCustom(){
  const currentMonthly=N(state.settings.monthly.pension)+N(state.settings.monthly.irp);
  const c=state.ui.v21Custom||{};
  return {monthly:N(c.monthly)||currentMonthly,rate:Number.isFinite(Number(c.rate))?Number(c.rate):N(state.settings.returnRate),retAge:N(c.retAge)||N(state.profile.retirementAge),name:'내 가정'};
}
function scenarioProjection(key){
  const age=currentAge(),custom=futureCustom(),cfg={base:{name:'기준',rate:N(state.settings.returnRate),monthly:N(state.settings.monthly.pension)+N(state.settings.monthly.irp),retAge:N(state.profile.retirementAge)},safe:{name:'보수적',rate:Math.max(0,N(state.settings.returnRate)-2),monthly:N(state.settings.monthly.pension)+N(state.settings.monthly.irp),retAge:N(state.profile.retirementAge)},custom}[key]||null;
  const c=cfg||cfg.base,years=Math.max(1,c.retAge-age),rm=Math.pow(1+c.rate/100,1/12)-1;let bal=totalAsset(),cum=totalPrincipal();const out=[{age,end:bal,cumulative:cum,operating:bal-cum}];
  for(let i=0;i<years;i++){for(let m=0;m<12;m++){bal*=1+rm;bal+=c.monthly}cum+=c.monthly*12;out.push({age:age+i+1,end:bal,cumulative:cum,operating:bal-cum})}return {cfg:c,data:out};
}
function buildFutureAreaChart(data,id){
  const W=640,H=240,p={l:34,r:18,t:18,b:34},max=Math.max(1,...data.map(d=>N(d.end)))*1.04,floor=H-p.b;
  const x=i=>p.l+(W-p.l-p.r)*(data.length<=1?.5:i/(data.length-1)),y=v=>p.t+(H-p.t-p.b)*(1-N(v)/max);
  const pts=data.map((d,i)=>({x:x(i),total:y(d.end),contrib:y(d.cumulative),age:d.age}));
  const totalPath=path(pts.map(q=>({x:q.x,y:q.total}))),contribPath=path(pts.map(q=>({x:q.x,y:q.contrib})));
  const contributionArea=contribPath+` L ${pts.at(-1).x} ${floor} L ${pts[0].x} ${floor} Z`;
  const growthArea=totalPath+` L ${pts.at(-1).x} ${pts.at(-1).contrib} `+pts.slice().reverse().map(q=>`L ${q.x.toFixed(1)} ${q.contrib.toFixed(1)}`).join(' ')+` Z`;
  const ticks=[.25,.5,.75,1].map(t=>{const yy=p.t+(H-p.t-p.b)*(1-t);return `<line x1="${p.l}" x2="${W-p.r}" y1="${yy}" y2="${yy}" class="v21Grid"/><text x="${p.l}" y="${yy-6}" class="v21Axis">${man(max*t)}</text>`}).join('');
  const labelIdx=[0,Math.round((data.length-1)/2),data.length-1].filter((v,i,a)=>a.indexOf(v)===i),labels=labelIdx.map(i=>`<text x="${x(i)}" y="${H-8}" text-anchor="middle" class="v21Axis">${data[i].age}세</text>`).join('');
  const milestones=pts.filter((q,i)=>i===0||i===pts.length-1||q.age%5===0).map(q=>`<circle cx="${q.x}" cy="${q.total}" r="3.5" class="v21Milestone"/>`).join('');
  return {W,H,p,pts,svg:`<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none"><defs><linearGradient id="${id}Growth" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2f87ea" stop-opacity=".32"/><stop offset="1" stop-color="#2f87ea" stop-opacity=".08"/></linearGradient></defs>${ticks}${labels}<path d="${contributionArea}" class="v21FutureContribArea"/><path d="${growthArea}" fill="url(#${id}Growth)"/><path d="${contribPath}" class="v21Line v21Contrib"/><path d="${totalPath}" class="v21Line v21Actual"/>${milestones}<line id="${id}Sel" class="v21Select" x1="${pts[0].x}" x2="${pts[0].x}" y1="${p.t}" y2="${floor}"/><circle id="${id}A" class="v21Dot actual" r="6"/><circle id="${id}C" class="v21Dot contrib" r="5"/><rect id="${id}Hit" class="v21Hit" x="${p.l}" y="${p.t}" width="${W-p.l-p.r}" height="${H-p.t-p.b}"/></svg>`};
}
function selectFuture(id,chart,i){const q=chart.pts[i];if(!q)return;const sel=document.getElementById(id+'Sel');if(sel){sel.setAttribute('x1',q.x);sel.setAttribute('x2',q.x)}const a=document.getElementById(id+'A'),c=document.getElementById(id+'C');if(a){a.setAttribute('cx',q.x);a.setAttribute('cy',q.total)}if(c){c.setAttribute('cx',q.x);c.setAttribute('cy',q.contrib)}}
function openFutureEditor(){
  const c=futureCustom();document.getElementById('formTitle').textContent='내 가정 설정';document.getElementById('formBody').innerHTML=`<div class="sheetNotice">기본 계획을 바꾸지 않고 비교용 가정만 만듭니다.</div><div class="field"><label>월 납입액</label><input id="v21CustomMonthly" inputmode="numeric" value="${Number(c.monthly).toLocaleString('ko-KR')}"></div><div class="twoFields"><div class="field"><label>기대수익률</label><input id="v21CustomRate" type="number" step="0.1" value="${c.rate}"></div><div class="field"><label>연금 개시 나이</label><input id="v21CustomRet" type="number" value="${c.retAge}"></div></div><button class="btn primary full" id="v21CustomSave" style="margin-top:16px">비교 가정 적용</button>`;openSheet('formSheet');
  const monthly=document.getElementById('v21CustomMonthly');monthly.onblur=()=>{const n=parseMoney(monthly.value);monthly.value=n?Number(n).toLocaleString('ko-KR'):''};
  document.getElementById('v21CustomSave').onclick=()=>{const m=parseMoney(monthly.value),rate=N(document.getElementById('v21CustomRate').value),ret=N(document.getElementById('v21CustomRet').value);if(m<0||rate<0||rate>20||ret<=currentAge()||ret>80){toast('가정 값을 확인하세요');return}state.ui.v21Custom={monthly:m,rate,retAge:ret};state.ui.v21Scenario='custom';state.ui.futureAge=ret;closeSheet('formSheet');renderFutureContent();save()};
}
renderFuture=function(){document.getElementById('future').innerHTML='<div id="futureContent"></div>';renderFutureContent()};
renderFutureContent=function(){
  const key=['base','safe','custom'].includes(state.ui.v21Scenario)?state.ui.v21Scenario:'base',pack=scenarioProjection(key),data=pack.data,final=data.at(-1),sim=withdrawalSim(final.end,'balanced'),monthly=presentValueMonthly(sim.startMonthly),goal=N(state.settings.goalMonthly),gap=monthly-goal;let idx=data.findIndex(d=>d.age===N(state.ui.futureAge));if(idx<0)idx=data.length-1;const chart=buildFutureAreaChart(data,'v21Future');
  document.getElementById('futureContent').innerHTML=`<div class="v21Scenario"><button data-scenario="base" class="${key==='base'?'active':''}">기준</button><button data-scenario="safe" class="${key==='safe'?'active':''}">보수적</button><button data-scenario="custom" class="${key==='custom'?'active':''}">내 가정</button></div><div class="stack"><section class="card v21FutureSummary"><div class="v21FutureTop"><div><span>${pack.cfg.retAge}세 예상자산</span><strong>${man(final.end)}</strong></div>${key==='custom'?'<button class="v21EditChip" id="v21EditCustom">가정 편집</button>':''}</div><div class="v21FutureKpi"><span>예상 월연금 <b>${man(monthly)}</b></span><span>${gap>=0?'목표보다':'목표까지'} <b class="${gap>=0?'good':'bad'}">${man(Math.abs(gap))}${gap>=0?' 여유':' 부족'}</b></span></div><small>오늘 돈 가치 · ${state.settings.withdrawYears}년 수령 가정 · 국민연금 제외</small></section><section class="card v21ChartCard v21FutureCard"><div class="v21ChartHead"><div><h2>${pack.cfg.name} 자산 경로</h2><p>회색은 내가 넣은 돈, 파란 영역은 예상 운용수익입니다.</p></div></div><div class="v21Legend"><span><i class="actual"></i>예상자산</span><span><i class="contrib"></i>누적 순납입</span></div><div class="v21Chart v21FutureGraph">${chart.svg}</div><div class="v21PointCard" id="v21FuturePoint"></div></section><button class="btn light full" id="v21Settings">기본 계획 설정</button></div>`;
  const update=(i,commit)=>{const d=data[i],profit=N(d.end)-N(d.cumulative);state.ui.futureAge=d.age;selectFuture('v21Future',chart,i);document.getElementById('v21FuturePoint').innerHTML=`<div><span>${d.age}세 예상자산</span><strong>${man(d.end)}</strong></div><div class="v21PointGrid"><span>누적 순납입 <b>${man(d.cumulative)}</b></span><span>예상 운용수익 <b class="${profit>=0?'good':'bad'}">${profit>=0?'+':''}${man(profit)}</b></span></div>`;if(commit)save()};update(idx,false);bindPointer('v21FutureHit',data.length,update);
  document.querySelectorAll('[data-scenario]').forEach(b=>b.onclick=()=>{if(b.dataset.scenario==='custom'&&!state.ui.v21Custom){openFutureEditor();return}state.ui.v21Scenario=b.dataset.scenario;state.ui.futureAge=scenarioProjection(b.dataset.scenario).cfg.retAge;renderFutureContent();save()});
  const edit=document.getElementById('v21EditCustom');if(edit)edit.onclick=openFutureEditor;
  document.getElementById('v21Settings').onclick=()=>{renderSettings();openSheet('settingsSheet')};
};

function upsertMonthlySummary(){
  state.extensions=state.extensions||{};
  const list=Array.isArray(state.extensions.monthlySummaries)?state.extensions.monthlySummaries:[];
  const alloc=allocationSnapshot();
  const summary={
    month:CURRENT_KEY,
    updatedAt:new Date().toISOString(),
    totalAsset:Math.round(totalAsset()),
    pensionAsset:Math.round(accountAsset('pension')),
    irpAsset:Math.round(accountAsset('irp')),
    cumulativePrincipal:Math.round(totalPrincipal()),
    investmentProfit:Math.round(totalAsset()-totalPrincipal()),
    topHoldingPct:Number(alloc.topPct.toFixed(2)),
    allocation:Object.fromEntries(alloc.classes.map(x=>[x.id,Number(x.current.toFixed(2))])),
    dividend:Math.round(N(state.years?.[CURRENT_YEAR]?.monthly?.[CURRENT_MONTH-1]))
  };
  const i=list.findIndex(x=>x&&x.month===CURRENT_KEY);
  if(i>=0)list[i]=summary;else list.push(summary);
  list.sort((a,b)=>String(a.month).localeCompare(String(b.month)));
  state.extensions.monthlySummaries=list;
  return summary;
}
const previousUpdateYearFromAssets=updateYearFromAssets;
updateYearFromAssets=function(){
  previousUpdateYearFromAssets();
  upsertMonthlySummary();
};

const previousSettings=renderSettings;
renderSettings=function(){
  previousSettings();
  const ageInput=document.getElementById('setAge');if(!ageInput)return;
  const label=ageInput.closest('.field')?.querySelector('label');if(label)label.textContent='출생연도 (연도 기준 나이 자동 계산)';
  ageInput.value=state.profile.birthYear||CURRENT_YEAR-currentAge();ageInput.min='1900';ageInput.max=String(CURRENT_YEAR-18);
  const btn=document.getElementById('saveSettings'),old=btn?.onclick;if(!btn||!old)return;
  btn.onclick=()=>{const birth=Number(ageInput.value);if(!Number.isFinite(birth)||birth<1900||birth>CURRENT_YEAR-18){document.getElementById('settingsError').textContent='출생연도를 확인하세요.';return}const age=CURRENT_YEAR-birth+1;ageInput.value=String(age);old();state.profile.birthYear=birth;state.profile.age=age;state.meta.birthYearConfirmed=true;state.meta.birthYearBasisVersion='year-age-v1';state.meta.appVersion=BUILD;save();renderAll(true)};
};
const prevAll=renderAll;
renderAll=function(keep=false){syncAge();state.meta.appVersion=BUILD;document.title='개인연금 V2.1';prevAll(keep);syncAge();state.meta.appVersion=BUILD;renderV21Home();if(state.ui.screen==='analysis')renderAnalysis();if(state.ui.screen==='future')renderFuture();const sub=document.getElementById('headerSub');if(sub)sub.textContent=`${currentAge()}세 · ${state.profile.retirementAge}세 연금 개시 계획`;};
window.PensionV21={build:BUILD,aiDecision,expectedHistory,scenarioProjection,upsertMonthlySummary};
document.title='개인연금 V2.1';renderAll(true);save();
})();
