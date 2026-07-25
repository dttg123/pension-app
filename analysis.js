/* ===== js/30-v0-stable.js ===== */
(()=>{
'use strict';
const STABLE_VERSION='0.0.0-stable';
const ANALYSIS_ENGINE_VERSION='rules-0.1';
const ACCOUNT_KEYS=['pension','irp'];
const ACCOUNT_LABEL={all:'전체',pension:'연금저축',irp:'IRP'};

function copyYearRow(row,ratio){
  const r=clone(row||{}),num=k=>Math.round((Number(r[k])||0)*ratio);
  return {start:num('start'),end:num('end'),cumulative:num('cumulative'),contribution:num('contribution'),operating:num('operating'),realized:num('realized'),return:Number(r.return)||0,dividend:num('dividend'),reinvested:num('reinvested'),monthly:(r.monthly||Array(12).fill(0)).map(v=>Math.round((Number(v)||0)*ratio))};
}
function ensureAccountYears(){
  state.accountYears=state.accountYears||{pension:{},irp:{}};
  state.meta=state.meta||{};state.meta.accountHistoryEstimated=state.meta.accountHistoryEstimated||{};
  const totals={pension:accountTotal(state.accounts.pension),irp:accountTotal(state.accounts.irp)},sum=Math.max(1,totals.pension+totals.irp);
  for(const key of ACCOUNT_KEYS){
    state.accountYears[key]=state.accountYears[key]||{};
    if(!Object.keys(state.accountYears[key]).length){
      const ratio=totals[key]/sum;
      for(const [year,row] of Object.entries(state.years||{}))state.accountYears[key][year]=copyYearRow(row,ratio);
      state.meta.accountHistoryEstimated[key]=true;
    }
  }
}
function ensureAccountYear(key,year=CURRENT_YEAR){
  ensureAccountYears();
  if(!state.accountYears[key][year])state.accountYears[key][year]={start:accountTotal(state.accounts[key]),end:accountTotal(state.accounts[key]),cumulative:Number(state.accounts[key].principal)||0,contribution:0,operating:0,realized:0,return:0,dividend:0,reinvested:0,monthly:Array(12).fill(0)};
  const row=state.accountYears[key][year];row.monthly=Array.isArray(row.monthly)?row.monthly.slice(0,12):Array(12).fill(0);while(row.monthly.length<12)row.monthly.push(0);return row;
}
function syncCurrentAccountYears(){
  ensureAccountYears();
  for(const key of ACCOUNT_KEYS){
    const row=ensureAccountYear(key,CURRENT_YEAR),a=state.accounts[key];row.end=accountTotal(a);row.cumulative=Number(a.principal)||0;row.operating=row.end-(Number(row.start)||0)-(Number(row.contribution)||0);const base=(Number(row.start)||0)+(Number(row.contribution)||0)/2;row.return=base?row.operating/base*100:0;
  }
}
ensureAccountYears();syncCurrentAccountYears();state.meta.appVersion=STABLE_VERSION;

const oldUpdateYearStable=updateYearFromAssets;
updateYearFromAssets=function(){oldUpdateYearStable();syncCurrentAccountYears()};

function analysisRows(scope){
  const source=scope==='all'?state.years:state.accountYears?.[scope]||{};
  return Object.keys(source).map(Number).sort((a,b)=>a-b).map(year=>({year,...source[year]}));
}
function contributionStatusText(){
  const status=currentContributionStatus(),planned=ACCOUNT_KEYS.filter(k=>Number(state.settings.monthly[k])>0);
  if(!planned.length)return {planned,total:0,label:'납입 계획 없음',chips:[]};
  const chips=planned.map(k=>({key:k,name:ACCOUNT_LABEL[k],done:!!status[k],amount:Number(state.settings.monthly[k])||0}));
  const done=chips.filter(x=>x.done).length;
  return {planned,total:chips.reduce((s,x)=>s+x.amount,0),label:done===chips.length?'이번 달 완료':done?`${done}/${chips.length} 계좌 완료`:'아직 기록 전',chips};
}

renderHome=function(){
  const total=totalAsset(),principal=totalPrincipal(),profit=total-principal,ret=principal?profit/principal*100:0,goal=goalStatus(),status=contributionStatusText();
  const accountCards=Object.entries(state.accounts).map(([k,a])=>{const at=accountTotal(a),ap=at-a.principal,share=total?at/total*100:0;return `<button class="accountLink" data-account-link="${k}"><div><strong>${esc(a.name)}</strong><small class="tiny">전체의 ${share.toFixed(1)}%</small></div><span class="go">›</span><div class="accountStats"><div><span>원금</span><b>${man(a.principal)}</b></div><div><span>손익</span><b class="${ap>=0?'good':'bad'}">${ap>=0?'+':''}${man(ap)}</b></div><div><span>수익률</span><b class="${accountReturn(a)>=0?'good':'bad'}">${pct(accountReturn(a))}</b></div></div></button>`}).join('');
  document.getElementById('home').innerHTML=`<div class="stack homeCompact">
    <section class="card hero pressable" id="totalCard"><div class="heroTop"><div class="eyebrow">개인연금 총자산</div><div style="display:flex;align-items:center;gap:8px"><span class="v0Badge">V0.0</span><span class="chevron ${state.ui.homeExpanded?'open':''}" id="totalChevron">⌄</span></div></div><div class="money">${fmt(total)}</div><div class="${profit>=0?'good':'bad'}" style="font-weight:900">누적 운용증가 ${profit>=0?'+':''}${fmt(profit)} · ${pct(ret)}</div><div class="metricGrid"><div class="metric"><small>누적 순납입</small><b>${fmt(principal)}</b></div><div class="metric accent"><small>마지막 갱신</small><b>${esc(state.lastUpdated)}</b></div></div><div class="expand ${state.ui.homeExpanded?'open':''}" id="accountExpand"><div>${accountCards}</div></div></section>
    <button class="homeAction" id="homeContribution"><div class="homeActionTop"><div><div class="eyebrow">${CURRENT_MONTH}월 납입</div><div class="homeActionTitle">${status.label}</div></div><div class="homeActionValue">${fmt(status.total)}</div></div><div class="statusChips">${status.chips.length?status.chips.map(x=>`<span class="statusChip ${x.done?'done':'wait'}">${esc(x.name)} ${x.done?'완료':'대기'}</span>`).join(''):'<span class="statusChip">설정에서 월 납입액을 정하세요</span>'}</div><div class="homeActionMeta">눌러서 이번 달 또는 놓친 달을 기록합니다.</div></button>
    <button class="homeAction" id="homeGoal"><div class="homeGoalGrid"><div class="goalRing" style="--p:${Math.min(goal.p,100)}"><b>${Math.round(goal.p)}%</b></div><div class="goalText"><b>목표 월연금 ${goal.gap<=0?'달성권':'진행 중'}</b><p>현재가치 예상 월 ${man(goal.real)} · 목표 ${man(goal.goal)}${goal.gap>0?` · ${man(goal.gap)} 부족`:''}</p></div><span class="homeGoalArrow">›</span></div></button>
  </div>`;
  document.getElementById('totalCard').addEventListener('click',e=>{if(e.target.closest('[data-account-link]'))return;state.ui.homeExpanded=!state.ui.homeExpanded;document.getElementById('accountExpand').classList.toggle('open',state.ui.homeExpanded);document.getElementById('totalChevron').classList.toggle('open',state.ui.homeExpanded);save()});
  document.querySelectorAll('[data-account-link]').forEach(b=>b.onclick=e=>{e.stopPropagation();navigate('account',b.dataset.accountLink)});
  document.getElementById('homeContribution').onclick=()=>quickForm('contribution');
  document.getElementById('homeGoal').onclick=()=>navigate('future');
};

function topHolding(scope='all'){
  const holdings=[];for(const key of ACCOUNT_KEYS){if(scope!=='all'&&scope!==key)continue;for(const h of state.accounts[key].holdings)holdings.push({...h,account:key})}
  const total=holdings.reduce((s,h)=>s+(Number(h.value)||0),0)+(scope==='all'?state.accounts.pension.cash+state.accounts.irp.cash:state.accounts[scope].cash);
  holdings.sort((a,b)=>b.value-a.value);return {holding:holdings[0]||null,pct:total&&holdings[0]?holdings[0].value/total*100:0,total};
}
function stableDateAge(){
  const raw=String(state.lastUpdated||'').replace(/\./g,'-'),d=new Date(raw+'T00:00:00');
  if(Number.isNaN(d.getTime()))return {days:null,label:'갱신일 확인 필요'};
  const days=Math.max(0,Math.floor((Date.now()-d.getTime())/86400000));
  return {days,label:days===0?'오늘 갱신':days===1?'어제 갱신':`${days}일 전 갱신`};
}
function projectedAtRate(rate,monthlyExtra=0){
  const years=Math.max(0,state.profile.retirementAge-state.profile.age),monthly=Number(state.settings.monthly.pension)+Number(state.settings.monthly.irp)+monthlyExtra;let bal=totalAsset();for(let y=0;y<years;y++){const rm=Math.pow(1+rate/100,1/12)-1;for(let m=0;m<12;m++){bal*=1+rm;bal+=monthly}}return bal;
}
function runSmartAnalysis(){
  const life=lifecycleAnalysis(),goal=goalStatus(),yearsLeft=Math.max(0,state.profile.retirementAge-state.profile.age),top=topHolding('all'),irp=state.accounts.irp,irpTotal=accountTotal(irp),irpRisk=irpTotal?irp.holdings.filter(h=>h.risk!==false).reduce((s,h)=>s+h.value,0)/irpTotal*100:0,age=stableDateAge();
  const classes=state.settings.assetClasses.map(c=>{const totals=classTotals(),all=Object.values(totals).reduce((s,n)=>s+n,0)||1,cur=(totals[c.id]||0)/all*100;return {name:c.name,diff:cur-c.target,cur,target:c.target}}),largestGap=[...classes].sort((a,b)=>Math.abs(b.diff)-Math.abs(a.diff))[0];
  const recent=Object.keys(state.years).map(Number).sort((a,b)=>b-a).slice(0,3).map(y=>state.years[y]);const planned=(Number(state.settings.monthly.pension)+Number(state.settings.monthly.irp))*12,consistency=planned?recent.filter(r=>(Number(r.contribution)||0)>=planned*.8).length/Math.max(1,recent.length)*100:100;
  let score=100,issues=[];const add=(severity,title,body)=>{issues.push({severity,title,body});score-=severity};
  if(age.days!=null&&age.days>30)add(12,'자산현황이 오래됐어요',`${age.days}일 전 자료입니다. 분석 정확도를 위해 계좌 현황을 먼저 갱신하세요.`);
  if(Math.abs(largestGap?.diff||0)>12)add(14,'목표 비중과 차이가 큽니다',`${largestGap.name}이 목표보다 ${Math.abs(largestGap.diff).toFixed(1)}%p ${largestGap.diff>0?'높습니다':'낮습니다'}. 다음 납입으로 천천히 조정하는 편이 낫습니다.`);else if(Math.abs(largestGap?.diff||0)>6)add(7,'자산배분을 점검할 구간입니다',`${largestGap.name}이 목표와 ${Math.abs(largestGap.diff).toFixed(1)}%p 차이 납니다.`);
  if(top.pct>40)add(15,'한 종목 집중도가 높습니다',`${top.holding?.name||'상위 종목'}이 전체의 ${top.pct.toFixed(1)}%입니다. 추가 매수 전 다른 자산군과 균형을 확인하세요.`);else if(top.pct>30)add(8,'상위 종목 비중을 지켜보세요',`${top.holding?.name||'상위 종목'}이 전체의 ${top.pct.toFixed(1)}%입니다.`);
  if(goal.p<60)add(16,'목표 월연금과 간격이 큽니다',`현재 계획의 목표 달성률은 ${goal.p.toFixed(0)}%입니다. 수익률을 무리하게 높이기보다 납입액·은퇴 시점을 함께 비교하세요.`);else if(goal.p<85)add(9,'목표 월연금까지 보완이 필요합니다',`현재가치 기준 월 ${man(Math.max(0,goal.gap))}가 부족한 추정입니다.`);
  if(consistency<67)add(8,'최근 납입 지속성이 낮습니다',`최근 ${recent.length}년 중 계획의 80% 이상 납입한 해가 ${Math.round(consistency/100*recent.length)}년입니다.`);
  if(irpRisk>70.2)add(20,'IRP 위험자산 한도를 확인하세요',`현재 계산상 위험자산 비중이 ${irpRisk.toFixed(1)}%입니다. 상품의 실제 위험자산 분류와 주문 가능 여부를 증권사에서 확인하세요.`);
  if(!issues.length)issues.push({severity:0,title:'현재 구조는 크게 흔들리지 않습니다',body:'새 종목을 늘리기보다 정기 납입과 주기적인 현황 갱신을 유지하는 것이 우선입니다.'});
  issues.sort((a,b)=>b.severity-a.severity);score=clamp(score,0,100);
  const base=projectedAtRate(Number(state.settings.returnRate)),lower=projectedAtRate(Number(state.settings.returnRate)-1),extra=projectedAtRate(Number(state.settings.returnRate),100000);
  const label=score>=85?'안정적 관리':score>=70?'점검할 항목 있음':score>=50?'보완 필요':'우선 점검 필요';
  return {score,label,life,goal,yearsLeft,top,irpRisk,consistency,issues:issues.slice(0,4),scenario:{base,lower,extra}};
}
window.PensionAnalysisEngine={version:ANALYSIS_ENGINE_VERSION,run:runSmartAnalysis};

function analysisTabClass(panel){return panel==='dividend'?'i1':panel==='allocation'?'i2':panel==='smart'?'i3':''}
renderAnalysis=function(){
  if(!['performance','dividend','allocation','smart'].includes(state.ui.analysisPanel))state.ui.analysisPanel='performance';
  state.ui.analysisScope=state.ui.analysisScope||'all';state.ui.allocationScope=state.ui.allocationScope||'pension';
  document.getElementById('analysis').innerHTML=`<div class="segment four"><i class="segmentIndicator ${analysisTabClass(state.ui.analysisPanel)}"></i><button data-analysis="performance" class="${state.ui.analysisPanel==='performance'?'active':''}">성과</button><button data-analysis="dividend" class="${state.ui.analysisPanel==='dividend'?'active':''}">배당</button><button data-analysis="allocation" class="${state.ui.analysisPanel==='allocation'?'active':''}">비중</button><button data-analysis="smart" class="${state.ui.analysisPanel==='smart'?'active':''}">스마트</button></div><div id="analysisContent"></div>`;
  document.querySelectorAll('[data-analysis]').forEach(b=>b.onclick=()=>switchAnalysisPanel(b.dataset.analysis));renderAnalysisContent();
};
switchAnalysisPanel=function(panel){if(state.ui.analysisPanel===panel)return;state.ui.analysisPanel=panel;const root=document.getElementById('analysis');root.querySelectorAll('[data-analysis]').forEach(b=>b.classList.toggle('active',b.dataset.analysis===panel));root.querySelector('.segmentIndicator').className=`segmentIndicator ${analysisTabClass(panel)}`;renderAnalysisContent();animatePanel('analysisContent');save();wakeFab()};
renderAnalysisContent=function(){const el=document.getElementById('analysisContent');if(state.ui.analysisPanel==='performance')renderPerformance(el);else if(state.ui.analysisPanel==='dividend')renderDividend(el);else if(state.ui.analysisPanel==='allocation')renderAllocation(el);else renderSmart(el)};
function scopeButtons(active,includeAll=true,attr='scope'){const keys=includeAll?['all','pension','irp']:['pension','irp'];return `<div class="scopeSegment">${keys.map(k=>`<button data-${attr}="${k}" class="${active===k?'active':''}">${ACCOUNT_LABEL[k]}</button>`).join('')}</div>`}
function bindScopeButtons(selector,callback){document.querySelectorAll(selector).forEach(b=>b.onclick=()=>callback(b.dataset.scope||b.dataset.allocScope))}

renderPerformance=function(el){
  const scope=['all','pension','irp'].includes(state.ui.analysisScope)?state.ui.analysisScope:'all',data=analysisRows(scope);
  if(!data.length){el.innerHTML=scopeButtons(scope)+`<div class="card empty"><b>이 계좌의 과거 성과가 없어요</b><p>과거 연도 요약에서 계좌를 선택해 입력할 수 있어요.</p></div>`;bindScopeButtons('[data-scope]',v=>{state.ui.analysisScope=v;renderPerformance(el);animatePanel('analysisContent');save()});return}
  state.ui.performanceIndex=clamp(Number(state.ui.performanceIndex)||data.length-1,0,data.length-1);
  const chart=buildChart(data,{yValue:d=>d.end,cValue:d=>d.cumulative,xLabels:data.map((d,i)=>[i,String(d.year)]),idPrefix:'perf'}),latest=data.at(-1),returns=data.map(d=>Number(d.return)||0),best=Math.max(...returns),worst=Math.min(...returns),estimated=scope!=='all'&&state.meta.accountHistoryEstimated?.[scope];
  el.innerHTML=`${scopeButtons(scope)}<div class="stack"><div class="card chartCard"><div class="chartHead"><div><div class="chartTitle">${ACCOUNT_LABEL[scope]} 총자산과 순납입</div><div class="chartSub">연도를 누르거나 좌우로 움직여 확인</div></div><div class="legend"><span><i class="a"></i>총자산</span><span><i class="b"></i>순납입</span></div></div><div class="chart"><div class="chartTooltip" id="perfTooltip"></div>${chart.svg}</div><div class="detailBars"><div class="detailBar"><div class="detailBarTop"><span>총자산</span><b id="perfTotal"></b></div><div class="barTrack"><div class="barFill" id="perfTotalBar"></div></div></div><div class="detailBar"><div class="detailBarTop"><span>누적 순납입</span><b id="perfContrib"></b></div><div class="barTrack"><div class="barFill gray" id="perfContribBar"></div></div></div><div class="detailBar"><div class="detailBarTop"><span>운용증가</span><b id="perfProfit"></b></div><div class="barTrack"><div class="barFill green" id="perfProfitBar"></div></div></div></div></div><div class="card compact"><div class="analysisStats"><div class="analysisStat"><small>최근 총자산</small><b>${man(latest.end)}</b></div><div class="analysisStat"><small>최고 연수익률</small><b class="good">${pct(best)}</b></div><div class="analysisStat"><small>최저 연수익률</small><b class="${worst<0?'bad':''}">${pct(worst)}</b></div></div>${estimated?'<div class="analysisNote">이전 버전의 계좌별 과거값은 현재 계좌 비중으로 나눈 참고값입니다. 과거 연도 요약에서 계좌별 실제값으로 바꿀 수 있어요.</div>':''}</div><details class="card compact historyDetails"><summary>${data.length}년 전체 연도</summary><table class="table"><thead><tr><th>연도</th><th>총자산</th><th>순납입</th><th>수익률</th></tr></thead><tbody>${data.slice().reverse().map(d=>`<tr><td>${d.year}</td><td>${man(d.end)}</td><td>${man(d.cumulative)}</td><td class="${d.return>=0?'good':'bad'}">${pct(d.return)}</td></tr>`).join('')}</tbody></table></details></div>`;
  const update=(i,commit)=>{const d=data[i],profit=d.end-d.cumulative,max=Math.max(d.end,1),p=chart.pts[i],tip=document.getElementById('perfTooltip');state.ui.performanceIndex=i;updateChartSelection('perf',chart,i);tip.style.left=`${clamp(p.x/chart.W*100,18,82)}%`;tip.innerHTML=`${d.year}년<br>${man(d.end)} · ${pct(d.return)}`;document.getElementById('perfTotal').textContent=fmt(d.end);document.getElementById('perfContrib').textContent=fmt(d.cumulative);document.getElementById('perfProfit').textContent=`${profit>=0?'+':''}${fmt(profit)}`;document.getElementById('perfTotalBar').style.width='100%';document.getElementById('perfContribBar').style.width=`${clamp(d.cumulative/max*100,0,100)}%`;document.getElementById('perfProfitBar').style.width=`${clamp(Math.abs(profit)/max*100,0,100)}%`;if(commit)save()};
  update(state.ui.performanceIndex,false);bindChart('perfHit',data,chart,update);bindScopeButtons('[data-scope]',v=>{state.ui.analysisScope=v;state.ui.performanceIndex=999;renderPerformance(el);animatePanel('analysisContent');save()});
};

function renderDividend(el){
  const scope=['all','pension','irp'].includes(state.ui.analysisScope)?state.ui.analysisScope:'all',data=analysisRows(scope),latest=data.at(-1)||{year:CURRENT_YEAR,dividend:0},values=data.map(d=>Number(d.dividend)||0),max=Math.max(1,...values),avg3=values.slice(-3).reduce((s,n)=>s+n,0)/Math.max(1,values.slice(-3).length),prev=data.length>1?Number(data.at(-2).dividend)||0:0,growth=prev?(latest.dividend/prev-1)*100:0;
  let rank=[];if(scope==='all')rank=(state.dividendsByAsset[CURRENT_YEAR]||[]).slice().sort((a,b)=>b[1]-a[1]);else rank=state.accounts[scope].holdings.map(h=>[h.name,Number(h.dividend)||0]).filter(x=>x[1]>0).sort((a,b)=>b[1]-a[1]);
  el.innerHTML=`${scopeButtons(scope)}<div class="stack"><div class="card"><div class="row"><div><div class="eyebrow">${ACCOUNT_LABEL[scope]} ${latest.year}년 배당</div><div class="money small">${fmt(latest.dividend)}</div></div><span class="chip ${growth<0?'bad':''}">${prev?`전년 대비 ${pct(growth)}`:'첫 기록'}</span></div><div class="analysisStats" style="margin-top:13px"><div class="analysisStat"><small>최근 3년 평균</small><b>${fmt(avg3)}</b></div><div class="analysisStat"><small>월평균 환산</small><b>${fmt(latest.dividend/12)}</b></div><div class="analysisStat"><small>기록 연도</small><b>${data.length}년</b></div></div></div><div class="card"><div class="sectionTitle" style="margin:0 0 11px">연도별 배당</div><div class="dividendBars">${data.slice(-10).reverse().map(d=>`<div><div class="dividendBarTop"><span>${d.year}</span><b>${fmt(d.dividend)}</b></div><div class="dividendBarTrack"><i style="width:${clamp((Number(d.dividend)||0)/max*100,0,100)}%"></i></div></div>`).join('')||'<div class="tiny">기록이 없어요.</div>'}</div></div><div class="card"><div class="sectionTitle" style="margin:0 0 8px">${scope==='all'?CURRENT_YEAR+' 종목별':'계좌 누적 종목별'}</div>${rank.length?rank.slice(0,8).map(([name,val])=>`<div class="row" style="padding:11px 0;border-bottom:1px solid var(--line)"><span style="min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(name)}</span><b>${fmt(val)}</b></div>`).join(''):'<div class="tiny">아직 기록이 없어요.</div>'}</div></div>`;
  bindScopeButtons('[data-scope]',v=>{state.ui.analysisScope=v;renderDividend(el);animatePanel('analysisContent');save()});
}

renderAllocation=function(el){
  const scope=['pension','irp'].includes(state.ui.allocationScope)?state.ui.allocationScope:'pension',totals=classTotals(scope),total=Object.values(totals).reduce((s,n)=>s+n,0),top=topHolding(scope),rows=state.settings.assetClasses.map(c=>{const cur=total?(totals[c.id]||0)/total*100:0,diff=cur-c.target;return {c,cur,diff}}),under=[...rows].sort((a,b)=>a.diff-b.diff)[0],a=state.accounts[scope];
  const irpRisk=scope==='irp'&&total?a.holdings.filter(h=>h.risk!==false).reduce((s,h)=>s+h.value,0)/total*100:null;
  el.innerHTML=`${scopeButtons(scope,false,'alloc-scope')}<div class="stack"><div class="card"><div class="row"><div><div class="eyebrow">${ACCOUNT_LABEL[scope]} 자산비중</div><div class="money small">${fmt(total)}</div></div><span class="chip">${a.holdings.length}개 상품</span></div><div class="allocationSummary"><div><small>가장 큰 종목</small><b>${top.holding?`${top.pct.toFixed(1)}%`:'-'}</b></div><div><small>다음 납입 우선</small><b>${esc(under?.c.name||'-')}</b></div>${irpRisk!=null?`<div><small>IRP 위험자산</small><b class="${irpRisk>70?'bad':''}">${irpRisk.toFixed(1)}%</b></div><div><small>안전자산</small><b>${Math.max(0,100-irpRisk).toFixed(1)}%</b></div>`:''}</div>${rows.map(r=>`<div class="allocationRow"><div class="allocationTop"><b>${esc(r.c.name)}</b><span>현재 ${r.cur.toFixed(1)}%</span><b class="${r.diff>2?'bad':r.diff<-2?'blue':''}">${r.diff>0?'+':''}${r.diff.toFixed(1)}%p</b></div><div class="allocBar"><i style="width:${clamp(r.cur,0,100)}%"></i></div></div>`).join('')}</div><div class="card brief"><div class="briefTitle">다음 납입 방향</div><p>${total?`목표보다 가장 낮은 자산군은 <b>${esc(under.c.name)}</b>입니다. 다음 납입액 ${fmt(state.settings.monthly[scope])}을 우선 배분하면 비중 차이를 줄일 수 있어요.`:'자산현황을 입력하면 계좌별 비중을 분석합니다.'}</p></div></div>`;
  document.querySelectorAll('[data-alloc-scope]').forEach(b=>b.onclick=()=>{state.ui.allocationScope=b.dataset.allocScope;renderAllocation(el);animatePanel('analysisContent');save()});
};

function renderSmart(el){
  const a=runSmartAnalysis(),diffLower=a.scenario.base-a.scenario.lower,diffExtra=a.scenario.extra-a.scenario.base;
  el.innerHTML=`<div class="stack"><div class="card smartHero"><div class="row start"><div><div class="eyebrow">앱 자체 관리 점검 · 참고용</div><div class="smartScore">${Math.round(a.score)}<small>/100</small></div></div><span class="smartBadge">${esc(a.label)}</span></div><p class="smartLead">${a.yearsLeft}년의 적립 기간, 목표 월연금, 자산배분, 집중도, 납입 지속성을 함께 확인한 결과입니다.</p></div><div class="card"><div class="sectionTitle" style="margin:0 0 3px">우선 확인할 항목</div>${a.issues.map((x,i)=>`<div class="smartIssue"><span class="smartIssueNo">${i+1}</span><div><b>${esc(x.title)}</b><p>${esc(x.body)}</p></div></div>`).join('')}</div><div class="card"><div class="sectionTitle" style="margin:0">미래 민감도 비교</div><div class="smartScenario"><div><small>현재 가정</small><b>${man(a.scenario.base)}</b></div><div><small>수익률 −1%p</small><b class="bad">−${man(diffLower)}</b></div><div><small>월납입 +10만원</small><b class="good">+${man(diffExtra)}</b></div></div><div class="engineNote">공식 투자 적합성·세무·연금 진단이 아닙니다. 이 분석은 외부 AI가 아니라 기기 안에서 계산하는 규칙 기반 엔진 ${ANALYSIS_ENGINE_VERSION}입니다. 데이터 구조와 화면은 유지한 채 분석 엔진만 나중에 교체할 수 있게 분리했습니다.</div></div></div>`;
}

function parseHistoryStable(text){
  const rows=[],errors=[];
  String(text||'').split(/\n+/).forEach((raw,idx)=>{
    const line=raw.trim();if(!line)return;
    const parts=line.split(/\s*[|\t]\s*/);
    if(parts.length<3){errors.push(idx+1);return}
    const year=Number(String(parts[0]).replace(/[^0-9]/g,'')),end=parseMoney(parts[1]),cumulative=parseMoney(parts[2]),dividend=parseMoney(parts[3]||0);
    if(year<1990||year>2100||end<0||cumulative<0||dividend<0){errors.push(idx+1);return}
    rows.push({year,end,cumulative,dividend});
  });
  rows.sort((a,b)=>a.year-b.year);return {rows,errors};
}

function renderHistoryFormStable(title,body){
  title.textContent='과거 연도 요약';const initial=state.ui.historyScope||'all';
  const textFor=scope=>analysisRows(scope).slice(-30).map(r=>`${r.year} | ${Math.round(r.end).toLocaleString('ko-KR')} | ${Math.round(r.cumulative).toLocaleString('ko-KR')} | ${Math.round(r.dividend||0).toLocaleString('ko-KR')}`).join('\n');
  body.innerHTML=`<div class="sheetNotice">전체 또는 계좌별 과거 기록을 연도 단위로 넣습니다. 월별 자료를 억지로 다시 만들 필요는 없어요.</div>${scopeButtons(initial)}<div class="field"><label>연도 | 연말 총자산 | 누적 순납입 | 연간 배당</label><textarea id="historyText" rows="10"></textarea><div class="historyExample">한 줄에 한 해 · 세로줄(|) 또는 탭 · 배당은 비워도 됨</div></div><div class="settingsInfo historyPreview" id="historyPreview"></div><button class="btn primary full" id="applyHistory" style="margin-top:14px">확인한 기록 반영</button>`;
  let scope=initial;const textarea=document.getElementById('historyText');
  const update=()=>{const d=parseHistoryStable(textarea.value),dup=d.rows.filter((r,i,a)=>a.findIndex(x=>x.year===r.year)!==i);document.getElementById('historyPreview').innerHTML=`<b>${ACCOUNT_LABEL[scope]} · ${d.rows.length}개 연도 인식</b><div class="previewList"><div class="previewItem"><span>범위</span><b>${d.rows.length?`${d.rows[0].year}~${d.rows.at(-1).year}`:'-'}</b></div><div class="previewItem"><span>마지막 총자산</span><b>${d.rows.length?fmt(d.rows.at(-1).end):'-'}</b></div>${d.errors.length?`<div class="previewItem"><span>확인할 줄</span><b class="bad">${d.errors.join(', ')}</b></div>`:''}${dup.length?`<div class="previewItem"><span>중복 연도</span><b class="bad">${dup[0].year}</b></div>`:''}</div>`};
  const loadScope=v=>{scope=v;state.ui.historyScope=v;document.querySelectorAll('[data-scope]').forEach(b=>b.classList.toggle('active',b.dataset.scope===v));textarea.value=textFor(v);update()};
  document.querySelectorAll('[data-scope]').forEach(b=>b.onclick=()=>loadScope(b.dataset.scope));textarea.addEventListener('input',update);loadScope(initial);
  document.getElementById('applyHistory').onclick=()=>{const d=parseHistoryStable(textarea.value);if(d.errors.length)return toast(`${d.errors[0]}번째 줄을 확인하세요`);if(!d.rows.length)return toast('과거 연도 자료를 입력하세요');if(new Set(d.rows.map(r=>r.year)).size!==d.rows.length)return toast('중복 연도를 정리하세요');let prevEnd=0,prevCum=0;const target=scope==='all'?state.years:state.accountYears[scope];for(const r of d.rows){const contribution=Math.max(0,r.cumulative-prevCum),operating=r.end-prevEnd-contribution,base=prevEnd+contribution/2;target[r.year]={start:prevEnd,end:r.end,cumulative:r.cumulative,contribution,operating,realized:0,return:base?operating/base*100:0,dividend:r.dividend,reinvested:0,monthly:Array(12).fill(0)};prevEnd=r.end;prevCum=r.cumulative}if(scope==='all'){updateYearFromAssets()}else{state.meta.accountHistoryEstimated[scope]=false;syncCurrentAccountYears()}save();closeSheet('formSheet');renderAll();toast(`${ACCOUNT_LABEL[scope]} ${d.rows.length}년 기록을 반영했어요`)};
};


const oldQuickFormStable=quickForm;
quickForm=function(type){
  if(type==='history'){
    document.getElementById('quickSheet').classList.remove('open');
    const title=document.getElementById('formTitle'),body=document.getElementById('formBody');
    renderHistoryFormStable(title,body);openSheet('formSheet',true);return;
  }
  oldQuickFormStable(type);
};
document.querySelectorAll('[data-quick]').forEach(b=>b.onclick=()=>quickForm(b.dataset.quick));

renderContributionForm=function(title,body){
  title.textContent='납입 기록';const defaultMonth=CURRENT_KEY;
  body.innerHTML=`<div class="sheetNotice">이번 달이 기본이며, 놓친 달은 월을 바꿔 기록할 수 있어요.</div><div class="field"><label>기록 월</label><input id="contribMonth" type="month" value="${defaultMonth}"></div><div class="inputHelp" id="contribMonthHelp"></div><div id="contribChoices"></div><div class="settingsInfo" id="contribYearSummary" style="margin-top:10px"></div><button class="btn primary full" id="applyContribution" style="margin-top:14px">선택 계좌 기록</button>`;
  const draw=()=>{const m=document.getElementById('contribMonth').value||defaultMonth,s=(state.runtime.contributions[m]||{pension:false,irp:false}),year=Number(m.slice(0,4)),yr=state.years[year]||{contribution:0},annual=(Number(state.settings.monthly.pension)+Number(state.settings.monthly.irp))*12;document.getElementById('contribMonthHelp').textContent=m===defaultMonth?'이번 달 기록은 현재 원금과 현금에도 반영돼요.':'과거 달 기록은 연간·계좌별 납입 이력만 보완하고 현재 잔고는 바꾸지 않아요.';const planned=ACCOUNT_KEYS.filter(k=>Number(state.settings.monthly[k])>0),missing=planned.filter(k=>!s[k]),host=document.getElementById('contribChoices'),btn=document.getElementById('applyContribution');document.getElementById('contribYearSummary').innerHTML=`<b>${year}년 납입 ${fmt(yr.contribution||0)}</b><div class="tiny" style="margin-top:4px">현재 계획 연 ${fmt(annual)} · 세액공제 한도와 실제 인정액은 별도 확인</div>`;if(!planned.length){host.innerHTML='<div class="settingsInfo">월 납입 계획이 없어요. 설정에서 월 납입액을 정하세요.</div>';btn.disabled=true;return}if(!missing.length){host.innerHTML='<div class="settingsInfo">선택한 달의 계획된 납입이 모두 기록됐어요.</div>';btn.disabled=true;return}btn.disabled=false;host.innerHTML=missing.map(k=>`<label class="quickItem" style="margin-top:10px"><input type="checkbox" data-contrib="${k}" checked style="width:20px;height:20px"><span><b>${state.accounts[k].name}</b><small>${fmt(state.settings.monthly[k])}</small></span><span></span></label>`).join('')};
  document.getElementById('contribMonth').onchange=draw;draw();
  document.getElementById('applyContribution').onclick=()=>{const monthKey=document.getElementById('contribMonth').value||defaultMonth,keys=[...document.querySelectorAll('[data-contrib]:checked')].map(x=>x.dataset.contrib);if(!keys.length)return toast('기록할 계좌를 선택하세요');const year=Number(monthKey.slice(0,4)),row=ensureYear(year),status=(state.runtime.contributions[monthKey]||{pension:false,irp:false});for(const k of keys){if(status[k])continue;const amount=Number(state.settings.monthly[k])||0;if(!amount)continue;const ar=ensureAccountYear(k,year);if(year===CURRENT_YEAR){state.accounts[k].principal+=amount;state.accounts[k].cash+=amount}row.contribution=(Number(row.contribution)||0)+amount;row.accountContribution=row.accountContribution||{pension:0,irp:0};row.accountContribution[k]=(Number(row.accountContribution[k])||0)+amount;ar.contribution=(Number(ar.contribution)||0)+amount;ar.cumulative=(Number(ar.cumulative)||0)+amount;ar.operating=(Number(ar.end)||0)-(Number(ar.start)||0)-ar.contribution;const base=(Number(ar.start)||0)+ar.contribution/2;ar.return=base?ar.operating/base*100:0;window.PensionV1Record?.ledger('contribution',{date:`${monthKey}-01T00:00:00`,accountId:`account-${k}`,amount,note:`${monthKey} ${state.accounts[k].name} 납입`,source:'monthly-record'});status[k]=true}state.runtime.contributions[monthKey]=status;if(year===CURRENT_YEAR)updateYearFromAssets();save();closeSheet('formSheet');renderAll();toast(`${monthKey.replace('-','년 ')}월 납입을 기록했어요`)};
};

renderDetailForm=function(title,body){
  title.textContent='배당·매도 기록';body.innerHTML=`<div class="field"><label>기록일</label><input id="detailDate" type="date" value="${localYmd(now)}"></div><div class="field"><label>종류</label><select id="detailType"><option value="dividend">배당·분배금</option><option value="sale">매도 확정손익</option></select></div><div class="field"><label>계좌</label><select id="detailAccount"><option value="pension">연금저축</option><option value="irp">IRP</option></select></div><div class="field"><label>상품</label><select id="detailAsset"></select><div class="inputHelp" id="detailAssetHelp"></div></div><div class="field"><label id="detailAmountLabel">받은 금액</label><input id="detailAmount" inputmode="decimal" placeholder="예: 120,000"><div class="inputHelp" id="detailAmountHelp">배당은 0원보다 큰 금액만 기록해요.</div></div><button class="btn primary full" id="applyDetail" style="margin-top:14px">기록</button>`;
  const fill=()=>{const key=document.getElementById('detailAccount').value,items=state.accounts[key].holdings,select=document.getElementById('detailAsset'),help=document.getElementById('detailAssetHelp'),btn=document.getElementById('applyDetail');select.innerHTML=items.length?items.map((h,i)=>`<option value="${i}">${esc(h.name)}</option>`).join(''):'<option value="">등록된 상품 없음</option>';select.disabled=!items.length;btn.disabled=!items.length;help.textContent=items.length?'':'먼저 자산현황을 입력하세요.'};
  const syncKind=()=>{const sale=document.getElementById('detailType').value==='sale';document.getElementById('detailAmountLabel').textContent=sale?'확정손익':'받은 금액';document.getElementById('detailAmount').placeholder=sale?'예: 120,000 또는 -80,000':'예: 120,000';document.getElementById('detailAmountHelp').textContent=sale?'수익은 양수, 손실은 음수로 입력하세요.':'배당은 0원보다 큰 금액만 기록해요.'};document.getElementById('detailAccount').onchange=fill;document.getElementById('detailType').onchange=syncKind;fill();syncKind();
  document.getElementById('applyDetail').onclick=()=>{const date=document.getElementById('detailDate').value,dt=new Date(date+'T00:00:00'),amt=parseMoney(document.getElementById('detailAmount').value),key=document.getElementById('detailAccount').value,i=Number(document.getElementById('detailAsset').value),h=state.accounts[key].holdings[i],kind=document.getElementById('detailType').value;if(Number.isNaN(dt.getTime()))return toast('기록일을 확인하세요');if(!h)return toast('먼저 상품을 등록하세요');if(kind==='dividend'&&amt<=0)return toast('배당 금액은 0원보다 크게 입력하세요');if(kind==='sale'&&amt===0)return toast('확정손익을 입력하세요');const y=dt.getFullYear(),m=dt.getMonth(),row=ensureYear(y),ar=ensureAccountYear(key,y);if(kind==='dividend'){row.dividend=(Number(row.dividend)||0)+amt;row.monthly[m]=(Number(row.monthly[m])||0)+amt;ar.dividend=(Number(ar.dividend)||0)+amt;ar.monthly[m]=(Number(ar.monthly[m])||0)+amt;h.dividend=(h.dividend||0)+amt;state.dividendsByAsset[y]=state.dividendsByAsset[y]||[];const found=state.dividendsByAsset[y].find(x=>x[0]===h.name);found?found[1]+=amt:state.dividendsByAsset[y].push([h.name,amt])}else{row.realized=(Number(row.realized)||0)+amt;ar.realized=(Number(ar.realized)||0)+amt;h.realized=(h.realized||0)+amt}window.PensionV1Record?.ledger(kind==='dividend'?'dividend':'sell',{date:`${date}T00:00:00`,accountId:`account-${key}`,assetId:h.id||'',assetName:h.name,amount:amt,note:kind==='dividend'?'배당·분배금 기록':'매도 확정손익 기록',source:'detail-form'});state.ui.accountView=key;save();closeSheet('formSheet');renderAll();toast(kind==='dividend'?`${date} 배당을 기록했어요`:`${date} 확정손익을 기록했어요`)};
};

/* Photo viewer: enlarge the actual scrollable canvas, not only a visual transform. */
function upgradePhotoViewer(){
  const viewer=document.getElementById('photoViewer');if(!viewer||viewer.dataset.stable)return;viewer.dataset.stable='1';const body=viewer.querySelector('.photoViewerBody'),img=viewer.querySelector('img');let stage=viewer.querySelector('.photoStage');if(!stage){stage=document.createElement('div');stage.className='photoStage';img.replaceWith(stage);stage.appendChild(img)}let scale=1,rotation=0;
  const paint=()=>{const inner=Math.max(240,body.clientWidth-28),ratio=img.naturalWidth?img.naturalHeight/img.naturalWidth:2.1,baseW=inner,baseH=inner*ratio,w=baseW*scale,h=baseH*scale,side=rotation%180!==0;stage.style.width=`${side?h:w}px`;stage.style.height=`${side?w:h}px`;img.style.width=`${w}px`;img.style.height=`${h}px`;img.style.transform=`translate(-50%,-50%) rotate(${rotation}deg)`};
  img.addEventListener('load',paint);new ResizeObserver(paint).observe(body);
  viewer.querySelector('[data-pv=plus]').onclick=()=>{scale=clamp(scale+.25,1,3);paint()};viewer.querySelector('[data-pv=minus]').onclick=()=>{scale=clamp(scale-.25,1,3);paint()};viewer.querySelector('[data-pv=rotate]').onclick=()=>{rotation=(rotation+90)%360;paint()};
  const close=()=>{viewer.classList.remove('open');window.syncModalState?.()};viewer.querySelector('[data-pv=close]').onclick=close;viewer.addEventListener('click',e=>{if(e.target===viewer)close()});
  window.openPhotoViewer=src=>{if(!src)return;scale=1;rotation=0;img.src=src;viewer.classList.add('open');window.syncModalState?.();requestAnimationFrame(()=>{paint();body.scrollTo(0,0)})};
}
upgradePhotoViewer();

let stablePhotoUrl=null;
document.addEventListener('change',e=>{if(e.target?.id==='photoFile'){const file=e.target.files?.[0];if(!file)return;if(stablePhotoUrl&&stablePhotoUrl!==document.getElementById('photoImg')?.src)try{URL.revokeObjectURL(stablePhotoUrl)}catch(_){}setTimeout(()=>{stablePhotoUrl=document.getElementById('photoImg')?.src||null},0)}});
const oldCloseSheetStable=closeSheet;
closeSheet=function(id,fromPop=false){oldCloseSheetStable(id,fromPop);if(id==='formSheet'&&stablePhotoUrl){try{URL.revokeObjectURL(stablePhotoUrl)}catch(_){}stablePhotoUrl=null}};

/* FAB auto-hide after 10 seconds; any touch/scroll/navigation wakes it. */
let fabTimer=null;
function wakeFab(){document.body.classList.remove('fabIdle');document.body.classList.add('fabWake');clearTimeout(fabTimer);fabTimer=setTimeout(()=>{document.body.classList.add('fabIdle');document.body.classList.remove('fabWake')},10000);setTimeout(()=>document.body.classList.remove('fabWake'),260)}
window.wakeFab=wakeFab;
['pointerdown','scroll','keydown'].forEach(type=>window.addEventListener(type,wakeFab,{passive:true}));
const oldNavigateStable=navigate;
navigate=function(screen,accountKey=null){oldNavigateStable(screen,accountKey);wakeFab()};
const oldOpenSheetStable=openSheet;
openSheet=function(id,replace=false){oldOpenSheetStable(id,replace);wakeFab()};

const oldRenderSettingsStable=renderSettings;
renderSettings=function(){oldRenderSettingsStable();const n=document.querySelector('#settingsBody .sheetNotice');if(n)n.textContent=`저장 버튼을 눌러야 반영됩니다. 앱 ${STABLE_VERSION}`};

renderAll(true);save();wakeFab();
})();


