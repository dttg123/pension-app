/* 개인연금 V2.0 RC6 - 계산 엔진 */
'use strict';
const activeRecords=()=>state.ledger.filter(r=>r&&r.status!=='cancelled');
const accountTotal=account=>(Number(account?.cash)||0)+(account?.holdings||[]).reduce((sum,h)=>sum+(Number(h.value)||0),0);
const totalAsset=()=>Object.values(state.accounts||{}).reduce((sum,a)=>sum+accountTotal(a),0);
const totalPrincipal=()=>Object.values(state.accounts||{}).reduce((sum,a)=>sum+(Number(a.principal)||0),0);
const accountReturn=account=>{const p=Number(account?.principal)||0;return p?(accountTotal(account)-p)/p*100:0};
const totalReturn=()=>{const p=totalPrincipal();return p?(totalAsset()-p)/p*100:0};
const scopeAccount=scope=>scope==='pension'||scope==='irp'?state.accounts[scope]:null;
const scopeTotal=scope=>scope==='all'?totalAsset():accountTotal(scopeAccount(scope));
const scopePrincipal=scope=>scope==='all'?totalPrincipal():Number(scopeAccount(scope)?.principal)||0;

function yearContribution(year,scope='all'){
  const y=state.years?.[year]||{};
  if(scope==='all')return Number(y.contribution)||0;
  const exact=Number(y.accountContribution?.[scope]);
  if(Number.isFinite(exact))return exact;
  return activeRecords().filter(r=>r.type==='contribution'&&Number(r.year||String(r.monthKey||r.date).slice(0,4))===Number(year)&&r.accountKey===scope).reduce((s,r)=>s+Number(r.amount||0),0);
}
function yearDividend(year,scope='all'){
  return activeRecords().filter(r=>['dividend','dividend-adjustment','dividend-account-allocation'].includes(r.type)&&Number(r.year||String(r.monthKey||r.date).slice(0,4))===Number(year)&&(scope==='all'||r.accountKey===scope)).reduce((s,r)=>s+Number(r.amount||0),0);
}
function yearRealized(year,scope='all'){
  return activeRecords().filter(r=>r.type==='sell'&&Number(r.year||String(r.monthKey||r.date).slice(0,4))===Number(year)&&(scope==='all'||r.accountKey===scope)).reduce((s,r)=>s+Number(r.realized??r.amount??0),0);
}
function performanceSeries(scope='all'){
  const source=scope==='all'?state.years:state.accountYears?.[scope];
  const rows=Object.entries(source||{}).map(([year,row])=>({year:Number(year),...row})).filter(r=>Number.isFinite(r.year)).sort((a,b)=>a.year-b.year);
  let previous=0;
  return rows.map((row,index)=>{
    const end=Number(row.end)||0;
    const contribution=Number(row.contribution??yearContribution(row.year,scope))||0;
    const start=Number.isFinite(Number(row.start))?Number(row.start):(index?previous:0);
    const profit=end-start-contribution;
    const denominator=Math.max(1,start+contribution/2);
    const returnRate=Number.isFinite(Number(row.return))?Number(row.return):profit/denominator*100;
    previous=end;
    return {...row,start,end,contribution,profit,return:returnRate,cumulative:Number(row.cumulative)||0,dividend:Number(row.dividend??yearDividend(row.year,scope))||0,realized:Number(row.realized??yearRealized(row.year,scope))||0};
  });
}
function currentContributionStatus(monthKey=CURRENT_MONTH_KEY){
  const result={pension:false,irp:false};
  for(const key of Object.keys(result)){
    result[key]=activeRecords().some(r=>r.type==='contribution'&&r.accountKey===key&&r.monthKey===monthKey)||!!state.runtime?.contributions?.[monthKey]?.[key];
  }
  return result;
}
function annualContributionStatus(year=CURRENT_YEAR){
  const row=state.years?.[year]||{};
  const paid=Number(row.contribution)||activeRecords().filter(r=>r.type==='contribution'&&Number(r.year)===year).reduce((s,r)=>s+Number(r.amount||0),0);
  const planned=(Number(state.settings.monthly.pension)||0)+(Number(state.settings.monthly.irp)||0);
  const annualPlan=planned*12;
  return {paid,annualPlan,progress:annualPlan?paid/annualPlan*100:100,taxLimit:Number(state.settings.taxCreditLimit)||0,taxUsed:Math.min(paid,Number(state.settings.taxCreditLimit)||0),taxRemain:Math.max(0,(Number(state.settings.taxCreditLimit)||0)-paid),totalLimit:Number(state.settings.annualContributionLimit)||0};
}
function monthlyRate(annualPct){return Math.pow(Math.max(0.0001,1+Number(annualPct||0)/100),1/12)-1}
function accumulationProjection({annualRate=state.settings.returnRate,monthlyExtra=0,retirementAge=state.profile.retirementAge,startAsset=totalAsset()}={}){
  const years=Math.max(0,Number(retirementAge)-Number(state.profile.age));
  const monthly=Math.max(0,Number(state.settings.monthly.pension)||0)+Math.max(0,Number(state.settings.monthly.irp)||0)+Math.max(0,Number(monthlyExtra)||0);
  const rm=monthlyRate(annualRate);let balance=Math.max(0,Number(startAsset)||0),cumulative=totalPrincipal();
  const rows=[{age:state.profile.age,end:balance,cumulative,operating:balance-cumulative}];
  for(let y=0;y<years;y++){
    for(let m=0;m<12;m++){balance*=1+rm;balance+=monthly}
    cumulative+=monthly*12;rows.push({age:state.profile.age+y+1,end:balance,cumulative,operating:balance-cumulative});
  }
  return rows;
}
function realMonthlyWithdrawal(futureAsset,{retirementAge=state.profile.retirementAge,withdrawYears=state.settings.withdrawYears,withdrawReturn=state.settings.withdrawReturn,inflation=state.settings.inflation}={}){
  const yearsToRetire=Math.max(0,Number(retirementAge)-Number(state.profile.age));
  const factor=Math.pow(1+Number(inflation||0)/100,yearsToRetire);
  const assetToday=Math.max(0,Number(futureAsset)||0)/Math.max(0.0001,factor);
  const realAnnual=(1+Number(withdrawReturn||0)/100)/(1+Number(inflation||0)/100)-1;
  const r=Math.pow(Math.max(0.0001,1+realAnnual),1/12)-1;
  const n=Math.max(12,Math.round(Number(withdrawYears||30)*12));
  const monthly=Math.abs(r)<1e-9?assetToday/n:assetToday*r/(1-Math.pow(1+r,-n));
  return {realMonthly:Math.max(0,monthly),nominalFirstMonthly:Math.max(0,monthly*factor),assetToday,realAnnual,months:n,factor};
}
function retirementScenario({annualRate=state.settings.returnRate,monthlyExtra=0,retirementAge=state.profile.retirementAge}={}){
  const projection=accumulationProjection({annualRate,monthlyExtra,retirementAge});
  const futureAsset=projection.at(-1)?.end||0;
  return {projection,futureAsset,...realMonthlyWithdrawal(futureAsset,{retirementAge})};
}
function retirementOutlook(){
  const base=retirementScenario();
  const conservative=retirementScenario({annualRate:Number(state.settings.returnRate)-2});
  const optimistic=retirementScenario({annualRate:Number(state.settings.returnRate)+1});
  const goal=Math.max(0,Number(state.settings.goalMonthly)||0);
  const progress=goal?base.realMonthly/goal*100:100;
  return {base,conservative,optimistic,goal,progress:clamp(progress,0,999),gap:goal-base.realMonthly};
}
function classTotals(scope='all'){
  const totals={};
  const accounts=scope==='all'?Object.values(state.accounts):[state.accounts[scope]];
  for(const a of accounts.filter(Boolean)){
    for(const h of a.holdings||[])totals[h.class]=(totals[h.class]||0)+Number(h.value||0);
    totals.cash=(totals.cash||0)+Number(a.cash||0);
  }
  return totals;
}
function allocationRows(scope='all'){
  const totals=classTotals(scope),total=Object.values(totals).reduce((s,n)=>s+n,0);
  return state.settings.assetClasses.map(c=>({id:c.id,name:c.name,target:Number(c.target)||0,riskWeight:Number(c.riskWeight)||0,value:Number(totals[c.id])||0,current:total?(Number(totals[c.id])||0)/total*100:0})).map(r=>({...r,diff:r.current-r.target}));
}
function topHolding(scope='all'){
  const list=(scope==='all'?Object.values(state.accounts):[state.accounts[scope]]).filter(Boolean).flatMap(a=>a.holdings||[]);
  const total=scopeTotal(scope);const holding=[...list].sort((a,b)=>Number(b.value)-Number(a.value))[0]||null;
  return {holding,pct:holding&&total?Number(holding.value)/total*100:0};
}
function irpRiskStatus(){
  const a=state.accounts.irp,total=accountTotal(a);const known=(a.holdings||[]).filter(h=>typeof h.risk==='boolean');
  const risk=known.filter(h=>h.risk).reduce((s,h)=>s+Number(h.value||0),0);
  const unknown=(a.holdings||[]).filter(h=>typeof h.risk!=='boolean').reduce((s,h)=>s+Number(h.value||0),0);
  return {total,riskValue:risk,unknownValue:unknown,riskPct:total?risk/total*100:0,unknownPct:total?unknown/total*100:0,remainingPct:total?Math.max(0,70-risk/total*100):70};
}
function freshnessDays(){
  const raw=String(state.lastUpdated||'').replace(/\./g,'-');const t=Date.parse(raw);return Number.isFinite(t)?Math.max(0,Math.floor((Date.now()-t)/86400000)):9999;
}
function contributionConsistency(months=12){
  const expected=[];let d=new Date(CURRENT_YEAR,CURRENT_MONTH-1,1);
  for(let i=0;i<months;i++){const key=`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;expected.push(key);d=new Date(d.getFullYear(),d.getMonth()-1,1)}
  let planned=0,done=0;
  for(const key of expected)for(const accountKey of ['pension','irp'])if(Number(state.settings.monthly[accountKey])>0){planned++;if(currentContributionStatus(key)[accountKey])done++}
  return {planned,done,pct:planned?done/planned*100:100};
}
function cashflowSeries(scope='all'){
  const years=[...new Set([...Object.keys(state.years||{}).map(Number),...activeRecords().map(r=>Number(r.year||String(r.date||'').slice(0,4))).filter(Number.isFinite)])].sort((a,b)=>a-b);
  return years.map(year=>({year,dividend:yearDividend(year,scope),realized:yearRealized(year,scope)}));
}
function holdingsDividendRank(scope='all'){
  const map={};
  for(const r of activeRecords())if(['dividend','dividend-adjustment','dividend-account-allocation'].includes(r.type)&&(scope==='all'||r.accountKey===scope)){const name=r.assetName||'계좌 미지정';map[name]=(map[name]||0)+Number(r.amount||0)}
  return Object.entries(map).sort((a,b)=>b[1]-a[1]);
}
function chartPath(values,width=300,height=150,pad=16){
  const nums=values.map(v=>Number(v)||0),max=Math.max(1,...nums),min=Math.min(0,...nums),range=Math.max(1,max-min);
  const points=nums.map((v,i)=>({x:pad+(width-pad*2)*(nums.length<=1?0:i/(nums.length-1)),y:height-pad-(height-pad*2)*(v-min)/range,value:v}));
  return {points,path:points.map((p,i)=>`${i?'L':'M'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' '),max,min,width,height,pad};
}
window.PensionEngine={accountTotal,totalAsset,totalPrincipal,accountReturn,totalReturn,scopeTotal,scopePrincipal,performanceSeries,currentContributionStatus,annualContributionStatus,accumulationProjection,realMonthlyWithdrawal,retirementScenario,retirementOutlook,classTotals,allocationRows,topHolding,irpRiskStatus,freshnessDays,contributionConsistency,cashflowSeries,holdingsDividendRank,chartPath,activeRecords};
