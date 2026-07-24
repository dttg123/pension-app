/* 개인연금 V2.0 최종 셸: 버전 고정, 진단, 저장 후처리, PWA 갱신 */
(()=>{
'use strict';
const VERSION='2.0.0';
const BUILD='2026-07-24-schema6-backup2-final1';
const ARCHITECTURE='modular-flat-v2-maintainable-15';
const MODULE_FILES=[
  'base.css','components.css','features.css',
  'core.js','ui.js','analysis.js','ocr.js','backup.js',
  'planning.js','ledger.js','coach.js','integrity.js'
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
  document.title='개인연금 V2.0';
  document.querySelectorAll('.v0Badge,.v1Badge').forEach(b=>{b.textContent='V2.0';b.classList.add('v12Version')});
  const notice=document.querySelector('#settingsBody .sheetNotice');
  if(notice)notice.textContent='저장 버튼을 눌러야 반영됩니다. 앱 V2.0.0 · 데이터 구조 6 · 사진 원본 저장 안 함';
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
    driveConnected:Boolean(window.PensionStorageAdapters?.drive?.save)
  };
}

/* 하위 모듈이 과거 버전 문자열을 다시 쓰더라도 최종 저장값은 항상 2.0.0으로 고정한다. */
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
    source:HISTORY_SOURCE,synthetic:true,note:'V2.0 과거 연도 입력 원장 조정',createdAt:new Date().toISOString(),ledgerSchemaVersion:2
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
