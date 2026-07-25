/* 개인연금 V2.9.1 최종 셸: 버전 고정, 진단, 저장 후처리, PWA 갱신 */
(()=>{
'use strict';
const VERSION='2.9.1';
const BUILD='2026-07-25-v29-ui-input-settings-qa';
const ARCHITECTURE='modular-flat-v2-9-maintainable-21';
const MODULE_FILES=[
  'base.css','components.css','features.css','v21.css','v29.css',
  'core.js','ui.js','analysis.js','ocr.js','backup.js',
  'planning.js','ledger.js','coach.js','integrity.js','charts.js','v21.js','v29.js'
];
function currentState(){try{return typeof state!=='undefined'?state:(window.state||null)}catch(_){return window.state||null}}
function forceVersion({persist=true}={}){
  const s=currentState();
  if(!s)return;
  s.meta=s.meta||{};
  s.meta.appVersion=VERSION;
  s.meta.buildArchitecture=ARCHITECTURE;
  if(typeof coreEnsureSchema6==='function')coreEnsureSchema6(s);s.schemaVersion=Number(s.schemaVersion)||6;if(s.meta?.compatibilityReadOnly)persist=false;
  if(persist){
    try{if(typeof STORAGE!=='undefined')localStorage.setItem(STORAGE,JSON.stringify(s))}catch(_){ }
    try{if(typeof putDB==='function')putDB()}catch(_){ }
    try{if(typeof v1QueuePersist==='function')v1QueuePersist()}catch(_){ }
  }
}
function fixVersionUI(){
  document.title='개인연금 V2.9.1';
  document.querySelectorAll('.v0Badge,.v1Badge').forEach(b=>{b.textContent='V2.9.1';b.classList.add('v12Version')});
  const notice=document.querySelector('#settingsBody .sheetNotice');
  if(notice)notice.textContent='저장 버튼을 눌러야 반영됩니다. 앱 V2.9.1 · 데이터 구조 6 · 사진 원본 저장 안 함';
}
function moduleAudit(){
  const resources=performance.getEntriesByType('resource').map(x=>{
    try{return new URL(x.name,location.href).pathname}catch(_){return String(x.name||'')}
  });
  const missing=MODULE_FILES.filter(file=>!resources.some(path=>path.endsWith('/'+file)||path.endsWith(file)));
  return {ok:missing.length===0,expected:MODULE_FILES.length,missing};
}
function identityAudit(s=currentState()){
  const errors=[],ids=new Set(),add=(id,label)=>{if(!id)errors.push(`${label} ID 없음`);else if(ids.has(id))errors.push(`${label} ID 중복`);else ids.add(id)};
  if(!s)return {ok:false,errors:['데이터 없음']};if(s.appId!=='asset-os-pension')errors.push('앱 식별자 불일치');if(!String(s.dataId||'').startsWith('pension-data-'))errors.push('데이터 원본 ID 없음');if(Number(s.schemaVersion)!==6)errors.push('데이터 구조 6 아님');if(s.meta?.identityContractVersion!=='1.0')errors.push('ID 계약 1.0 아님');
  for(const key of ['pension','irp']){const a=s.accounts?.[key];add(a?.id,`${key} 계좌`);if(a?.id!==`account-${key}`)errors.push(`${key} 계좌 표준 ID 불일치`);for(const h of a?.holdings||[]){add(h.id,`${key} 보유상품`);if(h.accountId!==a.id)errors.push(`${h.name||h.id} 계좌 참조 불일치`)}}
  for(const r of s.ledger||[])add(r.id,'원장');for(const x of s.snapshots||[])add(x.id,'스냅샷');const archiveIds=new Set();for(const x of s.archives?.holdings||[]){if(!x.archiveId||archiveIds.has(x.archiveId))errors.push('보관 ID 없음 또는 중복');archiveIds.add(x.archiveId)}
  return {ok:errors.length===0,errors:[...new Set(errors)],dataId:s.dataId,activeIds:ids.size,archivedHoldings:(s.archives?.holdings||[]).length,contractVersion:s.meta?.identityContractVersion||null};
}
function health(){
  const s=currentState();
  const audit=window.PensionV12?.audit?.(s);
  const privacy=window.PensionV12?.privacyAudit?.(s);
  return {
    version:VERSION,
    build:BUILD,
    schemaVersion:Number(s?.schemaVersion)||null,dataId:s?.dataId||null,identity:identityAudit(s),
    ledgerSchemaVersion:Number(s?.meta?.ledgerSchemaVersion)||null,
    modules:moduleAudit(),
    data:audit||{ok:false,errors:['감사 엔진이 준비되지 않았습니다.']},
    privacy:privacy||{ok:false,issues:['개인정보 감사 엔진이 준비되지 않았습니다.']},
    localStorageAvailable:(()=>{try{return typeof STORAGE!=='undefined'&&Boolean(localStorage.getItem(STORAGE))}catch(_){return false}})(),
    cloudConnected:Boolean(window.PensionStorageAdapters?.cloud?.save),
    driveConnected:Boolean(window.PensionStorageAdapters?.drive?.upload)
  };
}

/* 하위 모듈이 과거 버전 문자열을 다시 쓰더라도 최종 저장값은 항상 2.9.1으로 고정한다. */
if(typeof save==='function'){
  const previousSave=save;
  save=function(){
    const result=previousSave.apply(this,arguments);
    forceVersion({persist:true});
    fixVersionUI();
    return result;
  };
}
if(typeof renderHome==='function'){
  const previousHome=renderHome;
  renderHome=function(){const result=previousHome.apply(this,arguments);fixVersionUI();return result};
}
if(typeof renderSettings==='function'){
  const previousSettings=renderSettings;
  renderSettings=function(){const result=previousSettings.apply(this,arguments);fixVersionUI();return result};
}
if(typeof closeSheet==='function'){
  const previousClose=closeSheet;
  closeSheet=function(){
    const result=previousClose.apply(this,arguments);
    const restoreFab=()=>{
      try{
        const fab=document.getElementById('fab'),screen=currentState()?.ui?.screen||'home';
        if(fab&&['home','account'].includes(screen)&&!document.querySelector('.overlay.open'))fab.classList.add('fabVisible');
      }catch(_){ }
    };
    setTimeout(restoreFab,60);
    setTimeout(restoreFab,220);
    return result;
  };
}


/* 과거 연도 입력은 전체 시계열과 월별 원장을 함께 재조정한다. */
const HISTORY_SOURCE='v2-history-reconciliation';
const ACCOUNT_KEYS=['pension','irp'];
const ACCOUNT_LABELS={pension:'연금저축',irp:'IRP'};
const num=value=>Number.isFinite(Number(value))?Number(value):0;
const historyUid=(prefix='history')=>`${prefix}-${crypto.randomUUID?.()||`${Date.now()}-${Math.random().toString(16).slice(2)}`}`;
function normalizeYearRow(row={}){
  const next={...row};
  for(const key of ['start','end','cumulative','contribution','operating','realized','return','dividend','reinvested'])next[key]=num(next[key]);
  next.monthly=Array.isArray(next.monthly)?next.monthly.slice(0,12).map(num):Array(12).fill(0);
  while(next.monthly.length<12)next.monthly.push(0);
  return next;
}
function parseHistoryRows(text){
  const rows=[],errors=[];
  String(text||'').split(/\n+/).forEach((raw,index)=>{
    const line=raw.trim();if(!line)return;
    const parts=line.split(/\s*[|\t]\s*/);
    if(parts.length<3){errors.push(`${index+1}번째 줄 형식`);return}
    const year=Number(String(parts[0]).replace(/[^0-9]/g,''));
    const end=typeof parseMoney==='function'?parseMoney(parts[1]):Number(String(parts[1]).replace(/[^0-9.-]/g,''));
    const cumulative=typeof parseMoney==='function'?parseMoney(parts[2]):Number(String(parts[2]).replace(/[^0-9.-]/g,''));
    const dividend=typeof parseMoney==='function'?parseMoney(parts[3]||0):Number(String(parts[3]||0).replace(/[^0-9.-]/g,''));
    if(!Number.isInteger(year)||year<1900||year>CURRENT_YEAR||![end,cumulative,dividend].every(Number.isFinite)||end<0||cumulative<0||dividend<0){errors.push(`${index+1}번째 줄 값`);return}
    rows.push({year,end,cumulative,dividend});
  });
  rows.sort((a,b)=>a.year-b.year);
  if(rows.length>30)errors.push('한 번에 최대 30년');
  const duplicates=rows.filter((row,index)=>rows.findIndex(x=>x.year===row.year)!==index).map(x=>x.year);
  if(duplicates.length)errors.push(`중복 연도 ${duplicates[0]}`);
  return {rows,errors};
}
function validateHistoryMap(map){
  const years=Object.keys(map||{}).map(Number).sort((a,b)=>a-b),errors=[];let previousEnd=null,previousCumulative=0;
  for(const year of years){
    const row=normalizeYearRow(map[year]);
    if(row.end<0||row.cumulative<0||row.dividend<0)errors.push(`${year}년 음수 값`);
    if(row.cumulative+0.5<previousCumulative)errors.push(`${year}년 누적 순납입이 이전 연도보다 작음`);
    const contribution=row.cumulative-previousCumulative;
    if(contribution<-.5)errors.push(`${year}년 납입 계산 오류`);
    previousEnd=row.end;previousCumulative=row.cumulative;
  }
  return {ok:errors.length===0,errors,years};
}
function recomputeMap(map,currentAccountKey=''){
  const years=Object.keys(map||{}).map(Number).sort((a,b)=>a-b);let previousEnd=0,previousCumulative=0;
  for(const year of years){
    const row=map[year]=normalizeYearRow(map[year]);
    if(year===CURRENT_YEAR){
      if(currentAccountKey){const account=state.accounts[currentAccountKey];row.end=accountTotal(account);row.cumulative=num(account.principal)}
      else{row.end=totalAsset();row.cumulative=totalPrincipal()}
    }
    row.start=previousEnd;
    row.contribution=Math.max(0,row.cumulative-previousCumulative);
    row.operating=row.end-row.start-row.contribution;
    const base=row.start+row.contribution/2;row.return=base?row.operating/base*100:0;
    previousEnd=row.end;previousCumulative=row.cumulative;
  }
}
function ratio(part,total,fallback=.5){return total>0?Math.max(0,Math.min(1,part/total)):fallback}
function splitOverallIntoAccounts(){
  state.accountYears=state.accountYears||{pension:{},irp:{}};
  const currentAsset=totalAsset()||1,currentPrincipal=totalPrincipal()||1;
  const fallbackAsset=accountTotal(state.accounts.pension)/currentAsset;
  const fallbackPrincipal=num(state.accounts.pension.principal)/currentPrincipal;
  for(const year of Object.keys(state.years||{}).map(Number).sort((a,b)=>a-b)){
    const overall=normalizeYearRow(state.years[year]);
    const pOld=normalizeYearRow(state.accountYears.pension?.[year]||{}),iOld=normalizeYearRow(state.accountYears.irp?.[year]||{});
    const endRatio=ratio(pOld.end,pOld.end+iOld.end,fallbackAsset);
    const cumulativeRatio=ratio(pOld.cumulative,pOld.cumulative+iOld.cumulative,fallbackPrincipal);
    const dividendRatio=ratio(pOld.dividend,pOld.dividend+iOld.dividend,endRatio);
    const p=state.accountYears.pension[year]=pOld,i=state.accountYears.irp[year]=iOld;
    p.end=Math.round(overall.end*endRatio);i.end=overall.end-p.end;
    p.cumulative=Math.round(overall.cumulative*cumulativeRatio);i.cumulative=overall.cumulative-p.cumulative;
    p.dividend=Math.round(overall.dividend*dividendRatio);i.dividend=overall.dividend-p.dividend;
  }
  recomputeMap(state.accountYears.pension,'pension');
  recomputeMap(state.accountYears.irp,'irp');
}
function sumAccountsIntoOverall(){
  state.years=state.years||{};
  const years=new Set([...Object.keys(state.accountYears?.pension||{}),...Object.keys(state.accountYears?.irp||{}),...Object.keys(state.years||{})].map(Number));
  for(const year of [...years].sort((a,b)=>a-b)){
    const p=normalizeYearRow(state.accountYears?.pension?.[year]||{}),i=normalizeYearRow(state.accountYears?.irp?.[year]||{}),old=normalizeYearRow(state.years[year]||{});
    state.years[year]={...old,end:p.end+i.end,cumulative:p.cumulative+i.cumulative,dividend:p.dividend+i.dividend};
  }
  recomputeMap(state.years,'');
}
function addHistoryLedger(type,year,amount,{accountKey='',assetName=''}={}){
  if(Math.abs(amount)<.5)return;
  state.ledger.push({
    id:historyUid(type),type,date:`${year}-12-28T12:00:00.000Z`,monthKey:`${year}-12`,year,
    accountKey,accountId:accountKey?`account-${accountKey}`:'',assetName,amount,
    source:HISTORY_SOURCE,synthetic:true,note:'V2.9 과거 연도 입력 원장 조정',createdAt:new Date().toISOString(),ledgerSchemaVersion:2
  });
}
function reconcileHistoryLedger(){
  state.ledger=(state.ledger||[]).filter(row=>row.source!==HISTORY_SOURCE);
  window.PensionV11Ledger?.normalize?.();
  const base=window.PensionV11Ledger?.totals?.()||{years:{},accounts:{pension:{},irp:{}}};
  const years=Object.keys(state.years||{}).map(Number).sort((a,b)=>a-b);
  let prevOverall=0,prevPension=0,prevIrp=0;
  for(const year of years){
    const row=normalizeYearRow(state.years[year]),p=normalizeYearRow(state.accountYears?.pension?.[year]||{}),i=normalizeYearRow(state.accountYears?.irp?.[year]||{});
    const desiredTotal=Math.max(0,row.cumulative-prevOverall),desiredP=Math.max(0,p.cumulative-prevPension),desiredI=Math.max(0,i.cumulative-prevIrp);
    let targetP=desiredP,targetI=desiredI;
    if(Math.abs(targetP+targetI-desiredTotal)>.5){const share=ratio(targetP,targetP+targetI,ratio(num(base.accounts?.pension?.[year]?.contribution),num(base.years?.[year]?.contribution),.67));targetP=Math.round(desiredTotal*share);targetI=desiredTotal-targetP}
    addHistoryLedger('contribution-adjustment',year,targetP-num(base.accounts?.pension?.[year]?.contribution),{accountKey:'pension'});
    addHistoryLedger('contribution-adjustment',year,targetI-num(base.accounts?.irp?.[year]?.contribution),{accountKey:'irp'});
    addHistoryLedger('dividend-adjustment',year,row.dividend-num(base.years?.[year]?.dividend),{assetName:'과거기록 조정'});
    addHistoryLedger('dividend-account-allocation',year,p.dividend-num(base.accounts?.pension?.[year]?.dividend),{accountKey:'pension'});
    addHistoryLedger('dividend-account-allocation',year,i.dividend-num(base.accounts?.irp?.[year]?.dividend),{accountKey:'irp'});
    prevOverall=row.cumulative;prevPension=p.cumulative;prevIrp=i.cumulative;
  }
  window.PensionV11Ledger?.normalize?.();
  window.PensionV11Ledger?.rebuild?.();
  recomputeMap(state.accountYears.pension,'pension');recomputeMap(state.accountYears.irp,'irp');recomputeMap(state.years,'');
}
function historyRowsText(scope){
  const source=scope==='all'?state.years:(state.accountYears?.[scope]||{});
  return Object.keys(source||{}).map(Number).sort((a,b)=>a-b).slice(-30).map(year=>{const row=normalizeYearRow(source[year]);return `${year} | ${Math.round(row.end).toLocaleString('ko-KR')} | ${Math.round(row.cumulative).toLocaleString('ko-KR')} | ${Math.round(row.dividend).toLocaleString('ko-KR')}`}).join('\n');
}
function renderFinalHistoryForm(){
  const title=document.getElementById('formTitle'),body=document.getElementById('formBody');let scope=currentState()?.ui?.historyScope||'all';
  title.textContent='과거 연도 기록';
  body.innerHTML=`<div class="sheetNotice">입력한 연도를 기존 기록과 합친 뒤 전체 순서를 다시 검사합니다. 앞 연도를 수정하면 뒤 연도의 시작금액과 연간 납입도 자동 재계산합니다.</div><div class="scopeSegment">${['all','pension','irp'].map(key=>`<button data-v2-history-scope="${key}" class="${scope===key?'active':''}">${key==='all'?'전체':ACCOUNT_LABELS[key]}</button>`).join('')}</div><div class="field"><label>연도 | 연말 총자산 | 누적 순납입 | 연간 배당</label><textarea id="v2HistoryText" rows="14"></textarea><div class="historyExample">한 줄에 한 해 · 미래 연도 불가 · 최대 30년 입력 · 다른 연도는 유지</div></div><div class="settingsInfo historyPreview" id="v2HistoryPreview"></div><button class="btn primary full" id="v2ApplyHistory" style="margin-top:14px">전체 흐름 검사 후 반영</button>`;
  const textarea=document.getElementById('v2HistoryText'),preview=document.getElementById('v2HistoryPreview');
  const drawPreview=()=>{
    const parsed=parseHistoryRows(textarea.value),source=scope==='all'?state.years:(state.accountYears?.[scope]||{}),candidate=clone(source||{});
    for(const row of parsed.rows)candidate[row.year]={...normalizeYearRow(candidate[row.year]||{}),end:row.end,cumulative:row.cumulative,dividend:row.dividend};
    if(candidate[CURRENT_YEAR]){if(scope==='all'){candidate[CURRENT_YEAR].end=totalAsset();candidate[CURRENT_YEAR].cumulative=totalPrincipal()}else{candidate[CURRENT_YEAR].end=accountTotal(state.accounts[scope]);candidate[CURRENT_YEAR].cumulative=num(state.accounts[scope].principal)}}
    const validation=validateHistoryMap(candidate),errors=[...parsed.errors,...validation.errors];
    preview.innerHTML=`<b>${scope==='all'?'전체':ACCOUNT_LABELS[scope]} · ${parsed.rows.length}개 연도 입력</b><div class="previewList"><div class="previewItem"><span>입력 범위</span><b>${parsed.rows.length?`${parsed.rows[0].year}~${parsed.rows.at(-1).year}`:'-'}</b></div><div class="previewItem"><span>합친 전체 기록</span><b>${validation.years.length}년</b></div><div class="previewItem"><span>검사 결과</span><b class="${errors.length?'bad':'good'}">${errors.length?errors[0]:'연도 순서·누적 납입 정상'}</b></div></div>`;
    document.getElementById('v2ApplyHistory').disabled=Boolean(errors.length)||!parsed.rows.length;
  };
  const load=key=>{scope=key;state.ui.historyScope=key;document.querySelectorAll('[data-v2-history-scope]').forEach(button=>button.classList.toggle('active',button.dataset.v2HistoryScope===key));textarea.value=historyRowsText(key);drawPreview()};
  document.querySelectorAll('[data-v2-history-scope]').forEach(button=>button.onclick=()=>load(button.dataset.v2HistoryScope));textarea.oninput=drawPreview;load(scope);
  document.getElementById('v2ApplyHistory').onclick=()=>{
    const parsed=parseHistoryRows(textarea.value);if(parsed.errors.length||!parsed.rows.length)return toast(parsed.errors[0]||'과거 연도 자료를 입력하세요');
    const original=clone(state);
    try{
      const target=scope==='all'?state.years:(state.accountYears?.[scope]||(state.accountYears[scope]={}));
      for(const row of parsed.rows)target[row.year]={...normalizeYearRow(target[row.year]||{}),end:row.end,cumulative:row.cumulative,dividend:row.dividend};
      if(scope==='all'){recomputeMap(state.years,'');const valid=validateHistoryMap(state.years);if(!valid.ok)throw new Error(valid.errors[0]);splitOverallIntoAccounts()}
      else{recomputeMap(state.accountYears[scope],scope);const valid=validateHistoryMap(state.accountYears[scope]);if(!valid.ok)throw new Error(valid.errors[0]);state.meta.accountHistoryEstimated=state.meta.accountHistoryEstimated||{};state.meta.accountHistoryEstimated[scope]=false;sumAccountsIntoOverall()}
      const allValid=validateHistoryMap(state.years);if(!allValid.ok)throw new Error(allValid.errors[0]);
      reconcileHistoryLedger();
      const audit=window.PensionV12?.audit?.(state);if(audit&&!audit.ok)throw new Error(audit.errors[0]);
      save();closeSheet('formSheet');renderAll(true);toast(`${scope==='all'?'전체':ACCOUNT_LABELS[scope]} 과거 기록을 안전하게 반영했어요`);
    }catch(error){state=original;renderAll(true);toast(`반영하지 않았어요 · ${error?.message||error}`)}
  };
}
if(typeof quickForm==='function'){
  const previousQuick=quickForm;
  quickForm=function(type){if(type==='history'){document.getElementById('quickSheet')?.classList.remove('open');renderFinalHistoryForm();openSheet('formSheet',true);return}return previousQuick.apply(this,arguments)};
  document.querySelectorAll('[data-quick]').forEach(button=>button.onclick=()=>quickForm(button.dataset.quick));
}


/* 입력 날짜 경계와 과거 납입의 현재 잔고 오염을 막는다. */
const V2_TODAY=`${CURRENT_YEAR}-${String(CURRENT_MONTH).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
if(typeof renderContributionForm==='function'){
  renderContributionForm=function(title,body){
    title.textContent='납입 기록';const defaultMonth=CURRENT_KEY;
    body.innerHTML=`<div class="sheetNotice">이번 달이 기본이며, 놓친 달은 월을 바꿔 기록할 수 있어요. 미래 달은 기록할 수 없습니다.</div><div class="field"><label>기록 월</label><input id="contribMonth" type="month" value="${defaultMonth}" max="${CURRENT_KEY}"></div><div class="inputHelp" id="contribMonthHelp"></div><div id="contribChoices"></div><div class="settingsInfo" id="contribYearSummary" style="margin-top:10px"></div><button class="btn primary full" id="applyContribution" style="margin-top:14px">선택 계좌 기록</button>`;
    const draw=()=>{
      const input=document.getElementById('contribMonth'),monthKey=input.value||defaultMonth,valid=/^\d{4}-\d{2}$/.test(monthKey)&&monthKey<=CURRENT_KEY;
      const status=(state.runtime?.contributions?.[monthKey]||{pension:false,irp:false}),year=Number(monthKey.slice(0,4)),yr=state.years?.[year]||{contribution:0};
      const annual=(num(state.settings?.monthly?.pension)+num(state.settings?.monthly?.irp))*12,planned=ACCOUNT_KEYS.filter(k=>num(state.settings?.monthly?.[k])>0),missing=planned.filter(k=>!status[k]);
      const help=document.getElementById('contribMonthHelp'),host=document.getElementById('contribChoices'),button=document.getElementById('applyContribution');
      document.getElementById('contribYearSummary').innerHTML=`<b>${Number.isInteger(year)?year:'-'}년 납입 ${fmt(yr.contribution||0)}</b><div class="tiny" style="margin-top:4px">현재 계획 연 ${fmt(annual)} · 세액공제 한도와 실제 인정액은 별도 확인</div>`;
      if(!valid){help.textContent='미래 달은 기록할 수 없습니다.';host.innerHTML='<div class="settingsInfo bad">현재 달 이하로 선택하세요.</div>';button.disabled=true;return}
      help.textContent=monthKey===defaultMonth?'이번 달 기록만 현재 원금과 현금에도 반영돼요.':'과거 달 기록은 납입 이력만 보완하며 현재 원금·현금은 바꾸지 않아요.';
      if(!planned.length){host.innerHTML='<div class="settingsInfo">월 납입 계획이 없어요. 설정에서 월 납입액을 정하세요.</div>';button.disabled=true;return}
      if(!missing.length){host.innerHTML='<div class="settingsInfo">선택한 달의 계획된 납입이 모두 기록됐어요.</div>';button.disabled=true;return}
      button.disabled=false;host.innerHTML=missing.map(k=>`<label class="quickItem" style="margin-top:10px"><input type="checkbox" data-contrib="${k}" checked style="width:20px;height:20px"><span><b>${state.accounts[k].name}</b><small>${fmt(state.settings.monthly[k])}</small></span><span></span></label>`).join('');
    };
    const input=document.getElementById('contribMonth');input.onchange=draw;input.oninput=draw;draw();
    document.getElementById('applyContribution').onclick=()=>{
      const monthKey=input.value||defaultMonth;if(!/^\d{4}-\d{2}$/.test(monthKey)||monthKey>CURRENT_KEY)return toast('미래 달은 기록할 수 없어요');
      const keys=[...document.querySelectorAll('[data-contrib]:checked')].map(x=>x.dataset.contrib);if(!keys.length)return toast('기록할 계좌를 선택하세요');
      state.runtime=state.runtime||{};state.runtime.contributions=state.runtime.contributions||{};const status=state.runtime.contributions[monthKey]||{pension:false,irp:false};let recorded=0;
      for(const key of keys){
        if(status[key])continue;const amount=num(state.settings?.monthly?.[key]);if(amount<=0)continue;
        const isCurrent=monthKey===CURRENT_KEY;
        const result=window.PensionV11Ledger?.record?.(isCurrent?'contribution':'contribution-status',{date:`${monthKey}-01T00:00:00`,monthKey,accountKey:key,accountId:`account-${key}`,amount:isCurrent?amount:0,note:isCurrent?`${monthKey} ${state.accounts[key].name} 납입`:`${monthKey} ${state.accounts[key].name} 과거 납입 완료 확인`,source:isCurrent?'monthly-record':'past-month-status'});
        status[key]=true;
        if(result?.ok&&isCurrent){state.accounts[key].principal=num(state.accounts[key].principal)+amount;state.accounts[key].cash=num(state.accounts[key].cash)+amount}
        if(result?.ok)recorded++;
      }
      state.runtime.contributions[monthKey]=status;if(monthKey===CURRENT_KEY&&recorded)updateYearFromAssets();save();closeSheet('formSheet');renderAll(true);toast(recorded?`${monthKey.replace('-','년 ')}월 납입을 기록했어요`:'이미 기록된 납입을 확인했어요');
    };
  };
}
if(typeof renderDetailForm==='function'){
  const v2PreviousDetailForm=renderDetailForm;
  renderDetailForm=function(title,body){
    v2PreviousDetailForm(title,body);const date=document.getElementById('detailDate'),button=document.getElementById('applyDetail');if(!date||!button)return;
    date.max=V2_TODAY;const previous=button.onclick;
    button.onclick=()=>{if(!date.value||date.value>V2_TODAY)return toast('미래 날짜는 기록할 수 없어요');return previous?.()};
  };
}

/* 기본 감사에 연도 연속성·원장 합계 대조를 추가한다. */
if(window.PensionV12?.audit){
  const previousAudit=window.PensionV12.audit;
  window.PensionV12.audit=function(candidate=currentState()){
    const result=previousAudit(candidate),errors=[...(result.errors||[])],warnings=[...(result.warnings||[])];
    const years=Object.keys(candidate?.years||{}).map(Number).sort((a,b)=>a-b);let previousEnd=null,previousCumulative=0;
    for(const year of years){const row=normalizeYearRow(candidate.years[year]);if(previousEnd!==null&&Math.abs(row.start-previousEnd)>1)errors.push(`${year}년 시작금액이 이전 연말과 불일치`);if(row.cumulative+1<previousCumulative)errors.push(`${year}년 누적 순납입 감소`);const expected=Math.max(0,row.cumulative-previousCumulative);if(Math.abs(row.contribution-expected)>1)errors.push(`${year}년 연간 납입과 누적 순납입 불일치`);previousEnd=row.end;previousCumulative=row.cumulative}
    if(candidate===currentState()&&window.PensionV11Ledger?.totals){const totals=window.PensionV11Ledger.totals();for(const year of years){const row=candidate.years[year],ledger=totals.years?.[year]||{};if(Math.abs(num(row.contribution)-num(ledger.contribution))>1)errors.push(`${year}년 원장 납입 합계 불일치`);if(Math.abs(num(row.dividend)-num(ledger.dividend))>1)errors.push(`${year}년 원장 배당 합계 불일치`)}}
    return {...result,ok:errors.length===0,errors:[...new Set(errors)],warnings:[...new Set(warnings)]};
  };
}

window.PensionV20={
  version:VERSION,
  build:BUILD,
  health,
  moduleAudit,
  stress:()=>window.PensionV12?.stress?.(),
  coach:()=>window.PensionV12?.coach?.(),
  buildBackup:(data)=>window.PensionV1Data?.buildBackup?.(data||currentState()),
  verifyBackup:(bytes)=>window.PensionV1Data?.verifyBackup?.(bytes),
  buildProjectBackup:(data,assets)=>window.PensionV1Data?.buildProjectBackup?.(data||currentState(),assets),
  verifyProjectBackup:(bytes)=>window.PensionV1Data?.verifyProjectBackup?.(bytes),
  migrateImported:(data)=>window.PensionV1Data?.migrateImported?.(data),
  schemaContract:()=>({schemaVersion:6,contractVersion:'1.0',immutable:['appId','dataId','account.id','holding.id','ledger.id','snapshot.id'],deletionPolicy:'archive-not-destroy'}),identityAudit:()=>identityAudit(currentState()),stateSummary:()=>{const s=currentState();return {appId:s?.appId,dataId:s?.dataId,version:s?.meta?.appVersion,schemaVersion:s?.schemaVersion,identityContractVersion:s?.meta?.identityContractVersion,ledgerSchemaVersion:s?.meta?.ledgerSchemaVersion,revision:s?.meta?.revision,archivedHoldings:s?.archives?.holdings?.length||0}}
};

forceVersion({persist:true});
try{if(typeof renderAll==='function')renderAll(true)}catch(_){ }
fixVersionUI();

if('serviceWorker' in navigator&&location.protocol!=='file:'){
  window.addEventListener('load',async()=>{
    try{const registration=await navigator.serviceWorker.register('./sw.js');await registration.update()}catch(_){ }
  },{once:true});
}
})();

/* ===== V2.0 RC3 UX consolidation: analysis, diagnosis, contribution and profile ===== */
(()=>{
'use strict';
const UX_BUILD='2.9.1';
const UX_LABEL={all:'전체',pension:'연금저축',irp:'IRP'};
const uxN=v=>Number.isFinite(Number(v))?Number(v):0;
const uxMoney=v=>Math.max(0,parseMoney(v));
function uxEnsureProfile(){
  state.profile=state.profile||{};
  let birthYear=Number(state.profile.birthYear);
  if(!Number.isInteger(birthYear)||birthYear<CURRENT_YEAR-100||birthYear>CURRENT_YEAR-10){
    const legacyAge=clamp(uxN(state.profile.age)||32,18,80);birthYear=CURRENT_YEAR-legacyAge+1;
  }
  state.profile.birthYear=birthYear;
  state.profile.age=clamp(CURRENT_YEAR-birthYear+1,0,100);
  state.profile.retirementAge=clamp(uxN(state.profile.retirementAge)||65,40,90);
  state.meta=state.meta||{};state.meta.uxBuild=UX_BUILD;
  return state.profile.age;
}
function uxRows(scope='all'){
  const src=scope==='all'?(state.years||{}):(state.accountYears?.[scope]||{});
  return Object.keys(src).map(Number).filter(Number.isFinite).sort((a,b)=>a-b).map(year=>({year,...src[year]}));
}
function uxScope(active){return `<div class="scopeSegment uxScope">${['all','pension','irp'].map(k=>`<button data-ux-scope="${k}" class="${active===k?'active':''}">${UX_LABEL[k]}</button>`).join('')}</div>`}
function uxBindScope(el,renderer){el.querySelectorAll('[data-ux-scope]').forEach(btn=>btn.onclick=()=>{state.ui.analysisScope=btn.dataset.uxScope;state.ui.performanceIndex=999;renderer(el);save()})}
function uxTickLabels(data){const n=data.length;if(n<=6)return data.map((d,i)=>[i,String(d.year)]);const idx=[0,Math.round((n-1)/3),Math.round((n-1)*2/3),n-1];return [...new Set(idx)].map(i=>[i,String(data[i].year)])}
function uxAnalysisPanel(panel){return panel==='cashflow'?'i1':panel==='diagnosis'?'i2':''}
function uxNormalizePanel(){const map={dividend:'cashflow',allocation:'diagnosis',smart:'diagnosis'};state.ui.analysisPanel=map[state.ui.analysisPanel]||state.ui.analysisPanel;if(!['performance','cashflow','diagnosis'].includes(state.ui.analysisPanel))state.ui.analysisPanel='performance'}
renderAnalysis=function(){
  uxNormalizePanel();const root=document.getElementById('analysis');
  root.innerHTML=`<div class="segment three"><i class="segmentIndicator ${uxAnalysisPanel(state.ui.analysisPanel)}"></i><button data-analysis="performance" class="${state.ui.analysisPanel==='performance'?'active':''}">성과</button><button data-analysis="cashflow" class="${state.ui.analysisPanel==='cashflow'?'active':''}">현금흐름</button><button data-analysis="diagnosis" class="${state.ui.analysisPanel==='diagnosis'?'active':''}">진단</button></div><div id="analysisContent"></div>`;
  root.querySelectorAll('[data-analysis]').forEach(btn=>btn.onclick=()=>switchAnalysisPanel(btn.dataset.analysis));renderAnalysisContent();
};
switchAnalysisPanel=function(panel){uxNormalizePanel();if(state.ui.analysisPanel===panel)return;state.ui.analysisPanel=panel;const root=document.getElementById('analysis');root.querySelectorAll('[data-analysis]').forEach(btn=>btn.classList.toggle('active',btn.dataset.analysis===panel));root.querySelector('.segmentIndicator').className=`segmentIndicator ${uxAnalysisPanel(panel)}`;renderAnalysisContent();animatePanel('analysisContent');save()};
renderAnalysisContent=function(){const el=document.getElementById('analysisContent');if(!el)return;if(state.ui.analysisPanel==='performance')uxRenderPerformance(el);else if(state.ui.analysisPanel==='cashflow')uxRenderCashflow(el);else uxRenderDiagnosis(el)};
function uxRenderPerformance(el){
  const scope=['all','pension','irp'].includes(state.ui.analysisScope)?state.ui.analysisScope:'all',data=uxRows(scope);
  if(!data.length){el.innerHTML=uxScope(scope)+`<div class="card empty"><b>${UX_LABEL[scope]} 성과 기록이 없어요</b><p>자산현황과 과거 연도 기록을 입력하면 나타납니다.</p></div>`;uxBindScope(el,uxRenderPerformance);return}
  let index=clamp(Number(state.ui.performanceIndex),0,data.length-1);if(!Number.isFinite(index))index=data.length-1;const chart=buildChart(data,{yValue:d=>uxN(d.end),cValue:d=>uxN(d.cumulative),xLabels:uxTickLabels(data),idPrefix:'uxPerf'}),estimated=scope!=='all'&&state.meta?.accountHistoryEstimated?.[scope];
  const recent=data.slice(-5).reverse(),older=data.slice(0,-5).reverse();
  el.innerHTML=`${uxScope(scope)}<div class="stack"><section class="card chartCard uxPerfHero"><div class="chartHead"><div><div class="chartTitle">${UX_LABEL[scope]} 자산 흐름</div><div class="chartSub">총자산과 누적 순납입을 분리해서 봅니다</div></div><div class="legend"><span><i class="a"></i>총자산</span><span><i class="b"></i>순납입</span></div></div><div class="chart"><div class="chartTooltip" id="uxPerfTooltip"></div>${chart.svg}</div><div class="uxPerfGrid"><div class="uxPerfBox"><small>연말 자산</small><b id="uxPerfEnd"></b></div><div class="uxPerfBox"><small>누적 순납입</small><b id="uxPerfCum"></b></div><div class="uxPerfBox"><small>누적 투자손익</small><b id="uxPerfCumulativeProfit"></b></div><div class="uxPerfBox"><small>해당 연도 투자손익</small><b id="uxPerfAnnualProfit"></b></div></div></section><section class="card compact"><div class="sectionTitle" style="margin:0 0 8px">최근 연도</div><div class="uxYearList">${recent.map(d=>`<div class="uxYearCard"><strong>${d.year}</strong><span><b>${man(d.end)}</b><small>납입 ${man(d.contribution||0)} · 투자손익 ${man(d.operating||0)}</small></span><em class="${uxN(d.return)>=0?'good':'bad'}">${pct(d.return)}</em></div>`).join('')}</div>${older.length?`<details class="historyDetails"><summary>이전 ${older.length}개 연도</summary><div class="uxYearList">${older.map(d=>`<div class="uxYearCard"><strong>${d.year}</strong><span><b>${man(d.end)}</b><small>누적 순납입 ${man(d.cumulative)}</small></span><em class="${uxN(d.return)>=0?'good':'bad'}">${pct(d.return)}</em></div>`).join('')}</div></details>`:''}${estimated?'<div class="analysisNote">계좌별 과거 값 일부는 현재 비중으로 나눈 참고치입니다. 데이터 관리에서 실제 과거 값으로 바꿀 수 있습니다.</div>':''}</section><section class="card brief"><div class="briefTitle">성과를 읽는 기준</div><p id="uxPerfExplain"></p></section></div>`;
  const update=(i,commit)=>{const d=data[i],cumProfit=uxN(d.end)-uxN(d.cumulative),annualProfit=uxN(d.end)-uxN(d.start)-uxN(d.contribution),p=chart.pts[i],tip=document.getElementById('uxPerfTooltip');state.ui.performanceIndex=i;updateChartSelection('uxPerf',chart,i);if(tip&&p){tip.style.left=`${clamp(p.x/chart.W*100,18,82)}%`;tip.innerHTML=`${d.year}년<br>${man(d.end)} · ${pct(d.return)}`};document.getElementById('uxPerfEnd').textContent=fmt(d.end);document.getElementById('uxPerfCum').textContent=fmt(d.cumulative);const cp=document.getElementById('uxPerfCumulativeProfit'),ap=document.getElementById('uxPerfAnnualProfit');cp.textContent=`${cumProfit>=0?'+':''}${fmt(cumProfit)}`;cp.className=cumProfit>=0?'good':'bad';ap.textContent=`${annualProfit>=0?'+':''}${fmt(annualProfit)}`;ap.className=annualProfit>=0?'good':'bad';document.getElementById('uxPerfExplain').innerHTML=`${d.year}년 자산 변화는 <b>납입 ${fmt(d.contribution||0)}</b>과 <b class="${annualProfit>=0?'good':'bad'}">투자손익 ${annualProfit>=0?'+':''}${fmt(annualProfit)}</b>으로 나뉩니다. 누적 납입과 한 해의 투자 결과를 섞지 않습니다.`;if(commit)save()};
  update(index,false);bindChart('uxPerfHit',data,chart,update);uxBindScope(el,uxRenderPerformance);
}
function uxRenderCashflow(el){
  const scope=['all','pension','irp'].includes(state.ui.analysisScope)?state.ui.analysisScope:'all',data=uxRows(scope),latest=data.at(-1)||{year:CURRENT_YEAR,dividend:0,realized:0,monthly:Array(12).fill(0)},values=data.map(d=>Math.max(0,uxN(d.dividend))),max=Math.max(1,...values),avg3=values.slice(-3).reduce((s,v)=>s+v,0)/Math.max(1,values.slice(-3).length);
  let rank=[];if(scope==='all')rank=(state.dividendsByAsset?.[CURRENT_YEAR]||[]).slice().sort((a,b)=>b[1]-a[1]);else rank=(state.accounts?.[scope]?.holdings||[]).map(h=>[h.name,uxN(h.dividend)]).filter(x=>x[1]>0).sort((a,b)=>b[1]-a[1]);
  el.innerHTML=`${uxScope(scope)}<div class="stack"><section class="card"><div class="row"><div><div class="eyebrow">${UX_LABEL[scope]} ${latest.year}년 현금흐름</div><div class="money small">${fmt(latest.dividend||0)}</div></div><span class="chip">배당·분배금</span></div><div class="uxFlowGrid" style="margin-top:13px"><div class="uxFlowBox"><small>최근 3년 평균</small><b>${fmt(avg3)}</b></div><div class="uxFlowBox"><small>월평균 환산</small><b>${fmt(uxN(latest.dividend)/12)}</b></div><div class="uxFlowBox"><small>매도 확정손익</small><b class="${uxN(latest.realized)>=0?'good':'bad'}">${uxN(latest.realized)>=0?'+':''}${fmt(latest.realized||0)}</b></div></div></section><section class="card"><div class="sectionTitle" style="margin:0 0 10px">연도별 배당·분배금</div><div class="uxFlowRows">${data.slice(-10).reverse().map(d=>`<div><div class="uxFlowRowTop"><span>${d.year}</span><b>${fmt(d.dividend||0)}</b></div><div class="uxFlowRowTrack"><i style="width:${clamp(uxN(d.dividend)/max*100,0,100)}%"></i></div></div>`).join('')||'<div class="tiny">기록이 없어요.</div>'}</div></section><section class="card"><div class="sectionTitle" style="margin:0 0 8px">${scope==='all'?CURRENT_YEAR+' 종목별 배당·분배금':'계좌 누적 종목별 배당·분배금'}</div>${rank.length?rank.slice(0,8).map(([name,value])=>`<div class="row" style="padding:11px 0;border-bottom:1px solid var(--line)"><span style="min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(name)}</span><b>${fmt(value)}</b></div>`).join(''):'<div class="tiny">아직 기록이 없어요.</div>'}</section><section class="card brief"><div class="briefTitle">현금흐름 해석</div><p>배당·분배금은 수익률과 별개입니다. 받은 금액과 매도 확정손익을 보여주되, 자산 성장 여부는 성과 화면에서 따로 판단합니다.</p></section></div>`;uxBindScope(el,uxRenderCashflow);
}
function uxDoNotMessage(c){const title=String(c?.primary?.title||'');if(/갱신/.test(title))return '최신 잔고를 확인하기 전에는 비중을 바꾸거나 매도하지 마세요.';if(/납입/.test(title))return '새 상품을 찾거나 포트폴리오를 크게 바꿀 필요는 없습니다.';if(/종목|비중/.test(title))return '기존 보유분을 한 번에 전량 매도할 필요는 없습니다.';if(/목표/.test(title))return '목표를 맞추려고 기대수익률 가정을 억지로 높이지 마세요.';return '지금은 종목 수를 늘리거나 잦게 매매할 필요가 없습니다.'}
function uxRenderDiagnosis(el){
  const c=window.PensionV12?.coach?.()||{status:'점검',score:0,primary:{title:'데이터를 확인하세요',reason:'진단 엔진을 불러오지 못했습니다.',action:'자산현황 갱신'},secondary:[],evidence:{}},e=c.evidence||{},secondary=c.secondary||[];
  el.innerHTML=`<div class="stack"><section class="card uxDiagnosisHero"><div class="row start"><div><div class="eyebrow">현재 판단</div><h2>${esc(c.primary.title)}</h2></div><span class="smartBadge">${esc(c.status)}</span></div><p>${esc(c.primary.reason)}</p><div class="uxActionBox"><small>지금 할 일 하나</small><b>${esc(c.primary.action)}</b></div></section><div class="uxDoNot"><b>지금 하지 않아도 되는 일</b>${esc(uxDoNotMessage(c))}</div><section class="card"><div class="sectionTitle" style="margin:0 0 10px">판단 근거</div><div class="uxEvidence"><div><small>목표 달성 추정</small><b>${Number.isFinite(Number(e.goalPct))?Math.round(e.goalPct)+'%':'-'}</b></div><div><small>올해 납입</small><b>${man(e.paid||0)}</b></div><div><small>마지막 갱신</small><b>${e.freshDays==null?'확인 필요':e.freshDays===0?'오늘':`${e.freshDays}일 전`}</b></div><div><small>상위 종목 집중</small><b>${Number.isFinite(Number(e.topPct))?Number(e.topPct).toFixed(1)+'%':'-'}</b></div></div></section>${secondary.length?`<section class="card"><div class="sectionTitle" style="margin:0 0 4px">그다음 확인할 것</div><div class="uxSecondary">${secondary.slice(0,2).map(x=>`<div><b>${esc(x.action)}</b><p>${esc(x.reason)}</p></div>`).join('')}</div></section>`:''}<button class="btn full" id="uxGoFuture">미래 시뮬레이션에서 비교</button><div class="v12Model">진단은 입력한 데이터와 설정을 이용한 규칙 기반 판단입니다. 실시간 시장 전망이나 공식 투자 적합성 판정이 아닙니다.</div></div>`;
  document.getElementById('uxGoFuture').onclick=()=>navigate('future');
}
const uxPreviousHome=renderHome;
renderHome=function(){uxPreviousHome();const profitLine=document.querySelector('#home .hero .money+div');if(profitLine)profitLine.textContent=profitLine.textContent.replace('누적 운용증가','누적 투자손익');const coach=document.getElementById('homeCoach'),c=window.PensionV12?.coach?.();if(coach&&c){coach.classList.add('uxHomeCoach');coach.innerHTML=`<div class="v12CoachTop"><span class="uxHomeLabel">연금 코치 · 가장 중요한 한 가지</span><span class="v12CoachState">${esc(c.status)}</span></div><h3>${esc(c.primary.title)}</h3><p>${esc(c.primary.reason)}</p><div class="uxHomeAction">${esc(c.primary.action)} ›</div>`}const historyStep=document.querySelector('#home [data-start="history"]');if(historyStep){historyStep.remove();document.querySelectorAll('#home .firstStartStep i').forEach((node,i)=>node.textContent=i+1)}};
function uxMonthLabel(key){const [y,m]=String(key).split('-');return `${y}년 ${Number(m)}월`}
renderContributionForm=function(title,body){
  uxEnsureProfile();title.textContent='납입 기록';let selected=CURRENT_KEY,pickerYear=CURRENT_YEAR;
  body.innerHTML=`<div class="sheetNotice">금액을 이 화면에서 바로 바꿀 수 있습니다. 기본값과 다른 금액을 넣어도 이번 달만 적용할 수 있어요.</div><div class="field monthPicker"><label>기록 월</label><button type="button" class="monthPickButton" id="uxMonthButton"><span id="uxMonthLabel">${uxMonthLabel(selected)}</span><span>⌄</span></button><div class="monthPanel" id="uxMonthPanel"><div class="monthYearHead"><button type="button" id="uxYearPrev">‹</button><b id="uxPickerYear"></b><button type="button" id="uxYearNext">›</button></div><div class="monthGrid" id="uxMonthGrid"></div></div></div><div class="inputHelp" id="uxMonthHelp"></div><div id="uxContributionRows"></div><div class="contribMode" id="uxPlanMode"><label><input type="radio" name="uxPlanMode" value="once" checked><span>이번 달만 변경</span></label><label><input type="radio" name="uxPlanMode" value="plan"><span>앞으로의 월 계획도 변경</span></label></div><label class="balanceCheck" id="uxBalanceCheck"><input type="checkbox" id="uxAddCash" checked><span>이번 달 납입금이 현재 잔고에 아직 포함되지 않았습니다. 원금과 현금에 함께 더합니다.</span></label><div class="settingsInfo" id="uxContributionSummary" style="margin-top:10px"></div><button class="btn primary full" id="uxApplyContribution" style="margin-top:14px">선택 계좌 기록</button>`;
  const panel=document.getElementById('uxMonthPanel'),label=document.getElementById('uxMonthLabel');
  const renderPicker=()=>{document.getElementById('uxPickerYear').textContent=`${pickerYear}년`;document.getElementById('uxYearNext').disabled=pickerYear>=CURRENT_YEAR;const grid=document.getElementById('uxMonthGrid');grid.innerHTML=Array.from({length:12},(_,i)=>{const m=i+1,key=`${pickerYear}-${String(m).padStart(2,'0')}`,disabled=key>CURRENT_KEY;return `<button type="button" data-ux-month="${key}" class="${key===selected?'active':''}" ${disabled?'disabled':''}>${m}월</button>`}).join('');grid.querySelectorAll('[data-ux-month]').forEach(btn=>btn.onclick=()=>{selected=btn.dataset.uxMonth;label.textContent=uxMonthLabel(selected);panel.classList.remove('open');draw()})};
  document.getElementById('uxMonthButton').onclick=()=>{panel.classList.toggle('open');pickerYear=Number(selected.slice(0,4));renderPicker()};document.getElementById('uxYearPrev').onclick=()=>{pickerYear=Math.max(CURRENT_YEAR-30,pickerYear-1);renderPicker()};document.getElementById('uxYearNext').onclick=()=>{pickerYear=Math.min(CURRENT_YEAR,pickerYear+1);renderPicker()};
  const draw=()=>{const isCurrent=selected===CURRENT_KEY,status=state.runtime?.contributions?.[selected]||{pension:false,irp:false},host=document.getElementById('uxContributionRows'),mode=document.getElementById('uxPlanMode'),balance=document.getElementById('uxBalanceCheck'),year=Number(selected.slice(0,4)),yr=state.years?.[year]||{};document.getElementById('uxMonthHelp').textContent=isCurrent?'이번 달 기록은 실제 납입액을 원장과 현재 자산에 반영합니다.':'과거 달은 완료 여부만 보완합니다. 과거 금액 수정은 데이터 관리의 연도 기록에서 합니다.';mode.style.display=isCurrent?'flex':'none';balance.style.display=isCurrent?'flex':'none';host.innerHTML=['pension','irp'].map(k=>{const done=!!status[k],value=Math.max(0,uxN(state.settings?.monthly?.[k]));return `<div class="contribEditRow"><input type="checkbox" data-ux-contrib="${k}" ${done?'disabled':'checked'}><div class="contribEditMain"><b>${esc(state.accounts[k].name)}</b><div class="contribAmountLine"><input data-ux-amount="${k}" inputmode="numeric" value="${value?value.toLocaleString('ko-KR'):''}" ${done||!isCurrent?'disabled':''}><span>원</span></div>${done?'<div class="contribDone">이미 기록됨</div>':!isCurrent?'<div class="tiny" style="margin-top:5px">완료 표시만 저장</div>':''}</div></div>`}).join('');host.querySelectorAll('[data-ux-amount]').forEach(input=>input.onblur=()=>{const value=uxMoney(input.value);input.value=value?value.toLocaleString('ko-KR'):''});document.getElementById('uxContributionSummary').innerHTML=`<b>${year}년 기록 납입 ${fmt(yr.contribution||0)}</b><div class="tiny" style="margin-top:4px">월 계획 ${fmt(uxN(state.settings.monthly.pension)+uxN(state.settings.monthly.irp))} · 연간 한도 ${fmt(state.settings.annualContributionLimit||18000000)}</div>`;document.getElementById('uxApplyContribution').disabled=['pension','irp'].every(k=>status[k])};
  renderPicker();draw();
  document.getElementById('uxApplyContribution').onclick=()=>{const checked=[...document.querySelectorAll('[data-ux-contrib]:checked')].map(x=>x.dataset.uxContrib);if(!checked.length)return toast('기록할 계좌를 선택하세요');state.runtime=state.runtime||{};state.runtime.contributions=state.runtime.contributions||{};const status=state.runtime.contributions[selected]||{pension:false,irp:false},isCurrent=selected===CURRENT_KEY;if(!isCurrent){let count=0;for(const k of checked){if(status[k])continue;const r=window.PensionV11Ledger?.record?.('contribution-status',{date:`${selected}-01T00:00:00`,monthKey:selected,accountKey:k,accountId:`account-${k}`,amount:0,note:`${selected} ${state.accounts[k].name} 과거 납입 완료 확인`,source:'past-month-status'});if(r?.ok){status[k]=true;count++}}state.runtime.contributions[selected]=status;save();closeSheet('formSheet');renderAll(true);return toast(count?`${uxMonthLabel(selected)} 완료 이력을 보완했어요`:'이미 기록된 달입니다')}
    const entries=checked.filter(k=>!status[k]).map(k=>({key:k,amount:uxMoney(document.querySelector(`[data-ux-amount="${k}"]`)?.value)}));if(entries.some(x=>x.amount<=0))return toast('선택한 계좌의 납입 금액을 입력하세요');const totals=window.PensionV11Ledger?.totals?.(),already=uxN(totals?.years?.[CURRENT_YEAR]?.contribution),add=entries.reduce((s,x)=>s+x.amount,0),limit=Math.max(0,uxN(state.settings.annualContributionLimit)||18000000);if(limit&&already+add>limit)return toast(`연간 총 납입 한도 ${fmt(limit)}를 넘습니다`);const addCash=document.getElementById('uxAddCash').checked,planMode=document.querySelector('input[name="uxPlanMode"]:checked')?.value||'once';let recorded=0;for(const x of entries){const source=addCash?'current-month-cash':'current-month-already-in-balance',r=window.PensionV11Ledger?.record?.('contribution',{date:`${selected}-01T00:00:00`,monthKey:selected,accountKey:x.key,accountId:`account-${x.key}`,amount:x.amount,note:`${selected} ${state.accounts[x.key].name} 납입`,source});if(!r?.ok)continue;state.accounts[x.key].principal=uxN(state.accounts[x.key].principal)+x.amount;if(addCash)state.accounts[x.key].cash=uxN(state.accounts[x.key].cash)+x.amount;if(planMode==='plan')state.settings.monthly[x.key]=x.amount;status[x.key]=true;recorded++}state.runtime.contributions[selected]=status;if(recorded)updateYearFromAssets();save();closeSheet('formSheet');renderAll(true);toast(recorded?`${uxMonthLabel(selected)} 납입을 기록했어요`:'이미 기록된 납입입니다')};
};
const uxPreviousQuick=quickForm;
quickForm=function(type){uxPreviousQuick.apply(this,arguments);if(type==='history')setTimeout(()=>{const body=document.getElementById('formBody'),textarea=body?.querySelector('textarea'),field=textarea?.closest('.field'),preview=body?.querySelector('.historyPreview'),apply=body?.querySelector('button[id*="History"],button[id*="history"]');if(!field||field.closest('.advancedHistory'))return;document.getElementById('formTitle').textContent='과거 연도 관리';const years=Object.keys(state.years||{}).map(Number).sort((a,b)=>a-b),overview=document.createElement('div');overview.className='historyOverview';overview.innerHTML=`<b>${years.length}년 기록 보관 중</b><p>${years.length?`${years[0]}~${years.at(-1)}년`: '아직 과거 기록 없음'} · 평소에는 열 필요가 없는 고급 데이터 관리입니다.</p>`;field.before(overview);const details=document.createElement('details');details.className='advancedHistory';details.innerHTML='<summary>고급 원문 편집</summary>';overview.after(details);details.appendChild(field);if(preview)details.appendChild(preview);if(apply)details.appendChild(apply)},0)};
const uxPreviousSettings=renderSettings;
renderSettings=function(){
  uxEnsureProfile();uxPreviousSettings();const body=document.getElementById('settingsBody'),age=document.getElementById('setAge');if(age){const field=age.closest('.field'),label=field?.querySelector('label');if(label)label.textContent='출생연도';age.id='setBirthYear';age.value=state.profile.birthYear;age.min=String(CURRENT_YEAR-80);age.max=String(CURRENT_YEAR-18);const hint=document.createElement('div');hint.className='fieldHint';hint.id='uxAgeHint';hint.textContent=`올해 기준 ${state.profile.age}세로 자동 계산`;field?.appendChild(hint)}
  const saveBar=body?.querySelector('.saveBar');if(saveBar&&!document.getElementById('uxHistoryLaunch')){const sec=document.createElement('div');sec.className='settingsSection';sec.innerHTML=`<div class="settingsTitle">고급 데이터 관리</div><button class="dataLaunch uxHistoryLaunch" id="uxHistoryLaunch"><span><b>과거 연도 기록</b><small>원문은 기본적으로 숨기고 필요할 때만 편집합니다.</small></span><span>›</span></button>`;body.insertBefore(sec,saveBar);document.getElementById('uxHistoryLaunch').onclick=()=>{closeSheet('settingsSheet');setTimeout(()=>quickForm('history'),180)}}
  const birth=document.getElementById('setBirthYear');birth?.addEventListener('input',()=>{const y=Number(birth.value),hint=document.getElementById('uxAgeHint');if(hint)hint.textContent=Number.isInteger(y)?`올해 기준 ${CURRENT_YEAR-y}세로 자동 계산`:''});
  const btn=document.getElementById('saveSettings');if(!btn)return;btn.onclick=()=>{const err=document.getElementById('settingsError'),birthYear=Number(document.getElementById('setBirthYear').value),ageNow=CURRENT_YEAR-birthYear+1,ret=Number(document.getElementById('setRetAge').value),p=uxMoney(document.getElementById('setPension').value),i=uxMoney(document.getElementById('setIrp').value),goal=uxMoney(document.getElementById('setGoal').value),rate=Number(document.getElementById('setReturn').value),infl=Number(document.getElementById('setInflation').value),years=Number(document.getElementById('setYears').value),wr=Number(document.getElementById('setWithdrawReturn').value),annual=uxMoney(document.getElementById('setAnnualLimit')?.value||state.settings.annualContributionLimit),tax=uxMoney(document.getElementById('setTaxLimit')?.value||state.settings.taxCreditLimit);document.querySelectorAll('.className').forEach(x=>settingsDraft.settings.assetClasses[x.dataset.i].name=x.value.trim());document.querySelectorAll('.classTarget').forEach(x=>settingsDraft.settings.assetClasses[x.dataset.i].target=Number(x.value));const names=settingsDraft.settings.assetClasses.map(c=>c.name),sum=settingsDraft.settings.assetClasses.reduce((s,c)=>s+uxN(c.target),0);let msg='';if(!Number.isInteger(birthYear)||ageNow<18||ageNow>100)msg='출생연도를 확인하세요.';else if(ret<18||ret>90)msg='연금 개시 나이는 18~90세로 입력하세요.';else if([p,i,goal,annual,tax].some(v=>v<0||v>100000000))msg='금액은 0원 이상으로 입력하세요.';else if((p+i)*12>annual)msg='월 납입 계획의 연환산액이 연금계좌 총 납입 한도를 넘습니다.';else if(tax>annual)msg='세액공제 한도는 총 납입 한도보다 클 수 없어요.';else if(!Number.isFinite(rate)||rate<-20||rate>20)msg='적립 기대수익률은 -20~20%로 입력하세요.';else if(!Number.isFinite(infl)||infl<0||infl>10)msg='물가상승률은 0~10%로 입력하세요.';else if(years<5||years>50)msg='수령 기간은 5~50년으로 입력하세요.';else if(!Number.isFinite(wr)||wr<-10||wr>15)msg='수령 중 수익률은 -10~15%로 입력하세요.';else if(names.some(v=>!v)||new Set(names).size!==names.length)msg='자산군 이름은 비우거나 중복할 수 없어요.';else if(settingsDraft.settings.assetClasses.some(c=>uxN(c.target)<0||uxN(c.target)>100)||Math.abs(sum-100)>.01)msg='자산군 목표 비중 합계를 100%로 맞춰주세요.';if(msg){err.textContent=msg;return}state.profile={...state.profile,birthYear,age:ageNow,retirementAge:ret};state.settings={...settingsDraft.settings,monthly:{pension:p,irp:i},goalMonthly:goal,returnRate:rate,inflation:infl,withdrawYears:years,withdrawReturn:wr,annualContributionLimit:annual,taxCreditLimit:tax};state.ui.futureAge=clamp(state.ui.futureAge,ageNow,ret);save();closeSheet('settingsSheet');renderAll(true);toast('설정을 저장했어요')};
};
const uxPreviousRenderAll=renderAll;
renderAll=function(keepScreen=false){uxEnsureProfile();uxPreviousRenderAll(keepScreen);const sub=document.getElementById('headerSub');if(sub)sub.textContent=`${state.profile.age}세 · ${state.profile.retirementAge}세 연금 개시 계획`;document.querySelectorAll('#future th,#future .detailBarTop span').forEach(node=>{if(node.textContent.includes('예상 운용증가'))node.textContent=node.textContent.replace('예상 운용증가','예상 투자수익')});};
document.querySelector('[data-quick="history"]')?.remove();
uxEnsureProfile();renderAll(true);save();
window.PensionUX={build:UX_BUILD,currentAge:()=>{uxEnsureProfile();return state.profile.age},renderDiagnosis:uxRenderDiagnosis};
})();

/* ===== V2.0 RC5 expert refinement: outcome-first pension experience ===== */
(()=>{
'use strict';
const RC5_BUILD='2.9.1';
const R5_LABEL={all:'전체',pension:'연금저축',irp:'IRP'};
const r5n=v=>Number.isFinite(Number(v))?Number(v):0;
const r5Scope=()=>['all','pension','irp'].includes(state.ui.analysisScope)?state.ui.analysisScope:'all';
const r5Rows=(scope='all')=>{const src=scope==='all'?(state.years||{}):(state.accountYears?.[scope]||{});return Object.keys(src).map(Number).filter(Number.isFinite).sort((a,b)=>a-b).map(year=>({year,...src[year]}))};
const r5ScopeSelect=scope=>`<div class="r5ScopeBar"><span>분석 계좌</span><select id="r5ScopeSelect" aria-label="분석 계좌"><option value="all" ${scope==='all'?'selected':''}>전체</option><option value="pension" ${scope==='pension'?'selected':''}>연금저축</option><option value="irp" ${scope==='irp'?'selected':''}>IRP</option></select></div>`;
function r5BindScope(renderer){const s=document.getElementById('r5ScopeSelect');if(s)s.onchange=()=>{state.ui.analysisScope=s.value;state.ui.performanceIndex=999;renderer(document.getElementById('analysisContent'));save()}}
function r5Contribution(){
  const status=currentContributionStatus(),keys=['pension','irp'].filter(k=>r5n(state.settings?.monthly?.[k])>0),missing=keys.filter(k=>!status[k]),monthly=keys.reduce((n,k)=>n+r5n(state.settings.monthly[k]),0),year=state.years?.[CURRENT_YEAR]||{},paid=Math.max(0,r5n(year.contribution)),annual=monthly*12;
  return {status,keys,missing,monthly,paid,annual,pct:annual?clamp(paid/annual*100,0,100):0};
}
function r5FreshDays(){const raw=String(state.lastUpdated||'').trim();if(!raw)return null;const d=new Date(raw.replace(/\./g,'-')+'T00:00:00');return Number.isNaN(d.getTime())?null:Math.max(0,Math.floor((Date.now()-d.getTime())/86400000))}
function r5Allocation(){
  const totals=classTotals(),total=Object.values(totals).reduce((n,v)=>n+r5n(v),0)||1,classes=(state.settings?.assetClasses||[]).map(c=>({name:c.name,current:r5n(totals[c.id])/total*100,target:r5n(c.target),diff:r5n(totals[c.id])/total*100-r5n(c.target)}));
  const under=[...classes].sort((a,b)=>a.diff-b.diff)[0],holdings=['pension','irp'].flatMap(k=>(state.accounts?.[k]?.holdings||[]).map(h=>({...h,accountKey:k}))).sort((a,b)=>r5n(b.value)-r5n(a.value)),top=holdings[0],topPct=top?r5n(top.value)/total*100:0;
  return {under,top,topPct};
}
function r5Coach(){
  const base=window.PensionV12?.coach?.()||{},goal=goalStatus(),con=r5Contribution(),fresh=r5FreshDays(),alloc=r5Allocation(),years=Math.max(0,r5n(state.profile.retirementAge)-r5n(state.profile.age));
  if(fresh==null||fresh>45)return {state:'먼저 확인',tone:'watch',title:'자산현황을 최신으로 바꾸세요',reason:`${fresh==null?'갱신일을 확인할 수 없습니다':`${fresh}일 전 자료입니다`}. 목표 월연금과 투자손익 판단 전에 현재 잔고가 먼저입니다.`,action:'자산현황 갱신하기',avoid:'최신 잔고를 보기 전에는 비중 변경이나 매도를 결정하지 마세요.',evidence:[['예상 월연금',man(goal.real)],['목표 달성',`${Math.round(goal.p)}%`],['남은 기간',`${years}년`]]};
  if(con.missing.length){const names=con.missing.map(k=>state.accounts[k]?.name||R5_LABEL[k]),amount=con.missing.reduce((n,k)=>n+r5n(state.settings.monthly[k]),0);return {state:'이번 달 행동',tone:'action',title:`${names.join('·')} 납입만 마치면 됩니다`,reason:`이번 달 계획 ${man(con.monthly)} 중 ${names.join('·')} ${man(amount)}이 아직 기록되지 않았습니다.`,action:`${names.join('·')} ${man(amount)} 기록하기`,avoid:'새 상품을 찾거나 기존 포트폴리오를 크게 바꿀 필요는 없습니다.',evidence:[['올해 납입',man(con.paid)],['연간 계획',man(con.annual)],['목표 달성',`${Math.round(goal.p)}%`]]};}
  if(goal.p<90){const add=base?.evidence?.extraReal,improve=Number.isFinite(Number(add))?Math.max(0,r5n(add)-r5n(goal.real)):0;return {state:'작은 조정',tone:'plan',title:'목표는 수익률보다 납입액으로 보완하세요',reason:`현재 계획의 예상 월연금은 ${man(goal.real)}으로 목표 ${man(goal.goal)}의 ${Math.round(goal.p)}%입니다.${improve?` 월 10만원을 더 넣으면 약 ${man(improve)} 개선될 수 있습니다.`:''}`,action:'미래에서 월 10만원 추가 시나리오 비교',avoid:'부족분을 메우려고 기대수익률을 억지로 높이지 마세요.',evidence:[['예상 월연금',man(goal.real)],['목표까지',man(Math.max(0,goal.gap))],['남은 기간',`${years}년`]]};}
  if(alloc.topPct>45)return {state:'집중 점검',tone:'watch',title:'기존 종목을 팔기보다 다음 납입 방향만 바꾸세요',reason:`${alloc.top?.name||'상위 종목'}이 전체 자산의 ${alloc.topPct.toFixed(1)}%입니다. 장기계좌에서는 신규 납입으로 천천히 조정하는 편이 단순합니다.`,action:`다음 납입은 ${alloc.under?.name||'부족 자산군'} 우선`,avoid:'기존 보유분을 한 번에 전량 매도하지 마세요.',evidence:[['상위 종목',`${alloc.topPct.toFixed(1)}%`],['예상 월연금',man(goal.real)],['목표 달성',`${Math.round(goal.p)}%`]]};
  return {state:'유지 가능',tone:'good',title:'지금 계획은 그대로 유지해도 됩니다',reason:`예상 월연금 ${man(goal.real)}, 목표 달성 추정 ${Math.round(goal.p)}%, 연금 개시까지 ${years}년입니다. 급히 바꿀 항목이 없습니다.`,action:'이번 달 계획 납입 후 다음 갱신일까지 유지',avoid:'종목 수를 늘리거나 수익률을 따라 잦게 매매하지 마세요.',evidence:[['예상 월연금',man(goal.real)],['목표 달성',`${Math.round(goal.p)}%`],['남은 기간',`${years}년`]]};
}
function r5AccountLinks(total){return Object.entries(state.accounts).map(([k,a])=>{const value=accountTotal(a),profit=value-r5n(a.principal),share=total?value/total*100:0;return `<button class="r5AccountRow" data-account-link="${k}"><span><b>${esc(a.name)}</b><small>전체의 ${share.toFixed(1)}%</small></span><span><b>${man(value)}</b><small class="${profit>=0?'good':'bad'}">${profit>=0?'+':''}${man(profit)}</small></span><i>›</i></button>`}).join('')}
renderHome=function(){
  const goal=goalStatus(),total=totalAsset(),principal=totalPrincipal(),profit=total-principal,con=r5Contribution(),coach=r5Coach(),gap=goal.gap>0?`목표까지 월 ${man(goal.gap)} 부족`:'목표 달성 범위',fresh=r5FreshDays();
  const onboard=total<=0?`<section class="card r5Onboard"><div class="eyebrow">처음 시작하기</div><h2>현재 연금자산부터 입력하세요</h2><p>연금저축과 IRP 잔고를 한 번 입력하면 예상 월연금과 진단이 시작됩니다.</p><button class="btn primary full" id="r5Start">자산현황 입력</button></section>`:'';
  document.getElementById('home').innerHTML=`<div class="stack r5Home">${onboard}
    <button class="card r5RetirementHero" id="homeGoal"><div class="r5HeroTop"><span>현재 계획 유지 시</span><span>${state.profile.retirementAge}세부터</span></div><div class="r5Monthly">월 <strong>${man(goal.real)}</strong></div><div class="r5GoalLine"><span>${gap}</span><b>${Math.round(goal.p)}%</b></div><div class="r5Progress"><i style="width:${clamp(goal.p,0,100)}%"></i></div><div class="r5HeroFoot">현재가치 기준 · 예상자산 연 4% 인출 · 자세히 보기 ›</div></button>
    <button class="card r5ActionCard ${coach.tone}" id="homeCoach"><div class="r5ActionHead"><span>이번 달 가장 중요한 한 가지</span><b>${esc(coach.state)}</b></div><h2>${esc(coach.title)}</h2><p>${esc(coach.reason)}</p><div class="r5ActionCta">${esc(coach.action)} <span>›</span></div></button>
    <button class="card r5Contribution" id="homeContribution"><div class="r5SectionHead"><div><span>${CURRENT_YEAR}년 납입</span><strong>${man(con.paid)}</strong></div><b>${Math.round(con.pct)}%</b></div><div class="r5Progress slim"><i style="width:${con.pct}%"></i></div><div class="r5ContributionFoot"><span>${con.missing.length?`${con.missing.map(k=>R5_LABEL[k]).join('·')} 기록 대기`:'이번 달 계획 완료'}</span><span>연간 계획 ${man(con.annual)} ›</span></div></button>
    <section class="card r5AssetCard"><button id="totalCard" class="r5AssetMain"><div><span>현재 개인연금 자산</span><strong>${man(total)}</strong><small class="${profit>=0?'good':'bad'}">투자손익 ${profit>=0?'+':''}${man(profit)}</small></div><div><small>마지막 갱신</small><b>${fresh==null?'확인 필요':fresh===0?'오늘':`${fresh}일 전`}</b><i id="totalChevron" class="chevron ${state.ui.homeExpanded?'open':''}">⌄</i></div></button><div class="expand ${state.ui.homeExpanded?'open':''}" id="accountExpand"><div>${r5AccountLinks(total)}</div><div class="r5Exact">정확한 금액 ${fmt(total)} · 누적 순납입 ${fmt(principal)}</div></div></section>
  </div>`;
  document.getElementById('r5Start')?.addEventListener('click',()=>quickForm('snapshot'));
  document.getElementById('homeGoal').onclick=()=>navigate('future');
  document.getElementById('homeCoach').onclick=()=>{state.ui.analysisPanel='diagnosis';navigate('analysis');renderAnalysis();save()};
  document.getElementById('homeContribution').onclick=()=>quickForm('contribution');
  document.getElementById('totalCard').onclick=()=>{state.ui.homeExpanded=!state.ui.homeExpanded;document.getElementById('accountExpand').classList.toggle('open',state.ui.homeExpanded);document.getElementById('totalChevron').classList.toggle('open',state.ui.homeExpanded);save()};
  document.querySelectorAll('[data-account-link]').forEach(b=>b.onclick=e=>{e.stopPropagation();navigate('account',b.dataset.accountLink)});
};
function r5Perf(el){
  const scope=r5Scope(),data=r5Rows(scope);if(!data.length){el.innerHTML=r5ScopeSelect(scope)+`<div class="card empty"><b>${R5_LABEL[scope]} 성과 기록이 없어요</b><p>자산현황과 과거 연도 기록을 입력하면 나타납니다.</p></div>`;r5BindScope(r5Perf);return}
  let idx=clamp(Number(state.ui.performanceIndex),0,data.length-1);if(!Number.isFinite(idx))idx=data.length-1;const latest=data.at(-1),chart=buildChart(data,{yValue:d=>r5n(d.end),cValue:d=>r5n(d.cumulative),xLabels:data.length<=5?data.map((d,i)=>[i,String(d.year)]):[[0,String(data[0].year)],[Math.round((data.length-1)/2),String(data[Math.round((data.length-1)/2)].year)],[data.length-1,String(latest.year)]],idPrefix:'r5Perf'}),recent=data.slice(-4).reverse(),older=data.slice(0,-4).reverse();
  el.innerHTML=`${r5ScopeSelect(scope)}<div class="stack"><section class="card r5PerfHero"><div class="r5PerfTitle"><div><span>${R5_LABEL[scope]} 최근 자산</span><strong>${man(latest.end)}</strong></div><b class="${r5n(latest.return)>=0?'good':'bad'}">${pct(latest.return)}</b></div><div class="chart"><div class="chartTooltip" id="r5PerfTooltip"></div>${chart.svg}</div><div class="r5Kpis"><div><small>누적 순납입</small><b id="r5PerfCum"></b></div><div><small>누적 투자손익</small><b id="r5PerfProfit"></b></div><div><small>선택 연도 손익</small><b id="r5PerfAnnual"></b></div></div><div class="r5PerfExplain" id="r5PerfExplain"></div></section><section class="card compact"><div class="sectionTitle" style="margin:0 0 8px">연도별 흐름</div><div class="uxYearList">${recent.map(d=>`<div class="uxYearCard"><strong>${d.year}</strong><span><b>${man(d.end)}</b><small>납입 ${man(d.contribution||0)} · 투자손익 ${d.operating>=0?'+':''}${man(d.operating||0)}</small></span><em class="${r5n(d.return)>=0?'good':'bad'}">${pct(d.return)}</em></div>`).join('')}</div>${older.length?`<details class="historyDetails"><summary>이전 ${older.length}개 연도</summary><div class="uxYearList">${older.map(d=>`<div class="uxYearCard"><strong>${d.year}</strong><span><b>${man(d.end)}</b><small>누적 순납입 ${man(d.cumulative)}</small></span><em class="${r5n(d.return)>=0?'good':'bad'}">${pct(d.return)}</em></div>`).join('')}</div></details>`:''}</section></div>`;
  const update=(i,commit)=>{const d=data[i],cum=r5n(d.end)-r5n(d.cumulative),annual=r5n(d.end)-r5n(d.start)-r5n(d.contribution),p=chart.pts[i],tip=document.getElementById('r5PerfTooltip');state.ui.performanceIndex=i;updateChartSelection('r5Perf',chart,i);if(tip&&p){tip.style.left=`${clamp(p.x/chart.W*100,18,82)}%`;tip.innerHTML=`${d.year}년<br>${man(d.end)} · ${pct(d.return)}`};document.getElementById('r5PerfCum').textContent=man(d.cumulative);const cp=document.getElementById('r5PerfProfit'),ap=document.getElementById('r5PerfAnnual');cp.textContent=`${cum>=0?'+':''}${man(cum)}`;cp.className=cum>=0?'good':'bad';ap.textContent=`${annual>=0?'+':''}${man(annual)}`;ap.className=annual>=0?'good':'bad';document.getElementById('r5PerfExplain').innerHTML=`${d.year}년 변화는 <b>납입 ${man(d.contribution||0)}</b>과 <b class="${annual>=0?'good':'bad'}">투자손익 ${annual>=0?'+':''}${man(annual)}</b>으로 나뉩니다.`;if(commit)save()};update(idx,false);bindChart('r5PerfHit',data,chart,update);r5BindScope(r5Perf);
}
function r5Cashflow(el){
  const scope=r5Scope(),data=r5Rows(scope),latest=data.at(-1)||{year:CURRENT_YEAR,dividend:0,realized:0},values=data.map(d=>Math.max(0,r5n(d.dividend))),max=Math.max(1,...values),avg=values.slice(-3).reduce((a,b)=>a+b,0)/Math.max(1,values.slice(-3).length);let rank=[];if(scope==='all')rank=(state.dividendsByAsset?.[CURRENT_YEAR]||[]).slice().sort((a,b)=>b[1]-a[1]);else rank=(state.accounts?.[scope]?.holdings||[]).map(h=>[h.name,r5n(h.dividend)]).filter(x=>x[1]>0).sort((a,b)=>b[1]-a[1]);
  el.innerHTML=`${r5ScopeSelect(scope)}<div class="stack"><section class="card r5FlowHero"><div><span>${latest.year}년 배당·분배금</span><strong>${man(latest.dividend||0)}</strong></div><div class="r5FlowKpis"><div><small>최근 3년 평균</small><b>${man(avg)}</b></div><div><small>매도 확정손익</small><b class="${r5n(latest.realized)>=0?'good':'bad'}">${r5n(latest.realized)>=0?'+':''}${man(latest.realized||0)}</b></div></div></section><section class="card"><div class="sectionTitle" style="margin:0 0 10px">연도별 현금흐름</div><div class="uxFlowRows">${data.slice(-8).reverse().map(d=>`<div><div class="uxFlowRowTop"><span>${d.year}</span><b>${man(d.dividend||0)}</b></div><div class="uxFlowRowTrack"><i style="width:${clamp(r5n(d.dividend)/max*100,0,100)}%"></i></div></div>`).join('')||'<div class="tiny">기록이 없어요.</div>'}</div></section>${rank.length?`<section class="card"><div class="sectionTitle" style="margin:0 0 8px">배당 기여 상위 상품</div>${rank.slice(0,5).map(([name,value])=>`<div class="r5Rank"><span>${esc(name)}</span><b>${man(value)}</b></div>`).join('')}</section>`:''}<div class="analysisNote">배당은 현금흐름이고, 자산이 실제로 성장했는지는 성과에서 따로 확인합니다.</div></div>`;r5BindScope(r5Cashflow);
}
function r5Diagnosis(el){
  const c=r5Coach();el.innerHTML=`<div class="stack"><section class="card r5Diagnosis ${c.tone}"><div class="r5DiagHead"><span>현재 판단</span><b>${esc(c.state)}</b></div><h2>${esc(c.title)}</h2><p>${esc(c.reason)}</p><div class="r5DiagAction"><small>지금 할 일 하나</small><strong>${esc(c.action)}</strong></div></section><div class="r5Avoid"><b>지금 하지 않아도 되는 일</b><span>${esc(c.avoid)}</span></div><section class="card"><div class="sectionTitle" style="margin:0 0 10px">이 판단에 사용한 숫자</div><div class="r5Evidence">${c.evidence.map(([k,v])=>`<div><small>${esc(k)}</small><b>${esc(v)}</b></div>`).join('')}</div></section><button class="btn primary full" id="r5DiagnosisAction">${/미래/.test(c.action)?'미래 시뮬레이션 열기':/갱신/.test(c.action)?'자산현황 갱신하기':/기록/.test(c.action)?'이번 달 납입 기록':'미래 계획 확인'}</button><div class="v12Model">진단은 저장된 데이터와 설정을 이용한 규칙 기반 판단입니다. 시장 예측이나 투자 권유가 아닙니다.</div></div>`;document.getElementById('r5DiagnosisAction').onclick=()=>{/갱신/.test(c.action)?quickForm('snapshot'):/기록/.test(c.action)?quickForm('contribution'):navigate('future')};
}
renderAnalysis=function(){
  if(!['performance','cashflow','diagnosis'].includes(state.ui.analysisPanel))state.ui.analysisPanel='performance';const root=document.getElementById('analysis'),cls=state.ui.analysisPanel==='cashflow'?'i1':state.ui.analysisPanel==='diagnosis'?'i2':'';root.innerHTML=`<div class="segment three r5AnalysisTabs"><i class="segmentIndicator ${cls}"></i><button data-analysis="performance" class="${state.ui.analysisPanel==='performance'?'active':''}">성과</button><button data-analysis="cashflow" class="${state.ui.analysisPanel==='cashflow'?'active':''}">현금흐름</button><button data-analysis="diagnosis" class="${state.ui.analysisPanel==='diagnosis'?'active':''}">진단</button></div><div id="analysisContent"></div>`;root.querySelectorAll('[data-analysis]').forEach(b=>b.onclick=()=>{state.ui.analysisPanel=b.dataset.analysis;renderAnalysis();save()});renderAnalysisContent();
};
renderAnalysisContent=function(){const el=document.getElementById('analysisContent');if(state.ui.analysisPanel==='performance')r5Perf(el);else if(state.ui.analysisPanel==='cashflow')r5Cashflow(el);else r5Diagnosis(el)};
function r5Project(extra=0,rateDelta=0,retireDelta=0){const years=Math.max(0,r5n(state.profile.retirementAge)+retireDelta-r5n(state.profile.age)),annual=r5n(state.settings.returnRate)+rateDelta,rm=Math.pow(Math.max(.01,1+annual/100),1/12)-1,monthly=r5n(state.settings.monthly?.pension)+r5n(state.settings.monthly?.irp)+extra;let bal=Math.max(0,totalAsset());for(let y=0;y<years;y++)for(let m=0;m<12;m++){bal*=1+rm;bal+=monthly}const sim=withdrawalSim(bal,'balanced');return {asset:bal,monthly:presentValueMonthly(sim.startMonthly)}}
renderAccum=function(el){
  const data=projection(),goal=goalStatus(),base=r5Project(),extra=r5Project(100000),lower=r5Project(0,-1),late=r5Project(0,0,1),ages=[state.profile.age,40,50,60,state.profile.retirementAge].filter((v,i,a)=>v>=state.profile.age&&v<=state.profile.retirementAge&&a.indexOf(v)===i),milestones=ages.map(age=>data.find(d=>d.age===age)).filter(Boolean),chart=buildChart(data,{yValue:d=>r5n(d.end),cValue:d=>r5n(d.cumulative),xLabels:milestones.map(d=>[data.indexOf(d),`${d.age}세`]),idPrefix:'r5Future'});let idx=data.findIndex(d=>d.age===state.ui.futureAge);if(idx<0)idx=data.length-1;
  el.innerHTML=`<div class="stack"><section class="card r5FutureHero"><div class="r5FutureTop"><span>${state.profile.retirementAge}세부터 현재가치 기준</span><b>${Math.round(goal.p)}%</b></div><div class="r5FutureMonthly">월 <strong>${man(goal.real)}</strong></div><div class="r5FutureGap">${goal.gap>0?`목표 ${man(goal.goal)}까지 월 ${man(goal.gap)} 부족`:`목표 ${man(goal.goal)} 달성 범위`}</div><div class="r5Progress"><i style="width:${clamp(goal.p,0,100)}%"></i></div><small>입력한 수익률·물가·수령기간에 따른 예상치입니다.</small></section><section class="card"><div class="sectionTitle" style="margin:0 0 10px">무엇을 바꾸면 달라질까</div><div class="r5Scenario"><div><span>월 10만원 추가</span><b class="good">월 +${man(Math.max(0,extra.monthly-base.monthly))}</b></div><div><span>수익률 1%p 낮음</span><b class="bad">월 ${man(lower.monthly)}</b></div><div><span>개시 1년 늦춤</span><b class="good">월 +${man(Math.max(0,late.monthly-base.monthly))}</b></div></div></section><section class="card chartCard r5FutureChart"><div class="chartHead"><div><div class="chartTitle">연금 개시까지 자산 경로</div><div class="chartSub">예상자산과 누적 순납입을 구분합니다</div></div><div class="legend"><span><i class="a"></i>예상자산</span><span><i class="b"></i>순납입</span></div></div><div class="chart"><div class="chartTooltip" id="r5FutureTooltip"></div>${chart.svg}</div><div class="r5FuturePoint" id="r5FuturePoint"></div></section><details class="card r5Milestones"><summary>나이별 예상자산 자세히</summary><div>${milestones.map(d=>`<div class="r5Milestone"><span>${d.age}세</span><b>${man(d.end)}</b><small>순납입 ${man(d.cumulative)}</small></div>`).join('')}</div></details><button class="btn full" id="r5FutureSettings">가정 변경하기</button></div>`;
  const update=(i,commit)=>{const d=data[i],p=chart.pts[i],tip=document.getElementById('r5FutureTooltip');state.ui.futureAge=d.age;updateChartSelection('r5Future',chart,i);if(tip&&p){tip.style.left=`${clamp(p.x/chart.W*100,18,82)}%`;tip.innerHTML=`${d.age}세<br>${man(d.end)}`};document.getElementById('r5FuturePoint').innerHTML=`<b>${d.age}세 예상 ${man(d.end)}</b><span>누적 순납입 ${man(d.cumulative)} · 투자수익 ${d.operating>=0?'+':''}${man(d.operating)}</span>`;if(commit)save()};update(idx,false);bindChart('r5FutureHit',data,chart,update);document.getElementById('r5FutureSettings').onclick=()=>{renderSettings();openSheet('settingsSheet')};
};
const r5PrevAll=renderAll;renderAll=function(keepScreen=false){state.meta=state.meta||{};state.meta.uxBuild=RC5_BUILD;r5PrevAll(keepScreen);const sub=document.getElementById('headerSub');if(sub)sub.textContent=`${state.profile.age}세 · ${state.profile.retirementAge}세 연금 개시`;};
state.meta=state.meta||{};state.meta.uxBuild=RC5_BUILD;renderAll(true);save();window.PensionRC5={build:RC5_BUILD,coach:r5Coach};
})();
