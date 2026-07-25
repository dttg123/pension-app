/* 개인연금 V3.1.1 연금 코치·OCR */

/* ===== js/90-coach-ocr.js ===== */
(()=>{
'use strict';
const V12_VERSION='3.1.1';
const V12_ENGINE='coach-rules-1.0';
const V12_KEYS=['pension','irp'];
const V12_LABEL={pension:'연금저축',irp:'IRP'};
const v12N=v=>Number.isFinite(Number(v))?Number(v):0;
const v12Iso=()=>new Date().toISOString();
const v12DaysSince=value=>{const d=new Date(String(value||'').replace(/\./g,'-')+'T00:00:00');return Number.isNaN(d.getTime())?null:Math.max(0,Math.floor((Date.now()-d.getTime())/86400000))};
function v12StripTransient(value,seen=new WeakSet()){
  if(!value||typeof value!=='object'||seen.has(value))return value;seen.add(value);
  for(const key of Object.keys(value)){
    if(/^(photo|photoData|image|imageData|ocrImage|ocrFile|blob|blobUrl|objectUrl|previewUrl)$/i.test(key)){delete value[key];continue}
    const child=value[key];
    if(typeof child==='string'&&(/^(data:image\/|blob:)/i.test(child)))value[key]='';
    else v12StripTransient(child,seen);
  }
  return value;
}
function v12PrivacyAudit(s=state){
  let text='';try{text=JSON.stringify(s)}catch(_){return {ok:false,issues:['데이터를 문자열로 검사할 수 없습니다.']}}
  const issues=[];if(/data:image\//i.test(text))issues.push('이미지 데이터가 상태에 포함됨');if(/blob:/i.test(text))issues.push('임시 사진 주소가 상태에 포함됨');
  return {ok:!issues.length,issues};
}
function v12Audit(s=state){
  const errors=[],warnings=[];const num=(v,label,nonNegative=false)=>{if(!Number.isFinite(Number(v)))errors.push(`${label} 숫자 오류`);else if(nonNegative&&Number(v)<0)errors.push(`${label} 음수 오류`)};
  if(s?.appId!=='asset-os-pension')errors.push('앱 종류 불일치');
  for(const key of V12_KEYS){const a=s?.accounts?.[key];if(!a){errors.push(`${V12_LABEL[key]} 계좌 없음`);continue}num(a.principal,`${V12_LABEL[key]} 순납입`,true);num(a.cash,`${V12_LABEL[key]} 현금`,true);if(!Array.isArray(a.holdings))errors.push(`${V12_LABEL[key]} 보유상품 형식 오류`);else{const names=new Set();for(const [i,h] of a.holdings.entries()){if(!String(h.name||'').trim())errors.push(`${V12_LABEL[key]} ${i+1}번 종목명 없음`);const name=String(h.name||'').trim();if(names.has(name))warnings.push(`${V12_LABEL[key]} 중복 종목: ${name}`);names.add(name);num(h.qty,`${name} 수량`,true);num(h.value,`${name} 평가금`,true);num(h.cost,`${name} 원금`,true)}}}
  for(const [year,row] of Object.entries(s?.years||{})){if(!/^\d{4}$/.test(String(year)))warnings.push(`비정상 연도 키 ${year}`);for(const f of ['start','end','cumulative','contribution','operating','realized','return','dividend'])num(row?.[f],`${year} ${f}`);if(!Array.isArray(row?.monthly)||row.monthly.length!==12)errors.push(`${year} 월별 배열 오류`)}
  const ids=new Set(),dupes=new Set();for(const r of s?.ledger||[]){if(!r?.id){errors.push('원장 ID 없음');continue}if(ids.has(r.id))dupes.add(r.id);ids.add(r.id);if(r.accountKey&&!V12_KEYS.includes(r.accountKey))warnings.push(`알 수 없는 계좌 ${r.accountKey}`);if(!Number.isFinite(Number(r.amount)))errors.push(`원장 금액 오류 ${r.id}`)}if(dupes.size)errors.push(`원장 중복 ID ${dupes.size}건`);
  const contributionSeen=new Set();for(const r of s?.ledger||[]){if(r.status==='void'||r.type!=='contribution')continue;const month=String(r.monthKey||String(r.date||'').slice(0,7)),key=r.accountKey||String(r.accountId||'').replace('account-',''),k=`${month}|${key}`;if(contributionSeen.has(k))errors.push(`중복 납입 ${k}`);contributionSeen.add(k)}
  const privacy=v12PrivacyAudit(s);errors.push(...privacy.issues);
  return {ok:!errors.length,errors:[...new Set(errors)],warnings:[...new Set(warnings)],counts:{years:Object.keys(s?.years||{}).length,ledger:(s?.ledger||[]).length,holdings:V12_KEYS.reduce((n,k)=>n+(s?.accounts?.[k]?.holdings?.length||0),0)}};
}
function v12ProjectAt(monthlyExtra=0,rateDelta=0){
  const years=Math.max(0,v12N(state.profile?.retirementAge)-v12N(state.profile?.age)),annual=v12N(state.settings?.returnRate)+rateDelta,rm=Math.pow(Math.max(.01,1+annual/100),1/12)-1,monthly=Math.max(0,v12N(state.settings?.monthly?.pension))+Math.max(0,v12N(state.settings?.monthly?.irp))+monthlyExtra;let bal=Math.max(0,totalAsset());for(let y=0;y<years;y++)for(let m=0;m<12;m++){bal*=1+rm;bal+=monthly}return bal;
}
function v12GoalMonthlyFor(asset){const sim=withdrawalSim(Math.max(0,asset),'balanced');return presentValueMonthly(sim.startMonthly)}
function v12ContributionInfo(){
  const status=currentContributionStatus(),planned=V12_KEYS.filter(k=>v12N(state.settings?.monthly?.[k])>0),missing=planned.filter(k=>!status[k]),row=state.years?.[CURRENT_YEAR]||{},paid=Math.max(0,v12N(row.contribution)),annualPlan=planned.reduce((n,k)=>n+v12N(state.settings.monthly[k])*12,0),expected=annualPlan*(CURRENT_MONTH/12),limit=Math.max(0,v12N(state.settings?.annualContributionLimit)||18000000);return {planned,missing,paid,annualPlan,expected,limit};
}
function v12AllocationInfo(){
  const totals=classTotals(),total=Object.values(totals).reduce((n,v)=>n+v12N(v),0)||1,rows=(state.settings?.assetClasses||[]).map(c=>({name:c.name,id:c.id,current:v12N(totals[c.id])/total*100,target:v12N(c.target),diff:v12N(totals[c.id])/total*100-v12N(c.target)})),under=[...rows].sort((a,b)=>a.diff-b.diff)[0],over=[...rows].sort((a,b)=>b.diff-a.diff)[0];const holdings=V12_KEYS.flatMap(k=>(state.accounts?.[k]?.holdings||[]).map(h=>({...h,accountKey:k}))).sort((a,b)=>v12N(b.value)-v12N(a.value)),top=holdings[0],topPct=top?v12N(top.value)/total*100:0;return {rows,under,over,top,topPct,total}}
function v12IrpRisk(){const a=state.accounts?.irp,total=a?accountTotal(a):0,risk=total?(a.holdings||[]).filter(h=>h.risk!==false).reduce((n,h)=>n+v12N(h.value),0)/total*100:0;return risk}
function v12Coach(){
  const yearsLeft=Math.max(0,v12N(state.profile?.retirementAge)-v12N(state.profile?.age)),freshDays=v12DaysSince(state.lastUpdated),contrib=v12ContributionInfo(),alloc=v12AllocationInfo(),goal=goalStatus(),currentYear=state.years?.[CURRENT_YEAR]||{},latestReturn=v12N(currentYear.return),irpRisk=v12IrpRisk(),extraAsset=v12ProjectAt(100000,0),extraReal=v12GoalMonthlyFor(extraAsset),lowerAsset=v12ProjectAt(0,-1),lowerReal=v12GoalMonthlyFor(lowerAsset),issues=[];
  const add=(priority,kind,title,action,reason)=>issues.push({priority,kind,title,action,reason});
  if(freshDays==null||freshDays>45)add(100,'action','자산현황부터 한 번 갱신하세요','잔고 화면을 읽어 최신 금액으로 바꾸기',freshDays==null?'갱신일을 확인할 수 없어 다른 판단보다 최신화가 먼저입니다.':`${freshDays}일 전 자료라 목표와 비중 판단이 흔들릴 수 있습니다.`);
  if(contrib.missing.length)add(90,'action','이번 달은 납입 기록만 마치면 됩니다',`${contrib.missing.map(k=>V12_LABEL[k]).join('·')} 납입 기록`,`${CURRENT_MONTH}월 계획 중 아직 완료되지 않은 계좌가 있습니다.`);
  const behind=contrib.annualPlan>0&&contrib.paid+1<contrib.expected-v12N(state.settings?.monthly?.pension)-v12N(state.settings?.monthly?.irp);if(behind)add(75,'watch','납입 속도가 계획보다 조금 늦습니다','밀린 달을 확인하고 이번 달부터 정상화',`현재 ${fmt(contrib.paid)}로 이 시점 계획치 ${fmt(contrib.expected)}보다 낮습니다.`);
  if(alloc.topPct>45)add(70,'watch','새 돈은 가장 큰 종목에 더 넣지 않는 편이 낫습니다',`${alloc.under?.name||'부족 자산군'} 쪽으로 다음 납입 배분`,`${alloc.top?.name||'상위 종목'}이 전체의 ${alloc.topPct.toFixed(1)}%를 차지합니다.`);
  else if(alloc.under&&alloc.under.diff<-12)add(65,'watch','다음 납입 방향만 바꾸면 됩니다',`${alloc.under.name}을 다음 납입에서 우선`, `목표 비중보다 ${Math.abs(alloc.under.diff).toFixed(1)}%p 낮아 매도보다 신규 납입으로 조정하는 편이 단순합니다.`);
  if(irpRisk>70.2)add(62,'watch','IRP 위험자산 분류를 확인하세요','증권사 화면에서 실제 위험자산 인정 비율 확인',`앱 추정치는 ${irpRisk.toFixed(1)}%입니다. 상품별 실제 분류가 우선입니다.`);
  if(goal.p<65)add(60,'plan','목표는 수익률보다 납입액부터 조정하는 편이 안전합니다','월 10만원 추가 시나리오를 먼저 비교',`현재가치 목표 달성률은 약 ${goal.p.toFixed(0)}%이며, 월 10만원 추가 시 예상 월연금은 약 ${man(extraReal)}입니다.`);
  else if(goal.p<90)add(48,'plan','계획은 유지하되 작은 보완만 검토하세요','월 10만원 추가와 은퇴 1년 연기를 비교',`현재가치 기준 목표까지 약 ${man(Math.max(0,goal.gap))} 차이가 있습니다.`);
  if(latestReturn<-12&&yearsLeft>=15)add(35,'calm','하락만 보고 구조를 바꿀 단계는 아닙니다','이번 달 납입과 목표 비중만 유지',`연금 개시까지 ${yearsLeft}년이 남아 있고 올해 단기 수익률은 장기 계획의 일부에 불과합니다.`);
  issues.sort((a,b)=>b.priority-a.priority);let primary=issues[0];if(!primary)primary={kind:'good',title:'지금은 계획을 유지해도 됩니다',action:'이번 달 납입 후 다음 갱신일까지 그대로 유지',reason:'납입·데이터 최신성·목표·비중에서 급히 바꿀 항목이 보이지 않습니다.'};
  const secondary=issues.filter(x=>x!==primary).slice(0,2);let score=100;if(freshDays==null||freshDays>45)score-=18;if(contrib.missing.length)score-=14;if(behind)score-=10;if(alloc.topPct>45)score-=14;else if(alloc.under&&alloc.under.diff<-12)score-=8;if(goal.p<65)score-=18;else if(goal.p<90)score-=8;if(irpRisk>70.2)score-=12;score=clamp(score,0,100);
  return {version:V12_ENGINE,score,status:score>=85?'안정':score>=65?'점검':'우선 확인',primary,secondary,evidence:{goalPct:goal.p,monthlyGoal:goal.real,paid:contrib.paid,annualPlan:contrib.annualPlan,freshDays,topPct:alloc.topPct,yearsLeft,latestReturn,lowerReal,extraReal},caution:'예상 월연금과 미래 자산은 입력한 수익률·물가·수령 가정에 따른 추정치이며 보장 금액이 아닙니다.'};
}
function v12CoachCardHtml(c){const tag=c.primary.kind==='good'?'그대로 유지':c.primary.kind==='calm'?'급한 변경 없음':'한 가지만 확인';return `<button class="v12Coach" id="homeCoach"><div class="v12CoachTop"><span class="v12CoachLabel">연금 코치</span><span class="v12CoachState">${esc(tag)}</span></div><h3>${esc(c.primary.title)}</h3><p>${esc(c.primary.reason)}</p><div class="v12CoachAction"><span>${esc(c.primary.action)}</span><span>›</span></div></button>`}
const v12PrevSave=save;
save=function(){v12StripTransient(state);state.meta=state.meta||{};state.meta.appVersion=V12_VERSION;state.meta.coachEngine=V12_ENGINE;state.meta.lastDataAudit=v12Iso();const audit=v12Audit(state);state.meta.lastDataAuditResult={ok:audit.ok,errorCount:audit.errors.length,warningCount:audit.warnings.length};v12PrevSave()};
const v12PrevHome=renderHome;
renderHome=function(){v12PrevHome();const stack=document.querySelector('#home .stack');if(!stack)return;const old=document.getElementById('homeCoach');old?.remove();const coach=v12Coach(),wrap=document.createElement('div');wrap.innerHTML=v12CoachCardHtml(coach);const contribution=document.getElementById('homeContribution');if(contribution)contribution.after(wrap.firstElementChild);else stack.appendChild(wrap.firstElementChild);document.getElementById('homeCoach').onclick=()=>{state.ui.analysisPanel='smart';navigate('analysis');renderAnalysis();save()};document.querySelectorAll('#home .v0Badge,#home .v1Badge').forEach(b=>{b.textContent='V3.1.1';b.classList.add('v12Version')})};
const v12PrevAnalysis=renderAnalysis;
renderAnalysis=function(){v12PrevAnalysis();const btn=document.querySelector('#analysis [data-analysis="smart"]');if(btn)btn.textContent='코치'};
const v12PrevAnalysisContent=renderAnalysisContent;
renderAnalysisContent=function(){if(state.ui.analysisPanel==='smart'){const el=document.getElementById('analysisContent');v12RenderSmart(el)}else v12PrevAnalysisContent()};
function v12RenderSmart(el){const c=v12Coach(),audit=v12Audit(state),items=[c.primary,...c.secondary];el.innerHTML=`<div class="stack"><div class="card v12CoachHero"><div class="row start"><div><div class="eyebrow">연금 코치 결론</div><div class="v12Decision">${esc(c.primary.title)}</div></div><span class="smartBadge">${esc(c.status)} · ${Math.round(c.score)}점</span></div><div class="v12Reason">${esc(c.primary.reason)}</div><div class="v12OneThing"><small>지금 할 일 하나</small><b>${esc(c.primary.action)}</b></div></div><div class="card"><div class="v12Evidence"><div><small>목표 달성 추정</small><b>${Math.round(c.evidence.goalPct)}%</b></div><div><small>올해 납입</small><b>${man(c.evidence.paid)}</b></div><div><small>마지막 갱신</small><b>${c.evidence.freshDays==null?'확인 필요':c.evidence.freshDays===0?'오늘':`${c.evidence.freshDays}일 전`}</b></div></div></div><div class="card"><div class="sectionTitle" style="margin:0 0 4px">판단을 줄여주는 순서</div><div class="v12CoachSteps">${items.map((x,i)=>`<div class="v12CoachStep"><i>${i+1}</i><div><b>${esc(x.action)}</b><p>${esc(x.reason)}</p></div></div>`).join('')}</div></div><div class="card"><div class="sectionTitle" style="margin:0 0 9px">작은 변화 비교</div><div class="summaryGrid"><div class="summaryBox"><small>수익률 −1%p</small><b>${man(c.evidence.lowerReal)}/월</b></div><div class="summaryBox"><small>월납입 +10만원</small><b>${man(c.evidence.extraReal)}/월</b></div></div><div class="v12AuditNote">수익률을 억지로 높이는 선택보다 납입액처럼 통제 가능한 변수를 먼저 비교합니다.</div></div>${audit.ok?'':`<div class="v12Caution"><b>데이터 확인 필요</b><br>${esc(audit.errors.slice(0,3).join(' · '))}</div>`}<div class="v12Model">${esc(c.caution)}<br>규칙 기반 코치 ${V12_ENGINE} · 외부 AI나 실시간 시장 전망을 사용하지 않습니다.</div></div>`};
const v12PrevSnapshot=renderSnapshotForm;
renderSnapshotForm=function(title,body){v12PrevSnapshot(title,body);const intro=body.querySelector('.ocrIntro');if(intro){const p=document.createElement('div');p.className='v12Privacy';p.innerHTML='<i>✓</i><div><b>원본 사진은 저장하지 않습니다.</b><br>브라우저 메모리에서 읽고, 확인한 종목·수량·금액만 저장합니다. 창을 닫으면 임시 사진 주소도 폐기합니다.</div>';intro.after(p)}const summary=document.getElementById('ocrSummary');if(summary&&!document.getElementById('v12OcrAudit')){const a=document.createElement('div');a.id='v12OcrAudit';a.className='v12OcrAudit';a.innerHTML='<div><small>사진 저장</small><b>0건 · 저장 안 함</b></div><div><small>반영 방식</small><b>사용자 확인 후 숫자만</b></div>';summary.before(a)}const file=document.getElementById('ocrFile');file?.addEventListener('change',()=>{state.meta=state.meta||{};state.meta.lastOcrStartedAt=v12Iso()});const apply=document.getElementById('ocrApply');apply?.addEventListener('click',()=>{state.meta=state.meta||{};state.meta.lastOcrConfirmedAt=v12Iso()},{capture:true})};
const v12PrevSettings=renderSettings;
renderSettings=function(){v12PrevSettings();const n=document.querySelector('#settingsBody .sheetNotice');if(n)n.innerHTML=`저장 버튼을 눌러야 반영됩니다. <b>앱 V${V12_VERSION}</b> · 사진 원본 저장 안 함`;const err=document.getElementById('settingsError');if(err&&!document.getElementById('v12SettingsAudit')){const audit=v12Audit(state),d=document.createElement('div');d.id='v12SettingsAudit';d.className='v12AuditNote';d.innerHTML=`데이터 자체점검: <b class="${audit.ok?'good':'bad'}">${audit.ok?'정상':`${audit.errors.length}건 확인 필요`}</b> · ${audit.counts.years}년 · 원장 ${audit.counts.ledger.toLocaleString('ko-KR')}건`;err.before(d)}};
function v12BuildScenario({years=30,recordsPerMonth=2,crash=false,pauseYears=0,huge=false}={}){const s=clone(state),start=CURRENT_YEAR-years+1;s.years={};s.accountYears={pension:{},irp:{}};s.ledger=[];let end=huge?9e12:1e7,cum=0;for(let y=start;y<=CURRENT_YEAR;y++){const paused=y<start+pauseYears,cont=paused?0:9000000,rate=crash&&[7,8,9].includes(y-start)?[-38,-24,11][y-start-7]:((y*17)%29-8),begin=end;cum+=cont;end=Math.max(0,(begin+cont)*(1+rate/100));s.years[y]={start:begin,end,cumulative:cum,contribution:cont,operating:end-begin-cont,realized:0,return:rate,dividend:Math.max(0,Math.round(end*.008)),reinvested:0,monthly:Array(12).fill(0),accountContribution:{pension:Math.round(cont*2/3),irp:Math.round(cont/3)}};for(const key of V12_KEYS){const ratio=key==='pension'?2/3:1/3;s.accountYears[key][y]={start:begin*ratio,end:end*ratio,cumulative:cum*ratio,contribution:cont*ratio,operating:(end-begin-cont)*ratio,realized:0,return:rate,dividend:s.years[y].dividend*ratio,reinvested:0,monthly:Array(12).fill(0)}}for(let m=1;m<=12;m++)for(let r=0;r<recordsPerMonth;r++)s.ledger.push({id:`stress-${y}-${m}-${r}`,type:r===0&&!paused?'contribution':'dividend-adjustment',date:`${y}-${String(m).padStart(2,'0')}-01T00:00:00.000Z`,monthKey:`${y}-${String(m).padStart(2,'0')}`,year:y,accountKey:r%2?'irp':'pension',accountId:r%2?'account-irp':'account-pension',amount:r===0&&!paused?750000:1000,source:'stress',synthetic:r!==0})}return s}
function v12Stress(){const cases=[['30년 정상',v12BuildScenario()],['30년 급락',v12BuildScenario({crash:true})],['5년 납입중단',v12BuildScenario({pauseYears:5})],['원장 1만건+',v12BuildScenario({recordsPerMonth:30})],['초고액',v12BuildScenario({huge:true})],['자산 0원',(()=>{const x=v12BuildScenario();for(const k of V12_KEYS){x.accounts[k].principal=0;x.accounts[k].cash=0;x.accounts[k].holdings=[]}return x})()]],results=[];for(const [name,s] of cases){v12StripTransient(s);const a=v12Audit(s);results.push({name,ok:a.ok,errors:a.errors,warnings:a.warnings,counts:a.counts})}const corrupt=v12BuildScenario();corrupt.ledger.push({...corrupt.ledger[0]});const rejected=!v12Audit(corrupt).ok;results.push({name:'중복 원장 거부',ok:rejected,errors:rejected?[]:['중복 원장을 거부하지 못함']});return {version:V12_VERSION,runAt:v12Iso(),ok:results.every(r=>r.ok),results}}
window.PensionV12={version:V12_VERSION,engine:V12_ENGINE,coach:v12Coach,audit:v12Audit,privacyAudit:v12PrivacyAudit,stripTransient:v12StripTransient,stress:v12Stress,buildScenario:v12BuildScenario};
state.meta=state.meta||{};state.meta.appVersion=V12_VERSION;state.meta.coachEngine=V12_ENGINE;v12StripTransient(state);document.title='개인연금 V3.1.1';renderAll(true);save();
})();

