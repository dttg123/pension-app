/* 개인연금 V2.3 월별 원장 */

/* ===== js/80-ledger.js ===== */
(()=>{
'use strict';
const P11_VERSION='1.1.0';
const P11_LEDGER_SCHEMA=2;
const P11_ACCOUNT_KEYS=['pension','irp'];
const P11_ACCOUNT_ID={pension:'account-pension',irp:'account-irp'};
const P11_EVENT_TYPES={contribution:new Set(['contribution','contribution-adjustment']),dividend:new Set(['dividend','dividend-adjustment']),accountDividend:new Set(['dividend-account-allocation']),realized:new Set(['sell','realized-adjustment'])};
const p11Num=v=>Number.isFinite(Number(v))?Number(v):0;
const p11Pad=n=>String(n).padStart(2,'0');
const p11AccountKey=r=>r.accountKey||P11_ACCOUNT_KEYS.find(k=>r.accountId===P11_ACCOUNT_ID[k])||'';
const p11MonthKey=r=>{
  if(/^\d{4}-\d{2}$/.test(String(r.monthKey||'')))return String(r.monthKey);
  const m=String(r.date||'').match(/^(\d{4})-(\d{2})/);return m?`${m[1]}-${m[2]}`:'';
};
const p11Year=r=>{const m=p11MonthKey(r);if(m)return Number(m.slice(0,4));const y=Number(String(r.date||'').slice(0,4));return Number.isInteger(y)?y:0};
const p11Uid=(prefix='event')=>`${prefix}-${crypto.randomUUID?.()||`${Date.now()}-${Math.random().toString(16).slice(2)}`}`;
function p11NormalizeRecord(raw,index=0){
  const r={...(raw||{})},accountKey=p11AccountKey(r),monthKey=p11MonthKey(r),year=p11Year(r);
  r.id=r.id||p11Uid(`ledger-${index+1}`);r.type=String(r.type||'').trim();r.date=r.date||new Date().toISOString();
  r.accountKey=accountKey;r.accountId=r.accountId||(accountKey?P11_ACCOUNT_ID[accountKey]:'');r.monthKey=monthKey;r.year=year;
  r.assetId=String(r.assetId||'');r.assetName=String(r.assetName||'');r.amount=p11Num(r.amount);r.quantity=p11Num(r.quantity);
  r.principalDelta=p11Num(r.principalDelta);r.cashDelta=p11Num(r.cashDelta);r.source=String(r.source||'app');
  r.synthetic=Boolean(r.synthetic);r.createdAt=r.createdAt||r.date||new Date().toISOString();r.updatedAt=r.updatedAt||r.createdAt;r.status=['active','void'].includes(r.status)?r.status:'active';r.recordSchemaVersion=Math.max(1,Number(r.recordSchemaVersion)||1);r.extensions=r.extensions&&typeof r.extensions==='object'&&!Array.isArray(r.extensions)?r.extensions:{};r.ledgerSchemaVersion=P11_LEDGER_SCHEMA;
  if(r.type==='contribution'&&!r.principalDelta)r.principalDelta=r.amount;
  if(r.type==='contribution'&&r.cashDelta===0&&/cash/.test(r.source))r.cashDelta=r.amount;
  return r;
}
function p11NormalizeLedger(){
  state.ledger=Array.isArray(state.ledger)?state.ledger:[];
  for(let i=0;i<state.ledger.length;i++){const raw=state.ledger[i],normalized=p11NormalizeRecord(raw,i);if(raw&&typeof raw==='object'&&!Array.isArray(raw))Object.assign(raw,normalized);else state.ledger[i]=normalized}
  return state.ledger;
}
function p11LedgerTotals(){
  const out={years:{},accounts:{pension:{},irp:{}},status:{},dividendsByAsset:{}};
  const yearRow=y=>out.years[y]||(out.years[y]={contribution:0,dividend:0,realized:0,monthly:Array(12).fill(0),accountContribution:{pension:0,irp:0}});
  const accountRow=(k,y)=>out.accounts[k][y]||(out.accounts[k][y]={contribution:0,dividend:0,realized:0,monthly:Array(12).fill(0)});
  for(const raw of p11NormalizeLedger()){
    const r=raw;if(r.status==='void')continue;const y=p11Year(r),k=p11AccountKey(r),m=p11MonthKey(r),month=m?Number(m.slice(5,7))-1:-1;if(!y)continue;
    const yr=yearRow(y),ar=k?accountRow(k,y):null;
    if(P11_EVENT_TYPES.contribution.has(r.type)){yr.contribution+=r.amount;if(k){yr.accountContribution[k]+=r.amount;ar.contribution+=r.amount}}
    if(P11_EVENT_TYPES.dividend.has(r.type)){yr.dividend+=r.amount;if(month>=0&&month<12)yr.monthly[month]+=r.amount;if(ar){ar.dividend+=r.amount;if(month>=0&&month<12)ar.monthly[month]+=r.amount}if(r.assetName){out.dividendsByAsset[y]=out.dividendsByAsset[y]||{};out.dividendsByAsset[y][r.assetName]=(out.dividendsByAsset[y][r.assetName]||0)+r.amount}}
    if(P11_EVENT_TYPES.accountDividend.has(r.type)&&ar){ar.dividend+=r.amount;if(month>=0&&month<12)ar.monthly[month]+=r.amount}
    if(P11_EVENT_TYPES.realized.has(r.type)){yr.realized+=r.amount;if(ar)ar.realized+=r.amount}
    if((r.type==='contribution'||r.type==='contribution-status')&&m&&k){out.status[m]=out.status[m]||{pension:false,irp:false};out.status[m][k]=true}
  }
  return out;
}
function p11SplitTotal(total,year,field){
  total=p11Num(total);const row=state.years?.[year]||{},ac=row.accountContribution||{};
  let p=field==='contribution'?p11Num(ac.pension):p11Num(state.accountYears?.pension?.[year]?.[field]);
  let i=field==='contribution'?p11Num(ac.irp):p11Num(state.accountYears?.irp?.[year]?.[field]);
  let sum=p+i;
  if(sum<=0){const mp=Math.max(0,p11Num(state.settings?.monthly?.pension)),mi=Math.max(0,p11Num(state.settings?.monthly?.irp)),ms=mp+mi;p=ms?total*mp/ms:total;i=total-p;sum=total}
  if(Math.abs(sum-total)>0.5){if(sum){const scale=total/sum;p*=scale;i=total-p}else{p=total;i=0}}
  return {pension:p,irp:i};
}
function p11PushSynthetic(type,{year,month=12,accountKey='',assetName='',amount=0,note=''}){
  if(Math.abs(amount)<0.5)return;
  const monthKey=`${year}-${p11Pad(month)}`;
  state.ledger.push(p11NormalizeRecord({id:p11Uid('legacy'),type,date:`${monthKey}-28T12:00:00.000Z`,monthKey,accountKey,accountId:accountKey?P11_ACCOUNT_ID[accountKey]:'',assetName,amount,source:'v1.1-legacy-adjustment',synthetic:true,note}));
}
function p11SeedLegacy(force=false){
  state.meta=state.meta||{};if(state.meta.ledgerMigrationV11&&!force){p11NormalizeLedger();return false}
  p11NormalizeLedger();
  const existing=p11LedgerTotals();
  for(const y of Object.keys(state.years||{}).map(Number).sort((a,b)=>a-b)){
    const row=state.years[y]||{},ex=existing.years[y]||{contribution:0,dividend:0,realized:0,accountContribution:{pension:0,irp:0}};
    const contributionTarget=p11Num(row.contribution),contributionSplit=p11SplitTotal(contributionTarget,y,'contribution');
    for(const k of P11_ACCOUNT_KEYS)p11PushSynthetic('contribution-adjustment',{year:y,accountKey:k,amount:contributionSplit[k]-p11Num(ex.accountContribution?.[k]),note:'기존 연도 납입 합계 보정'});
    const detailed=(state.dividendsByAsset?.[y]||[]).map(x=>[String(x?.[0]||''),p11Num(x?.[1])]).filter(x=>x[0]&&x[1]);
    const existingAssets=existing.dividendsByAsset[y]||{};
    for(const [name,target] of detailed)p11PushSynthetic('dividend-adjustment',{year:y,assetName:name,amount:target-p11Num(existingAssets[name]),note:'기존 종목별 배당 보정'});
    const afterDetail=p11LedgerTotals().years[y]?.dividend||0,dividendTarget=p11Num(row.dividend),dividendResidual=dividendTarget-afterDetail;
    if(Math.abs(dividendResidual)>=0.5)p11PushSynthetic('dividend-adjustment',{year:y,assetName:'기타·과거기록',amount:dividendResidual,note:'기존 연간 배당 잔액 보정'});
    const dividendSplit=p11SplitTotal(dividendTarget,y,'dividend'),dividendAccounts=p11LedgerTotals().accounts;
    for(const k of P11_ACCOUNT_KEYS)p11PushSynthetic('dividend-account-allocation',{year:y,accountKey:k,amount:dividendSplit[k]-p11Num(dividendAccounts[k]?.[y]?.dividend),note:'기존 계좌별 배당 배분 보정'});
    const currentRealized=p11LedgerTotals().years[y]?.realized||0,realizedResidual=p11Num(row.realized)-currentRealized;
    if(Math.abs(realizedResidual)>=0.5){const split=p11SplitTotal(realizedResidual,y,'realized');for(const k of P11_ACCOUNT_KEYS)p11PushSynthetic('realized-adjustment',{year:y,accountKey:k,amount:split[k],note:'기존 확정손익 보정'})}
  }
  for(const [monthKey,status] of Object.entries(state.runtime?.contributions||{}))for(const k of P11_ACCOUNT_KEYS)if(status?.[k]){
    const exists=state.ledger.some(r=>p11MonthKey(r)===monthKey&&p11AccountKey(r)===k&&(r.type==='contribution'||r.type==='contribution-status'));
    if(!exists)state.ledger.push(p11NormalizeRecord({id:p11Uid('status'),type:'contribution-status',date:`${monthKey}-01T00:00:00.000Z`,monthKey,accountKey:k,accountId:P11_ACCOUNT_ID[k],amount:0,source:'v1.1-status-migration',synthetic:true,note:'기존 납입 완료 상태 이전'}));
  }
  state.meta.ledgerMigrationV11={completedAt:new Date().toISOString(),ledgerSchemaVersion:P11_LEDGER_SCHEMA};p11NormalizeLedger();return true;
}
function p11Rebuild(){
  const totals=p11LedgerTotals(),years=new Set([...Object.keys(state.years||{}).map(Number),...Object.keys(totals.years).map(Number)]);
  state.accountYears=state.accountYears||{pension:{},irp:{}};
  for(const y of years){
    const row=state.years[y]||ensureYear(y),t=totals.years[y]||{contribution:0,dividend:0,realized:0,monthly:Array(12).fill(0),accountContribution:{pension:0,irp:0}};
    row.contribution=Math.round(t.contribution);row.dividend=Math.round(t.dividend);row.realized=Math.round(t.realized);row.monthly=t.monthly.map(Math.round);row.accountContribution={pension:Math.round(t.accountContribution.pension),irp:Math.round(t.accountContribution.irp)};row.operating=(Number(row.end)||0)-(Number(row.start)||0)-row.contribution;{const base=(Number(row.start)||0)+row.contribution/2;row.return=base?row.operating/base*100:0}
    for(const k of P11_ACCOUNT_KEYS){const ar=state.accountYears[k]?.[y]||(state.accountYears[k][y]={start:0,end:0,cumulative:0,contribution:0,operating:0,realized:0,return:0,dividend:0,reinvested:0,monthly:Array(12).fill(0)}),a=totals.accounts[k][y]||{contribution:0,dividend:0,realized:0,monthly:Array(12).fill(0)};ar.contribution=Math.round(a.contribution);ar.dividend=Math.round(a.dividend);ar.realized=Math.round(a.realized);ar.monthly=a.monthly.map(Math.round);ar.operating=(Number(ar.end)||0)-(Number(ar.start)||0)-ar.contribution;const base=(Number(ar.start)||0)+ar.contribution/2;ar.return=base?ar.operating/base*100:0}
  }
  let cumulative=0;for(const y of [...years].sort((a,b)=>a-b)){const row=state.years[y];if(!row)continue;cumulative+=p11Num(row.contribution);row.cumulative=Math.round(cumulative)}
  for(const k of P11_ACCOUNT_KEYS){let accountCumulative=0;for(const y of [...years].sort((a,b)=>a-b)){const ar=state.accountYears[k]?.[y];if(!ar)continue;accountCumulative+=p11Num(ar.contribution);ar.cumulative=Math.round(accountCumulative)}}
  state.runtime=state.runtime||{};state.runtime.contributions=totals.status;
  state.dividendsByAsset=Object.fromEntries(Object.entries(totals.dividendsByAsset).map(([y,map])=>[y,Object.entries(map).filter(([,v])=>Math.abs(v)>=0.5).sort((a,b)=>b[1]-a[1])]));
  state.meta=state.meta||{};state.meta.ledgerSchemaVersion=P11_LEDGER_SCHEMA;state.meta.lastLedgerRebuild=new Date().toISOString();return totals;
}
function p11SyncStatusEvents(){
  p11NormalizeLedger();for(const [monthKey,status] of Object.entries(state.runtime?.contributions||{}))for(const k of P11_ACCOUNT_KEYS)if(status?.[k]){
    const exists=state.ledger.some(r=>p11MonthKey(r)===monthKey&&p11AccountKey(r)===k&&(r.type==='contribution'||r.type==='contribution-status'));
    if(!exists)state.ledger.push(p11NormalizeRecord({id:p11Uid('status'),type:'contribution-status',date:`${monthKey}-01T00:00:00.000Z`,monthKey,accountKey:k,accountId:P11_ACCOUNT_ID[k],amount:0,source:'v1.1-status-sync',note:'납입 완료 상태'}));
  }
}
function p11Record(type,payload={}){
  const normalized=p11NormalizeRecord({id:p11Uid(type),type,...payload});
  if(type==='contribution'){
    const duplicate=state.ledger.some(r=>r.status!=='void'&&r.type==='contribution'&&p11MonthKey(r)===normalized.monthKey&&p11AccountKey(r)===normalized.accountKey);
    if(duplicate)return {ok:false,duplicate:true};
  }
  state.ledger.push(normalized);p11Rebuild();return {ok:true,record:normalized};
}

const P11_EDITABLE_TYPES=new Set(['contribution','dividend','sell']);
const p11Clone=v=>typeof structuredClone==='function'?structuredClone(v):JSON.parse(JSON.stringify(v));
function p11EditableRecord(r){return Boolean(r&&r.status!=='void'&&!r.synthetic&&P11_EDITABLE_TYPES.has(r.type))}
function p11FindRecord(id){return p11NormalizeLedger().find(r=>r.id===id)||null}
function p11FindHolding(r){
  const k=p11AccountKey(r),a=state.accounts?.[k];if(!a)return null;
  return (a.holdings||[]).find(h=>(r.assetId&&h.id===r.assetId)||(!r.assetId&&r.assetName&&h.name===r.assetName))||null;
}
function p11CurrentCashImpact(r){return r.type==='contribution'&&p11MonthKey(r)===CURRENT_KEY?p11Num(r.cashDelta):0}
function p11ApplyBalanceImpact(r,sign){
  const k=p11AccountKey(r),a=state.accounts?.[k];
  if(r.type==='contribution'&&a){a.principal=p11Num(a.principal)+sign*p11Num(r.principalDelta);a.cash=p11Num(a.cash)+sign*p11CurrentCashImpact(r)}
  if(r.type==='dividend'||r.type==='sell'){
    const h=p11FindHolding(r);if(h){const key=r.type==='dividend'?'dividend':'realized';h[key]=p11Num(h[key])+sign*p11Num(r.amount);if(Math.abs(h[key])<0.5)h[key]=0}
  }
}
function p11ContributionYearTotal(year,excludeId=''){
  return p11NormalizeLedger().filter(r=>r.status!=='void'&&r.id!==excludeId&&r.type==='contribution'&&p11Year(r)===year).reduce((sum,r)=>sum+p11Num(r.amount),0);
}
function p11ValidateCandidate(old,candidate){
  if(!p11EditableRecord(old))return {ok:false,message:'이 기록은 자동 이전 자료라 수정할 수 없어요'};
  if(!/^\d{4}-\d{2}-\d{2}$/.test(String(candidate.date||'').slice(0,10))||Number.isNaN(new Date(`${String(candidate.date).slice(0,10)}T00:00:00`).getTime()))return {ok:false,message:'기록일을 확인하세요'};
  if(candidate.type==='contribution'&&candidate.amount<=0)return {ok:false,message:'납입 금액은 0원보다 커야 해요'};
  if(candidate.type==='dividend'&&candidate.amount<=0)return {ok:false,message:'배당 금액은 0원보다 커야 해요'};
  if(candidate.type==='sell'&&candidate.amount===0)return {ok:false,message:'확정손익은 0원이 될 수 없어요'};
  if(candidate.type==='contribution'){
    const duplicate=p11NormalizeLedger().some(r=>r.id!==old.id&&r.status!=='void'&&r.type==='contribution'&&p11MonthKey(r)===candidate.monthKey&&p11AccountKey(r)===p11AccountKey(candidate));
    if(duplicate)return {ok:false,message:'같은 달·같은 계좌의 납입 기록이 이미 있어요'};
    const limit=Math.max(0,p11Num(state.settings?.annualContributionLimit)||18000000),sum=p11ContributionYearTotal(candidate.year,old.id)+candidate.amount;
    if(limit&&sum>limit)return {ok:false,message:`연간 총 납입 한도 ${fmt(limit)}를 넘습니다`};
    const a=state.accounts?.[p11AccountKey(old)],nextPrincipal=p11Num(a?.principal)-p11Num(old.principalDelta)+p11Num(candidate.principalDelta),nextCash=p11Num(a?.cash)-p11CurrentCashImpact(old)+p11CurrentCashImpact(candidate);
    if(nextPrincipal<-.5)return {ok:false,message:'수정 후 납입원금이 음수가 됩니다'};
    if(nextCash<-.5)return {ok:false,message:'현재 현금보다 큰 납입 기록은 취소할 수 없어요. 먼저 자산현황을 갱신하세요'};
  }
  if(candidate.type==='dividend'){
    const h=p11FindHolding(old);if(h&&p11Num(h.dividend)-p11Num(old.amount)+p11Num(candidate.amount)<-.5)return {ok:false,message:'수정 후 누적 분배금이 음수가 됩니다'};
  }
  return {ok:true};
}
function p11BuildCandidate(old,patch={}){
  const date=String(patch.date||old.date||'').slice(0,10),amount=p11Num(patch.amount),candidate=p11NormalizeRecord({...old,date:`${date}T00:00:00.000Z`,monthKey:'',year:0,amount,updatedAt:new Date().toISOString()});
  candidate.id=old.id;candidate.createdAt=old.createdAt;candidate.status='active';candidate.synthetic=false;candidate.accountKey=p11AccountKey(old);candidate.accountId=old.accountId;candidate.assetId=old.assetId;candidate.assetName=old.assetName;candidate.type=old.type;candidate.source=old.source;
  if(candidate.type==='contribution'){candidate.principalDelta=amount;candidate.cashDelta=p11Num(old.cashDelta)!==0?amount:0}
  return candidate;
}
function p11UpdateRecord(id,patch={}){
  const old=p11FindRecord(id);if(!old)return {ok:false,message:'기록을 찾을 수 없어요'};
  const candidate=p11BuildCandidate(old,patch),check=p11ValidateCandidate(old,candidate);if(!check.ok)return check;
  p11ApplyBalanceImpact(old,-1);Object.assign(old,candidate);p11ApplyBalanceImpact(old,1);p11Rebuild();save();renderAll();return {ok:true,record:p11Clone(old)};
}
function p11VoidRecord(id,reason='사용자 삭제'){
  const r=p11FindRecord(id);if(!r)return {ok:false,message:'기록을 찾을 수 없어요'};if(!p11EditableRecord(r))return {ok:false,message:'이 기록은 자동 이전 자료라 삭제할 수 없어요'};
  if(r.type==='contribution'){const a=state.accounts?.[p11AccountKey(r)];if(p11Num(a?.principal)-p11Num(r.principalDelta)<-.5)return {ok:false,message:'삭제 후 납입원금이 음수가 됩니다'};if(p11Num(a?.cash)-p11CurrentCashImpact(r)<-.5)return {ok:false,message:'현재 현금보다 큰 납입 기록은 취소할 수 없어요. 먼저 자산현황을 갱신하세요'}}
  if(r.type==='dividend'){const h=p11FindHolding(r);if(h&&p11Num(h.dividend)-p11Num(r.amount)<-.5)return {ok:false,message:'삭제 후 누적 분배금이 음수가 됩니다'}}
  p11ApplyBalanceImpact(r,-1);r.status='void';r.updatedAt=new Date().toISOString();r.extensions={...(r.extensions||{}),voidedAt:r.updatedAt,voidReason:String(reason||'사용자 삭제')};
  state.archives=state.archives||{};state.archives.records=Array.isArray(state.archives.records)?state.archives.records:[];state.archives.records.push({archiveId:p11Uid('record-archive'),entityType:'ledger-record',entityId:r.id,archivedAt:r.updatedAt,reason:r.extensions.voidReason,data:p11Clone(r)});
  p11Rebuild();save();renderAll();return {ok:true,record:p11Clone(r)};
}
function p11RecentRecords(accountKey,limit=8){return p11NormalizeLedger().filter(r=>p11EditableRecord(r)&&p11AccountKey(r)===accountKey).sort((a,b)=>String(b.date).localeCompare(String(a.date))||String(b.updatedAt).localeCompare(String(a.updatedAt))).slice(0,limit)}
function p11TypeLabel(r){return r.type==='contribution'?'납입':r.type==='dividend'?'배당·분배금':'매도 확정손익'}
function p11OpenRecordEditor(id){
  const r=p11FindRecord(id);if(!p11EditableRecord(r))return toast('수정할 수 없는 기록이에요');
  const title=document.getElementById('formTitle'),body=document.getElementById('formBody'),k=p11AccountKey(r);title.textContent='기록 수정';
  body.innerHTML=`<div class="sheetNotice">기록 ID는 그대로 유지되고, 삭제해도 복원 검사용 취소 이력이 남습니다.</div><div class="settingsInfo"><b>${esc(state.accounts?.[k]?.name||'계좌')} · ${esc(p11TypeLabel(r))}</b>${r.assetName?`<div class="tiny" style="margin-top:5px">${esc(r.assetName)}</div>`:''}</div><div class="field"><label>기록일</label><input id="ledgerEditDate" type="date" value="${esc(String(r.date).slice(0,10))}"></div><div class="field"><label>${r.type==='sell'?'확정손익':'금액'}</label><input id="ledgerEditAmount" inputmode="numeric" value="${esc(String(Math.round(r.amount)))}"><div class="inputHelp">매도 손실은 음수로 입력하세요.</div></div><button class="btn primary full" id="ledgerEditSave">수정 저장</button><button class="btn full ledgerDanger" id="ledgerEditDelete" style="margin-top:10px">기록 삭제</button>`;
  document.getElementById('ledgerEditSave').onclick=()=>{const result=p11UpdateRecord(r.id,{date:document.getElementById('ledgerEditDate').value,amount:parseMoney(document.getElementById('ledgerEditAmount').value)});if(!result.ok)return toast(result.message||'수정하지 못했어요');closeSheet('formSheet');toast('기록을 수정했어요')};
  const del=document.getElementById('ledgerEditDelete');del.onclick=()=>{if(del.dataset.confirm!=='yes'){del.dataset.confirm='yes';del.textContent='한 번 더 누르면 삭제';setTimeout(()=>{if(del.isConnected){del.dataset.confirm='';del.textContent='기록 삭제'}},3000);return}const result=p11VoidRecord(r.id,'사용자 화면 삭제');if(!result.ok)return toast(result.message||'삭제하지 못했어요');closeSheet('formSheet');toast('기록을 삭제하고 취소 이력을 남겼어요')};
  openSheet('formSheet',true);
}
const p11PreviousAccountRender=renderAccount;
renderAccount=function(){
  p11PreviousAccountRender();const k=state.ui.accountView,stack=document.querySelector('#account .stack');if(!stack)return;const rows=p11RecentRecords(k),card=document.createElement('div');card.className='card ledgerManageCard';
  card.innerHTML=`<div class="row"><div><div class="eyebrow">최근 입력 기록</div><b>수정·삭제</b></div><span class="chip">최근 ${rows.length}건</span></div>${rows.length?`<div class="ledgerManageList">${rows.map(r=>`<button class="ledgerManageRow" data-ledger-edit="${esc(r.id)}"><span><b>${esc(p11TypeLabel(r))}${r.assetName?` · ${esc(r.assetName)}`:''}</b><small>${esc(String(r.date).slice(0,10))}</small></span><strong class="${r.amount<0?'bad':''}">${r.amount>=0?'+':''}${fmt(r.amount)}<small>수정 ›</small></strong></button>`).join('')}</div>`:`<div class="empty ledgerEmpty"><b>수정할 직접 입력 기록이 없어요</b><p>자동 이전 자료는 안전을 위해 여기서 수정하지 않습니다.</p></div>`}`;
  stack.appendChild(card);card.querySelectorAll('[data-ledger-edit]').forEach(b=>b.onclick=()=>p11OpenRecordEditor(b.dataset.ledgerEdit));
};
const p11OldRecord=window.PensionV1Record||{};
window.PensionV1Record={...p11OldRecord,ledger(type,payload={}){return p11Record(type,payload)}};
const p11PreviousSave=save;
save=function(){p11SyncStatusEvents();p11NormalizeLedger();p11Rebuild();state.meta.appVersion=P11_VERSION;p11PreviousSave()};
const p11PreviousHome=renderHome;renderHome=function(){p11PreviousHome();const badge=document.querySelector('#home .v0Badge');if(badge)badge.textContent='V1.1';};
const p11PreviousSettings=renderSettings;renderSettings=function(){p11PreviousSettings();const notice=document.querySelector('#settingsBody .sheetNotice');if(notice)notice.textContent=`저장 버튼을 눌러야 반영됩니다. 앱 ${P11_VERSION} · 원장 구조 ${P11_LEDGER_SCHEMA}`;const err=document.getElementById('settingsError');if(err&&!document.querySelector('#settingsBody .v11LedgerNote')){const n=document.createElement('div');n.className='v11LedgerNote';n.textContent='납입·배당·확정손익은 월별 원장을 기준으로 연도별 합계에 자동 반영됩니다.';err.before(n)}};
window.PensionV11Ledger={version:P11_VERSION,ledgerSchemaVersion:P11_LEDGER_SCHEMA,normalize:p11NormalizeLedger,seedLegacy:p11SeedLegacy,rebuild:p11Rebuild,totals:p11LedgerTotals,record:p11Record,update:p11UpdateRecord,void:p11VoidRecord,recent:p11RecentRecords,editable:p11EditableRecord};
document.title='개인연금 V1.1';state.meta=state.meta||{};state.meta.appVersion=P11_VERSION;p11SeedLegacy();p11Rebuild();renderAll(true);save();
})();

