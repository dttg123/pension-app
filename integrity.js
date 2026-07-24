/* 개인연금 V2.0 RC6 - 무결성·스트레스 검사 */
'use strict';
(function(){
function pass(name,detail='정상'){return {name,ok:true,detail}}
function fail(name,error){return {name,ok:false,detail:String(error?.message||error)}}
function idsOf(s){
  const rows=[];
  rows.push(['data',s.dataId]);
  Object.values(s.accounts||{}).forEach(a=>{rows.push(['account',a.id]);(a.holdings||[]).forEach(h=>rows.push(['holding',h.id]))});
  (s.ledger||[]).forEach(r=>rows.push(['ledger',r.id]));
  (s.snapshots||[]).forEach(r=>rows.push(['snapshot',r.id]));
  return rows;
}
function duplicateIds(s){const seen=new Set(),dupes=[];for(const [type,id] of idsOf(s)){if(!id)dupes.push(`${type}:빈 ID`);else if(seen.has(id))dupes.push(id);else seen.add(id)}return dupes}
function mediaTrace(s){
  const hits=[];
  const walk=(v,path='root')=>{
    if(v==null)return;
    if(typeof Blob!=='undefined'&&v instanceof Blob){hits.push(`${path}:Blob`);return}
    if(typeof File!=='undefined'&&v instanceof File){hits.push(`${path}:File`);return}
    if(typeof v==='string'&&(/^(data:image\/|blob:)/i.test(v)||v.length>100000&&/^[A-Za-z0-9+/=]+$/.test(v.slice(0,1000))))hits.push(`${path}:image/base64`);
    if(Array.isArray(v))v.forEach((x,i)=>walk(x,`${path}[${i}]`));
    else if(typeof v==='object')Object.entries(v).forEach(([k,x])=>walk(x,`${path}.${k}`));
  };walk(s);return hits;
}
function negativeValues(s){const hits=[];for(const [key,a] of Object.entries(s.accounts||{})){if(Number(a.principal)<0||Number(a.cash)<0)hits.push(`${key}:계좌`);for(const h of a.holdings||[])if(Number(h.value)<0||Number(h.cost)<0||Number(h.qty)<0)hits.push(`${key}:${h.name}`)}return hits}
function totalsAgree(s){const accountSum=Object.values(s.accounts||{}).reduce((sum,a)=>sum+accountTotal(a),0);return Math.abs(accountSum-totalAsset())<1}
function scenario(name,mutator){const original=state;try{state=ensureSchema6(clone(original));mutator?.(state);const o=retirementOutlook();if(!Number.isFinite(o.base.futureAsset)||!Number.isFinite(o.base.realMonthly)||o.base.futureAsset<0||o.base.realMonthly<0)throw new Error('미래 계산값 오류');return pass(name,`미래자산 ${Math.round(o.base.futureAsset)} · 월인출 ${Math.round(o.base.realMonthly)}`)}catch(e){return fail(name,e)}finally{state=original}}
function baseChecks(){
  const out=[];
  try{const v=PensionBackup.validateData(state);out.push(v.ok?pass('현재 데이터 구조 검사') : fail('현재 데이터 구조 검사',v.errors.join(', ')))}catch(e){out.push(fail('현재 데이터 구조 검사',e))}
  const d=duplicateIds(state);out.push(d.length?fail('ID 고유성',d.join(', ')):pass('ID 고유성',`${idsOf(state).length}개 ID`));
  const media=mediaTrace(state);out.push(media.length?fail('사진 원본 미저장',media.join(', ')):pass('사진 원본 미저장'));
  const neg=negativeValues(state);out.push(neg.length?fail('음수·이상 자산 차단',neg.join(', ')):pass('음수·이상 자산 차단'));
  out.push(totalsAgree(state)?pass('계좌 합계와 통합 합계 대조'):fail('계좌 합계와 통합 합계 대조','합계 불일치'));
  const all=scopeTotal('all'),parts=scopeTotal('pension')+scopeTotal('irp');out.push(Math.abs(all-parts)<1?pass('연금저축·IRP 통합 계산'):fail('연금저축·IRP 통합 계산','통합 합계 불일치'));
  const diagnosis=pensionDiagnosis();out.push(diagnosis&&diagnosis.action&&diagnosis.reason?pass('진단 행동 문장',diagnosis.action):fail('진단 행동 문장','행동 또는 근거 없음'));
  out.push(PensionOCR?.parserAudit?.().ok?pass('OCR 숫자 파서'):fail('OCR 숫자 파서','표준 샘플 인식 실패'));
  return out;
}
function stressChecks(){
  const out=[];
  out.push(scenario('30년 정상 적립',s=>{s.profile.birthYear=CURRENT_YEAR-30;s.profile.age=30;s.profile.retirementAge=60;s.settings.returnRate=5;s.settings.monthly={pension:500000,irp:250000}}));
  out.push(scenario('장기 급락 후 회복',s=>{s.profile.birthYear=CURRENT_YEAR-30;s.profile.age=30;s.profile.retirementAge=65;s.settings.returnRate=-3;s.settings.monthly={pension:500000,irp:250000}}));
  out.push(scenario('납입 중단',s=>{s.settings.monthly={pension:0,irp:0};s.settings.returnRate=3}));
  out.push(scenario('자산 0원',s=>{for(const a of Object.values(s.accounts)){a.principal=0;a.cash=0;a.holdings=[]}s.years={};s.ledger=[]}));
  out.push(scenario('초고액 자산',s=>{s.accounts.pension.principal=1e14;s.accounts.pension.holdings=[normalizeHolding('pension',{name:'초고액 검증',value:1.5e14,cost:1e14,qty:1},0)]}));
  const original=state;
  try{
    state=ensureSchema6(clone(original));state.ledger=[];
    const start=CURRENT_YEAR-29;
    for(let y=start;y<=CURRENT_YEAR;y++)for(let m=1;m<=12;m++)for(const accountKey of ['pension','irp'])for(let i=0;i<15;i++)state.ledger.push(prepareRecord(i%3===0?'dividend':'snapshot',{id:`stress-${y}-${m}-${accountKey}-${i}`,accountKey,date:`${y}-${String(m).padStart(2,'0')}-15T12:00:00.000Z`,monthKey:`${y}-${String(m).padStart(2,'0')}`,year:y,amount:i*1000,source:'stress'}));
    const t0=performance.now();const rows=activeRecords();const elapsed=performance.now()-t0;
    out.push(rows.length===10800?pass('원장 10,800건',`${elapsed.toFixed(1)}ms`):fail('원장 10,800건',`${rows.length}건`));
  }catch(e){out.push(fail('원장 10,800건',e))}finally{state=original}
  try{const originalState=state;state=ensureSchema6(clone(originalState));state.ledger=[];const r=prepareRecord('contribution',{accountKey:'pension',date:`${CURRENT_MONTH_KEY}-05T12:00:00.000Z`,monthKey:CURRENT_MONTH_KEY,year:CURRENT_YEAR,amount:100000});state.ledger.push(r);const duplicate=ledgerDuplicate('contribution','pension',CURRENT_MONTH_KEY);out.push(duplicate?pass('중복 납입 차단'):fail('중복 납입 차단','중복을 찾지 못함'));state=originalState}catch(e){out.push(fail('중복 납입 차단',e))}
  return out;
}
async function backupChecks(){const out=[];try{const b=await PensionBackup.buildDataBackup(state),v=await PensionBackup.verifyDataBackup(b.bytes);out.push(v.ok?pass('데이터 ZIP 생성·재검증',`${b.bytes.length} bytes`):fail('데이터 ZIP 생성·재검증',v.errors.join(', ')));if(v.ok){const before=JSON.stringify(PensionState.stateCore(state)),after=JSON.stringify(PensionState.stateCore(v.data));out.push(before===after?pass('ZIP 복원 원본 완전 일치'):fail('ZIP 복원 원본 완전 일치','표준 데이터 불일치'))}}catch(e){out.push(fail('데이터 ZIP 생성·재검증',e))}return out}
function domChecks(){const out=[];const ids=[...document.querySelectorAll('[id]')].map(x=>x.id),dupes=ids.filter((id,i)=>ids.indexOf(id)!==i);out.push(dupes.length?fail('DOM ID 고유성',dupes.join(', ')):pass('DOM ID 고유성'));const overflow=Math.max(document.documentElement.scrollWidth,document.body.scrollWidth)-innerWidth;out.push(overflow<=2?pass('모바일 가로 넘침',`${overflow}px`):fail('모바일 가로 넘침',`${overflow}px`));const nav=[...document.querySelectorAll('.nav button')];out.push(nav.length===4?pass('하단 4탭'):fail('하단 4탭',`${nav.length}개`));return out}
async function runFullAudit({includeDom=true}={}){const started=performance.now();const results=[...baseChecks(),...stressChecks(),...(includeDom?domChecks():[]),...await backupChecks()];const failed=results.filter(x=>!x.ok);const report={appVersion:APP_VERSION,schemaVersion:SCHEMA_VERSION,createdAt:isoNow(),durationMs:Math.round(performance.now()-started),passed:results.length-failed.length,failed:failed.length,results};state.meta.storage.lastValidation=failed.length?'실패':'정상';return report}
window.PensionIntegrity={runFullAudit,baseChecks,stressChecks,domChecks,duplicateIds,mediaTrace};
})();
