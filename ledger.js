/* 개인연금 V2.0 RC6 - 월별 원장 */
'use strict';
const LEDGER_SCHEMA_VERSION=2;
function recordDateParts(dateOrMonth){
  const text=String(dateOrMonth||'');const monthKey=/^\d{4}-\d{2}$/.test(text)?text:text.slice(0,7);const year=Number(monthKey.slice(0,4));return {monthKey,year};
}
function prepareRecord(type,payload={}){
  const created=payload.createdAt||isoNow(),parts=recordDateParts(payload.monthKey||payload.date||CURRENT_MONTH_KEY);
  return {
    id:payload.id||uid(type),type,date:payload.date||`${parts.monthKey}-01T00:00:00.000Z`,monthKey:parts.monthKey,year:parts.year,
    accountKey:payload.accountKey||'',accountId:payload.accountId||(`account-${payload.accountKey||''}`),assetId:payload.assetId||'',assetName:payload.assetName||'',
    amount:Number(payload.amount)||0,quantity:Number(payload.quantity)||0,realized:Number(payload.realized)||0,
    principalDelta:Number(payload.principalDelta)||0,cashDelta:Number(payload.cashDelta)||0,
    note:payload.note||'',source:payload.source||'manual',synthetic:!!payload.synthetic,status:payload.status||'active',
    createdAt:created,updatedAt:payload.updatedAt||created,recordSchemaVersion:1,ledgerSchemaVersion:LEDGER_SCHEMA_VERSION,extensions:payload.extensions||{}
  };
}
function applyRecordDelta(record,direction=1){
  if(record.status==='cancelled')return;
  const a=state.accounts[record.accountKey];if(!a)return;
  a.principal=Math.max(0,(Number(a.principal)||0)+direction*Number(record.principalDelta||0));
  a.cash=Math.max(0,(Number(a.cash)||0)+direction*Number(record.cashDelta||0));
  if(record.assetName){const h=(a.holdings||[]).find(x=>x.id===record.assetId||x.name===record.assetName);if(h){if(record.type==='dividend')h.dividend=(Number(h.dividend)||0)+direction*Number(record.amount||0);if(record.type==='sell')h.realized=(Number(h.realized)||0)+direction*Number(record.realized||0);h.updatedAt=isoNow()}}
}
function ledgerDuplicate(type,accountKey,monthKey,excludeId=''){
  return state.ledger.some(r=>r.id!==excludeId&&r.status!=='cancelled'&&r.type===type&&r.accountKey===accountKey&&r.monthKey===monthKey);
}
function addContribution({accountKey,amount,monthKey=CURRENT_MONTH_KEY,mode='this-month'}={}){
  if(!['pension','irp'].includes(accountKey))throw new Error('계좌를 확인하세요.');
  const parts=recordDateParts(monthKey);if(!/^\d{4}-\d{2}$/.test(parts.monthKey))throw new Error('월을 확인하세요.');if(parts.monthKey>CURRENT_MONTH_KEY)throw new Error('미래 달은 기록할 수 없습니다.');
  if(ledgerDuplicate('contribution',accountKey,parts.monthKey)||state.runtime?.contributions?.[parts.monthKey]?.[accountKey])throw new Error('같은 달의 납입이 이미 기록되어 있습니다.');
  const value=Math.max(0,Math.round(Number(amount)||0));if(!value)throw new Error('납입 금액을 입력하세요.');
  const isCurrent=parts.monthKey===CURRENT_MONTH_KEY;
  const record=prepareRecord('contribution',{accountKey,amount:value,monthKey:parts.monthKey,principalDelta:isCurrent?value:0,cashDelta:isCurrent?value:0,note:isCurrent?'이번 달 실제 납입':'과거 납입 확인 · 현재 잔고 미변경',source:'manual'});
  state.ledger.push(record);state.runtime.contributions[parts.monthKey]=state.runtime.contributions[parts.monthKey]||{};state.runtime.contributions[parts.monthKey][accountKey]=true;
  applyRecordDelta(record,1);rebuildYear(parts.year);saveState({quiet:true});return record;
}
function addCashflow({type,accountKey,assetId='',assetName='',amount=0,realized=0,date=new Date().toISOString().slice(0,10),note=''}={}){
  if(!['dividend','sell'].includes(type))throw new Error('기록 종류를 확인하세요.');if(!state.accounts[accountKey])throw new Error('계좌를 확인하세요.');
  const monthKey=String(date).slice(0,7);if(monthKey>CURRENT_MONTH_KEY)throw new Error('미래 날짜는 기록할 수 없습니다.');
  const value=Math.round(Number(amount)||0),profit=Math.round(Number(realized)||0);if(type==='dividend'&&value<=0)throw new Error('배당·분배금 금액을 입력하세요.');
  const record=prepareRecord(type,{accountKey,assetId,assetName,amount:value,realized:profit,date:`${String(date).slice(0,10)}T12:00:00.000Z`,monthKey,cashDelta:type==='dividend'?value:0,note,source:'manual'});
  state.ledger.push(record);applyRecordDelta(record,1);rebuildYear(record.year);saveState({quiet:true});return record;
}
function updateLedgerRecord(id,changes={}){
  const index=state.ledger.findIndex(r=>r.id===id);if(index<0)throw new Error('기록을 찾지 못했습니다.');const old=state.ledger[index];if(old.synthetic)throw new Error('이전 데이터 보정 기록은 직접 수정할 수 없습니다.');
  applyRecordDelta(old,-1);const next=prepareRecord(old.type,{...old,...changes,id:old.id,createdAt:old.createdAt,updatedAt:isoNow()});if(next.type==='contribution'&&ledgerDuplicate('contribution',next.accountKey,next.monthKey,id)){applyRecordDelta(old,1);throw new Error('같은 달의 납입이 이미 기록되어 있습니다.');}
  state.ledger[index]=next;applyRecordDelta(next,1);rebuildYear(old.year);if(next.year!==old.year)rebuildYear(next.year);saveState({quiet:true});return next;
}
function cancelLedgerRecord(id){
  const r=state.ledger.find(x=>x.id===id);if(!r)throw new Error('기록을 찾지 못했습니다.');if(r.synthetic)throw new Error('이전 데이터 보정 기록은 취소할 수 없습니다.');if(r.status==='cancelled')return r;
  applyRecordDelta(r,-1);r.status='cancelled';r.cancelledAt=isoNow();r.updatedAt=isoNow();state.archives.records.push(clone(r));
  if(r.type==='contribution'&&state.runtime?.contributions?.[r.monthKey])state.runtime.contributions[r.monthKey][r.accountKey]=false;
  rebuildYear(r.year);saveState({quiet:true});return r;
}
function rebuildYear(year){
  const key=String(year),row=state.years[key]||{start:0,end:0,cumulative:0,contribution:0,operating:0,realized:0,return:0,dividend:0,reinvested:0,monthly:Array(12).fill(0),accountContribution:{pension:0,irp:0}};
  const explicit=activeRecords().filter(r=>r.type==='contribution'&&Number(r.year)===Number(year));
  if(explicit.length){row.accountContribution={pension:0,irp:0};for(const r of explicit)row.accountContribution[r.accountKey]=(row.accountContribution[r.accountKey]||0)+Number(r.amount||0);row.contribution=Object.values(row.accountContribution).reduce((s,n)=>s+n,0);}
  row.dividend=yearDividend(year,'all');row.realized=yearRealized(year,'all');row.monthly=Array.from({length:12},(_,i)=>activeRecords().filter(r=>r.type==='dividend'&&Number(r.year)===Number(year)&&Number(String(r.monthKey).slice(5,7))===i+1).reduce((s,r)=>s+Number(r.amount||0),0));
  state.years[key]=row;
}
function recentRecords(scope='all',limit=8){return activeRecords().filter(r=>!r.synthetic&&['contribution','dividend','sell','snapshot'].includes(r.type)&&(scope==='all'||r.accountKey===scope)).sort((a,b)=>String(b.date).localeCompare(String(a.date))).slice(0,limit)}
function archiveMissingHoldings(accountKey,nextRows,reason='snapshot-replaced'){
  const a=state.accounts[accountKey],names=new Set(nextRows.map(r=>r.name));for(const h of a.holdings||[])if(!names.has(h.name))state.archives.holdings.push({...clone(h),archivedAt:isoNow(),archiveReason:reason,status:'archived'});
}
function prepareHolding(accountKey,h,previous={}){return normalizeHolding(accountKey,{...previous,...h,id:previous.id||h.id,createdAt:previous.createdAt||h.createdAt,updatedAt:isoNow()},0)}
function applySnapshot(accountKey,rows,total=0,{source='manual'}={}){
  const a=state.accounts[accountKey];if(!a)throw new Error('계좌를 확인하세요.');const clean=rows.map((r,i)=>prepareHolding(accountKey,r,(a.holdings||[]).find(h=>h.id===r.id||h.name===r.name)||{}));
  const names=clean.map(r=>r.name);if(new Set(names).size!==names.length)throw new Error('중복 종목이 있습니다.');if(clean.some(r=>r.value<0||r.cost<0||r.qty<0))throw new Error('수량과 금액을 확인하세요.');
  const sum=clean.reduce((s,r)=>s+r.value,0),accountTotalValue=Math.max(sum,Number(total)||sum);if(accountTotalValue<sum)throw new Error('계좌 총액이 종목 합계보다 작습니다.');
  archiveMissingHoldings(accountKey,clean,`${source}-replaced`);a.holdings=clean;a.cash=accountTotalValue-sum;if(!a.principal)a.principal=clean.reduce((s,r)=>s+r.cost,0)+a.cash;a.updatedAt=isoNow();
  state.lastUpdated=`${CURRENT_YEAR}.${String(CURRENT_MONTH).padStart(2,'0')}.${String(now.getDate()).padStart(2,'0')}`;const snap={id:uid('snapshot'),accountKey,accountId:a.id,createdAt:isoNow(),effectiveDate:state.lastUpdated,reason:source,holdings:clone(clean),cash:a.cash,total:accountTotalValue};state.snapshots.push(snap);state.ledger.push(prepareRecord('snapshot',{accountKey,date:isoNow(),note:`자산현황 갱신 · ${clean.length}개 상품`,source}));saveState({quiet:true});return snap;
}
window.PensionLedger={prepareRecord,addContribution,addCashflow,updateLedgerRecord,cancelLedgerRecord,rebuildYear,recentRecords,archiveMissingHoldings,prepareHolding,applySnapshot,ledgerDuplicate};
