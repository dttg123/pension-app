/* 개인연금 V2.3 데이터·백업 엔진 */

/* ===== js/50-data-engine.js ===== */
(()=>{
'use strict';
const V1_APP_VERSION='2.3.0';
const V1_SCHEMA_VERSION=6;
const V1_BACKUP_FORMAT='1.1';
const V1_PROJECT_BACKUP_FORMAT='1.0';
const V1_PROJECT_ASSETS=['index.html','base.css','components.css','features.css','v21.css','core.js','ui.js','analysis.js','ocr.js','backup.js','planning.js','ledger.js','coach.js','integrity.js','v21.js','manifest.webmanifest','sw.js','icon.svg'];
const V1_DB_NAME='investment-os-pension-v1';
const V1_DB_VERSION=1;
const V1_STORE='records';
const V1_CURRENT='current';
const V1_SAFETY='pre-restore-safety';
const V1_REQUIRED=['full-backup.json','accounts.csv','transactions.csv','contributions.csv','dividends.csv','snapshots.csv','archived-holdings.csv','settings.csv','backup-schema.txt','recovery-guide.md','manifest.json'];
const v1Enc=new TextEncoder(),v1Dec=new TextDecoder();
const v1Uid=(prefix='id')=>`${prefix}-${(crypto.randomUUID?.()||`${Date.now()}-${Math.random().toString(16).slice(2)}`)}`;
const v1DateTime=()=>new Date().toISOString();
const v1LocalTime=()=>new Date().toLocaleString('ko-KR',{year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'});
const v1FileStamp=()=>{const d=new Date(),p=n=>String(n).padStart(2,'0');return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`};
let v1DBPromise=null,v1PersistTimer=null,v1PersistRunning=false,v1PersistQueued=false,v1RestoreCandidate=null,v1LastCore='';
function v1ContributionStatusText(){
  const status=currentContributionStatus(),keys=['pension','irp'],labels={pension:'연금저축',irp:'IRP'},planned=keys.filter(k=>Number(state.settings?.monthly?.[k])>0);
  if(!planned.length)return {planned,total:0,label:'납입 계획 없음',chips:[]};
  const chips=planned.map(k=>({key:k,name:labels[k],done:!!status[k],amount:Number(state.settings.monthly[k])||0})),done=chips.filter(x=>x.done).length;
  return {planned,total:chips.reduce((s,x)=>s+x.amount,0),label:done===chips.length?'이번 달 완료':done?`${done}/${chips.length} 계좌 완료`:'아직 기록 전',chips};
}

function v1EnsureState(target=state){
  if(typeof coreEnsureSchema6==='function')target=coreEnsureSchema6(target);
  if(Number(target.schemaVersion)>V1_SCHEMA_VERSION){target.meta=target.meta||{};target.meta.storage={localStatus:'읽기 전용',cloudStatus:'중단',driveStatus:'중단',lastLocalSave:'',lastCloudSave:'',lastDriveBackup:'',lastBackup:'',lastRestore:'',lastValidation:'',...(target.meta.storage||{})};return target;}
  target.settings=target.settings||{};
  if(!Number.isFinite(Number(target.settings.annualContributionLimit)))target.settings.annualContributionLimit=18000000;
  if(!Number.isFinite(Number(target.settings.taxCreditLimit)))target.settings.taxCreditLimit=9000000;
  target.ledger=Array.isArray(target.ledger)?target.ledger:[];target.snapshots=Array.isArray(target.snapshots)?target.snapshots:[];target.archives=target.archives||{holdings:[],records:[],snapshots:[]};target.extensions=target.extensions&&typeof target.extensions==='object'&&!Array.isArray(target.extensions)?target.extensions:{};
  target.meta=target.meta||{};target.meta.appVersion=V1_APP_VERSION;target.meta.dataModel={name:'personal-pension-standard',schemaVersion:V1_SCHEMA_VERSION,contractVersion:'1.0',deletionPolicy:'archive-not-destroy',...(target.meta.dataModel||{})};target.meta.dataModel.schemaVersion=V1_SCHEMA_VERSION;target.meta.identityContractVersion='1.0';
  target.meta.storage={localStatus:'대기',cloudStatus:'연결 전',driveStatus:'연결 전',lastLocalSave:'',lastCloudSave:'',lastDriveBackup:'',lastBackup:'',lastRestore:'',lastValidation:'',...(target.meta.storage||{})};
  return target;
}
function v1CoreObject(s){return {appId:s.appId,dataId:s.dataId,schemaVersion:s.schemaVersion,profile:s.profile,settings:s.settings,accounts:s.accounts,years:s.years,accountYears:s.accountYears,dividendsByAsset:s.dividendsByAsset,runtime:s.runtime,ledger:s.ledger,snapshots:s.snapshots,archives:s.archives,extensions:s.extensions,lastUpdated:s.lastUpdated}}
function v1CoreSignature(s){try{return JSON.stringify(v1CoreObject(s))}catch(_){return ''}}
function v1AccountHoldingSignature(s){try{return JSON.stringify(Object.fromEntries(Object.entries(s.accounts||{}).map(([k,a])=>[k,(a.holdings||[]).map(h=>[h.id,h.name,h.qty,h.value,h.cost,h.class])])))}catch(_){return ''}}
function v1ContributionMap(s){return s.runtime?.contributions||{}}
function v1AddLedger(type,payload={}){state.ledger.push({id:v1Uid(type),type,date:payload.date||v1DateTime(),accountId:payload.accountId||'',assetId:payload.assetId||'',assetName:payload.assetName||'',amount:Number(payload.amount)||0,quantity:Number(payload.quantity)||0,note:payload.note||'',source:payload.source||'app',createdAt:v1DateTime(),...payload})}
window.PensionV1Record={
  ledger(type,payload={}){v1AddLedger(type,payload)},
  snapshot(reason='asset-update',effectiveDate=''){
    /* V2.3: 종목별 상세 스냅샷은 누적하지 않는다. 최신 보유자산은 현재 상태로 유지하고,
       장기 그래프용 월별 요약 1건만 갱신한다. 구버전 snapshots 배열은 복원 호환용으로만 보존한다. */
    window.PensionV21?.upsertMonthlySummary?.();
    v1AddLedger('snapshot',{date:v1DateTime(),note:`자산현황 갱신 · ${effectiveDate||state.lastUpdated||''}`,source:'monthly-summary'});
  }
};
function v1DetectChanges(previous,current){
  /* V1.0 build.3: 원장은 합계 변화로 추정하지 않는다.
     사용자가 확정한 납입·배당·매도·자산현황 입력 시점에 정확한 날짜/계좌/상품으로 직접 기록한다. */
}


function v1OpenDB(){if(v1DBPromise)return v1DBPromise;v1DBPromise=new Promise((resolve,reject)=>{const req=indexedDB.open(V1_DB_NAME,V1_DB_VERSION);req.onupgradeneeded=()=>{if(!req.result.objectStoreNames.contains(V1_STORE))req.result.createObjectStore(V1_STORE)};req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error)});return v1DBPromise}
async function v1DBPut(key,value){const db=await v1OpenDB();return new Promise((resolve,reject)=>{const tx=db.transaction(V1_STORE,'readwrite');tx.objectStore(V1_STORE).put(value,key);tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error)})}
async function v1DBGet(key){const db=await v1OpenDB();return new Promise((resolve,reject)=>{const tx=db.transaction(V1_STORE,'readonly'),r=tx.objectStore(V1_STORE).get(key);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)})}
function v1Adapters(){return window.PensionStorageAdapters||{}}
async function v1PersistNow(){
  if(v1PersistRunning){v1PersistQueued=true;return}v1PersistRunning=true;
  try{
    v1EnsureState();if(state.meta?.compatibilityReadOnly)throw new Error('더 새로운 데이터 구조라 저장할 수 없습니다.');state.meta.storage.localStatus='저장 중';v1RefreshDataCenter();
    const copy=clone(state);await v1DBPut(V1_CURRENT,copy);state.meta.storage.localStatus='정상';state.meta.storage.lastLocalSave=v1LocalTime();
    const cloud=v1Adapters().cloud;
    if(cloud?.save){state.meta.storage.cloudStatus='동기화 중';v1RefreshDataCenter();try{const result=await cloud.save(clone(state));state.meta.storage.cloudStatus='정상';state.meta.storage.lastCloudSave=v1LocalTime();state.meta.storage.cloudRevision=result?.revision||state.meta.revision||0}catch(e){state.meta.storage.cloudStatus='실패';state.meta.storage.cloudError=String(e?.message||e)}}else state.meta.storage.cloudStatus='연결 전';
    try{localStorage.setItem('pension-v1',JSON.stringify(state))}catch(_){ }
  }catch(e){state.meta.storage.localStatus='실패';state.meta.storage.localError=String(e?.message||e)}finally{v1PersistRunning=false;v1RefreshDataCenter();if(v1PersistQueued){v1PersistQueued=false;v1PersistNow()}}
}
function v1QueuePersist(){clearTimeout(v1PersistTimer);v1PersistTimer=setTimeout(v1PersistNow,120)}
async function v1Hydrate(){
  const startedSignature=dataSignature(state);
  try{
    const saved=await v1DBGet(V1_CURRENT);
    if(saved&&dataSignature(state)===startedSignature){
      const candidate=v1EnsureState(clone(saved)),a=Date.parse(candidate.meta?.updatedAt||0)||0,b=Date.parse(state.meta?.updatedAt||0)||0;
      if(a>b||(Number(candidate.meta?.revision)||0)>(Number(state.meta?.revision)||0)){
        state=candidate;lastSignature=dataSignature(state);renderAll(true);toast('V1 기기 저장 데이터를 불러왔어요');
      }
    }
  }catch(e){state.meta.storage.localStatus='실패';state.meta.storage.localError=String(e?.message||e)}
  finally{v1EnsureState();v1LastCore=v1CoreSignature(state);if(!state.meta?.compatibilityReadOnly)v1QueuePersist()}
}


const v1OriginalSave=save;
save=function(){v1EnsureState();if(state.meta?.compatibilityReadOnly)return v1OriginalSave();const before=v1LastCore?JSON.parse(v1LastCore):null,currentCore=v1CoreObject(state);if(before)v1DetectChanges(before,currentCore);v1LastCore=JSON.stringify(v1CoreObject(state));state.meta.appVersion=V1_APP_VERSION;state.schemaVersion=V1_SCHEMA_VERSION;v1OriginalSave();v1QueuePersist()};

function v1GoalStatus(){const final=projection().at(-1).end,nominal=expectedMonthly(final),years=Math.max(0,state.profile.retirementAge-state.profile.age),factor=Math.pow(1+Number(state.settings.inflation||0)/100,years),real=factor?nominal/factor:nominal,goal=Number(state.settings.goalMonthly)||0,p=goal?clamp(real/goal*100,0,999):100;return {final,nominal,real,goal,p,gap:goal-real,years,factor}}
goalStatus=v1GoalStatus;
function v1AnnualStatus(){const paid=Number(ensureYear().contribution)||0,planned=(Number(state.settings.monthly.pension)||0)+(Number(state.settings.monthly.irp)||0),annualPlan=planned*12,limit=Math.max(0,Number(state.settings.annualContributionLimit)||0),taxLimit=Math.max(0,Number(state.settings.taxCreditLimit)||0);return {paid,annualPlan,limit,taxLimit,limitRemain:Math.max(0,limit-paid),taxUsed:Math.min(paid,taxLimit),taxRemain:Math.max(0,taxLimit-paid)}}
renderHome=function(){
  v1EnsureState();const total=totalAsset(),principal=totalPrincipal(),profit=total-principal,ret=principal?profit/principal*100:0,goal=v1GoalStatus(),annual=v1AnnualStatus(),status=v1ContributionStatusText();
  const accountCards=Object.entries(state.accounts).map(([k,a])=>{const at=accountTotal(a),ap=at-a.principal,share=total?at/total*100:0;return `<button class="accountLink" data-account-link="${k}"><div><strong>${esc(a.name)}</strong><small class="tiny">전체의 ${share.toFixed(1)}%</small></div><span class="go">›</span><div class="accountStats"><div><span>원금</span><b>${man(a.principal)}</b></div><div><span>손익</span><b class="${ap>=0?'good':'bad'}">${ap>=0?'+':''}${man(ap)}</b></div><div><span>수익률</span><b class="${accountReturn(a)>=0?'good':'bad'}">${pct(accountReturn(a))}</b></div></div></button>`}).join('');
  document.getElementById('home').innerHTML=`<div class="stack homeCompact">
    <section class="card hero pressable" id="totalCard"><div class="heroTop"><div class="eyebrow">개인연금 총자산</div><div style="display:flex;align-items:center;gap:8px"><span class="v1Badge">V1.2</span><span class="chevron ${state.ui.homeExpanded?'open':''}" id="totalChevron">⌄</span></div></div><div class="money">${fmt(total)}</div><div class="${profit>=0?'good':'bad'}" style="font-weight:900">누적 운용증가 ${profit>=0?'+':''}${fmt(profit)} · ${pct(ret)}</div><div class="metricGrid"><div class="metric"><small>누적 순납입</small><b>${fmt(principal)}</b></div><div class="metric accent"><small>마지막 갱신</small><b>${esc(state.lastUpdated)}</b></div></div><div class="expand ${state.ui.homeExpanded?'open':''}" id="accountExpand"><div>${accountCards}</div></div></section>
    <button class="homeAction" id="homeContribution"><div class="homeActionTop"><div><div class="eyebrow">${CURRENT_MONTH}월 납입</div><div class="homeActionTitle">${status.label}</div></div><div class="homeActionValue">${fmt(status.total)}</div></div><div class="statusChips">${status.chips.length?status.chips.map(x=>`<span class="statusChip ${x.done?'done':'wait'}">${esc(x.name)} ${x.done?'완료':'대기'}</span>`).join(''):'<span class="statusChip">납입 계획 없음</span>'}</div></button>
    <button class="homeAction" id="homeGoal"><div class="homeGoalGrid"><div class="goalRing" style="--p:${Math.min(goal.p,100)}"><b>${Math.round(goal.p)}%</b></div><div class="goalText"><b>현재가치 목표 월연금 ${goal.gap<=0?'달성권':'진행 중'}</b><p>현재 돈 가치 월 ${man(goal.real)} · 목표 ${man(goal.goal)}${goal.gap>0?` · ${man(goal.gap)} 부족`:''}</p><div class="goalDetails"><div class="goalDetail"><small>${state.profile.retirementAge}세 첫 월수령 예상</small><b>${man(goal.nominal)}</b></div><div class="goalDetail"><small>물가 환산 기간</small><b>${goal.years}년 · ${state.settings.inflation}%</b></div></div></div><span class="homeGoalArrow">›</span></div></button>
    <button class="homeLimitCard" id="homeAnnual"><div class="limitTop"><div><div class="eyebrow">${CURRENT_YEAR}년 총납입</div><strong>${fmt(annual.paid)}</strong></div><span>현재 계획 연 ${fmt(annual.annualPlan)}</span></div><div class="progress"><i style="width:${annual.taxLimit?clamp(annual.taxUsed/annual.taxLimit*100,0,100):0}%"></i></div><div class="limitGrid"><div class="limitBox blueBox"><small>세액공제 한도까지</small><b>${fmt(annual.taxRemain)} 남음</b></div><div class="limitBox"><small>연금계좌 납입 한도까지</small><b>${fmt(annual.limitRemain)} 남음</b></div></div><div class="limitNote">설정 한도: 세액공제 ${fmt(annual.taxLimit)} · 총 납입 ${fmt(annual.limit)}</div></button>
  </div>`;
  document.getElementById('totalCard').addEventListener('click',e=>{if(e.target.closest('[data-account-link]'))return;state.ui.homeExpanded=!state.ui.homeExpanded;document.getElementById('accountExpand').classList.toggle('open',state.ui.homeExpanded);document.getElementById('totalChevron').classList.toggle('open',state.ui.homeExpanded);save()});
  document.querySelectorAll('[data-account-link]').forEach(b=>b.onclick=e=>{e.stopPropagation();navigate('account',b.dataset.accountLink)});
  document.getElementById('homeContribution').onclick=()=>quickForm('contribution');document.getElementById('homeAnnual').onclick=()=>quickForm('contribution');document.getElementById('homeGoal').onclick=()=>navigate('future');
};

/* one stable FAB instance: independent of scroll direction */
const v1OldFab=document.getElementById('fab'),v1Fab=v1OldFab.cloneNode(true);v1OldFab.replaceWith(v1Fab);let v1FabTimer=null;
function v1FabHide(){clearTimeout(v1FabTimer);v1Fab.classList.remove('fabVisible')}
function v1FabShow(){const screen=state.ui.screen||'home';if(!['home','account'].includes(screen)||document.body.classList.contains('charting'))return v1FabHide();v1Fab.classList.add('fabVisible');clearTimeout(v1FabTimer);v1FabTimer=setTimeout(v1FabHide,10000)}
v1Fab.onclick=()=>{v1FabHide();openSheet('quickSheet')};
document.addEventListener('pointerdown',e=>{if(e.target===v1Fab)return;if(!document.querySelector('.overlay.open'))v1FabShow()},{passive:true});
document.addEventListener('keydown',()=>{if(!document.querySelector('.overlay.open'))v1FabShow()});
const v1Navigate=navigate;navigate=function(screen,accountKey=null){v1Navigate(screen,accountKey);requestAnimationFrame(()=>screen==='home'||screen==='account'?v1FabShow():v1FabHide())};

/* fixed settings icon */
const v1SettingsBtn=document.getElementById('settingsBtn');v1SettingsBtn.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h10M18 7h2M4 17h2M10 17h10M8 4v6M16 14v6"></path><circle cx="8" cy="7" r="2"></circle><circle cx="16" cy="17" r="2"></circle></svg>';

function v1CsvCell(v){let s=String(v??'');if(/^[=+\-@\t\r]/.test(s))s="'"+s;return /[",\n]/.test(s)?`"${s.replace(/"/g,'""')}"`:s}
function v1Csv(rows,headers){return '\uFEFF'+[headers.join(','),...rows.map(r=>headers.map(h=>v1CsvCell(r[h])).join(','))].join('\r\n')}
function v1Counts(data){const ledger=data.ledger||[],contributionTypes=new Set(['contribution','contribution-adjustment']),dividendTypes=new Set(['dividend','dividend-adjustment','dividend-account-allocation']);return {accounts:Object.keys(data.accounts||{}).length,holdings:Object.values(data.accounts||{}).reduce((s,a)=>s+(a.holdings||[]).length,0),transactions:ledger.length,contributions:ledger.filter(r=>contributionTypes.has(r.type)).length,dividends:ledger.filter(r=>dividendTypes.has(r.type)).length,snapshots:(data.snapshots||[]).length,years:Object.keys(data.years||{}).length,archivedHoldings:(data.archives?.holdings||[]).length,totalAssets:Object.values(data.accounts||{}).reduce((sum,a)=>sum+(Number(a.cash)||0)+(a.holdings||[]).reduce((s,h)=>s+(Number(h.value)||0),0),0)} }
function v1FilesFromState(data){
  const accounts=[];for(const [key,a] of Object.entries(data.accounts||{})){accounts.push({rowType:'account',accountId:a.id||`account-${key}`,accountName:a.name,holdingId:'',assetName:'',assetClass:'',quantity:'',cost:'',marketValue:'',cash:a.cash,principal:a.principal});for(const h of a.holdings||[])accounts.push({rowType:'holding',accountId:a.id||`account-${key}`,accountName:a.name,holdingId:h.id,assetName:h.name,assetClass:h.class,quantity:h.qty,cost:h.cost,marketValue:h.value,cash:'',principal:''})}
  const tx=(data.ledger||[]).map(r=>({id:r.id,type:r.type,date:r.date,accountId:r.accountId,assetId:r.assetId,assetName:r.assetName,amount:r.amount,quantity:r.quantity,note:r.note,source:r.source}));
  const contributionTypes=new Set(['contribution','contribution-adjustment']),dividendTypes=new Set(['dividend','dividend-adjustment','dividend-account-allocation']),contributions=tx.filter(r=>contributionTypes.has(r.type)),dividends=tx.filter(r=>dividendTypes.has(r.type));
  const snaps=(data.snapshots||[]).map(s=>({id:s.id,createdAt:s.createdAt,effectiveDate:s.effectiveDate,reason:s.reason,accountCount:Object.keys(s.accounts||{}).length,totalAssets:v1Counts({accounts:s.accounts}).totalAssets}));
  const archivedHoldings=(data.archives?.holdings||[]).map(x=>({archiveId:x.archiveId,entityId:x.entityId,accountId:x.accountId,archivedAt:x.archivedAt,reason:x.reason,assetName:x.data?.name||'',quantity:x.data?.qty??'',cost:x.data?.cost??'',marketValue:x.data?.value??''}));
  const settingsRows=[];const walk=(obj,p='')=>{for(const [k,v] of Object.entries(obj||{})){const key=p?`${p}.${k}`:k;if(v&&typeof v==='object'&&!Array.isArray(v))walk(v,key);else settingsRows.push({key,value:Array.isArray(v)?JSON.stringify(v):v})}};walk({profile:data.profile,settings:data.settings},'');
  const envelope={backupFormatVersion:V1_BACKUP_FORMAT,appId:'asset-os-pension',dataId:data.dataId,appVersion:V1_APP_VERSION,schemaVersion:V1_SCHEMA_VERSION,identityContractVersion:'1.0',createdAt:v1DateTime(),data:clone(data)};
  const schema=`개인연금 표준 백업 스키마\n\nappId: asset-os-pension\nbackupFormatVersion: ${V1_BACKUP_FORMAT}\nschemaVersion: ${V1_SCHEMA_VERSION}\nidentityContractVersion: 1.0\n\n핵심 원칙\n- full-backup.json이 완전 복원 원본이다.\n- CSV는 사람이 확인하고 다른 시스템으로 옮기기 위한 보조 파일이다.\n- account-pension은 연금저축, account-irp는 IRP다.\n- contribution은 외부 자금 납입이다. contribution-adjustment는 구버전 연간 합계를 원장으로 이전한 보정 기록이다. buy/sell은 계좌 내부 매매이며 납입과 혼동하지 않는다.\n- dividend는 배당 또는 분배금이다. dividend-adjustment와 dividend-account-allocation은 과거 합계 이전·계좌 배분용 보정 기록이다.\n- snapshot은 특정 시점의 계좌 및 보유상품 상태다.\n- amount, cost, marketValue, principal, cash의 단위는 대한민국 원(KRW)이다.\n- 날짜는 ISO-8601을 우선한다.\n- appId, dataId, 계좌 ID, 보유상품 ID, 원장 ID, 스냅샷 ID는 생성 후 변경하지 않는다.\n- 보유상품이 현재 목록에서 빠져도 archives.holdings와 archived-holdings.csv에 보존한다.\n- 기존 ID를 유지하고, 의미가 바뀌면 기존 필드를 덮어쓰지 말고 새 필드를 추가한다.\n- 누락 값을 AI가 임의로 만들지 않는다. 불확실한 값은 사용자 확인 대상으로 표시한다.\n- 구버전은 schemaVersion을 확인한 뒤 단계별 마이그레이션한다.\n- 변환은 복사본에서 수행하고 총자산·계좌·보유상품·기록 개수를 비교한 뒤에만 적용한다.\n`;
  const recovery=`# 개인연금 백업 복구 안내\n\n이 ZIP은 앱이나 클라우드가 변경되어도 사람이 직접 확인하고 새 앱 또는 AI가 복구할 수 있도록 만든 독립 백업입니다.\n\n## 복구 우선순위\n1. manifest.json의 appId, schemaVersion, 파일 목록을 확인합니다.\n2. 체크섬이 모두 일치하는지 확인합니다.\n3. full-backup.json의 data를 복사본으로 읽습니다.\n4. schemaVersion별 단계형 변환기를 적용합니다.\n5. 계좌 수, 보유상품 수, 기록 수, 총자산을 원본 manifest와 비교합니다.\n6. 불확실한 필드는 추정 저장하지 않고 사용자에게 확인합니다.\n7. 검증 성공 후에만 새 저장소에 반영합니다.\n\n## 클라우드 이전\nFirebase, Supabase, 다른 DB 또는 로컬 파일 중 어디로 옮기더라도 full-backup.json의 의미를 보존합니다. 클라우드 고유 ID로 원본 ID를 덮어쓰지 않습니다.\n\n## AI 복구 금지사항\n- 누락된 금액을 임의 생성하지 않습니다.\n- contribution을 buy로 바꾸지 않습니다.\n- 배당을 납입 또는 매도대금으로 합치지 않습니다.\n- 기존 원본 ZIP을 수정하지 않습니다.\n`;
  return {
    'full-backup.json':JSON.stringify(envelope,null,2),
    'accounts.csv':v1Csv(accounts,['rowType','accountId','accountName','holdingId','assetName','assetClass','quantity','cost','marketValue','cash','principal']),
    'transactions.csv':v1Csv(tx,['id','type','date','accountId','assetId','assetName','amount','quantity','note','source']),
    'contributions.csv':v1Csv(contributions,['id','type','date','accountId','assetId','assetName','amount','quantity','note','source']),
    'dividends.csv':v1Csv(dividends,['id','type','date','accountId','assetId','assetName','amount','quantity','note','source']),
    'snapshots.csv':v1Csv(snaps,['id','createdAt','effectiveDate','reason','accountCount','totalAssets']),
    'archived-holdings.csv':v1Csv(archivedHoldings,['archiveId','entityId','accountId','archivedAt','reason','assetName','quantity','cost','marketValue']),
    'settings.csv':v1Csv(settingsRows,['key','value']),
    'backup-schema.txt':schema,
    'recovery-guide.md':recovery
  };
}
function v1CrcTable(){const t=new Uint32Array(256);for(let n=0;n<256;n++){let c=n;for(let k=0;k<8;k++)c=(c&1)?0xedb88320^(c>>>1):c>>>1;t[n]=c>>>0}return t}const V1_CRC=v1CrcTable();
function v1Crc32(bytes){let c=0xffffffff;for(const b of bytes)c=V1_CRC[(c^b)&255]^(c>>>8);return (c^0xffffffff)>>>0}
function v1U16(a,o,v){a[o]=v&255;a[o+1]=(v>>>8)&255}function v1U32(a,o,v){a[o]=v&255;a[o+1]=(v>>>8)&255;a[o+2]=(v>>>16)&255;a[o+3]=(v>>>24)&255}
function v1Concat(parts){const len=parts.reduce((s,p)=>s+p.length,0),out=new Uint8Array(len);let o=0;for(const p of parts){out.set(p,o);o+=p.length}return out}
function v1ZipCreate(fileMap){const locals=[],centrals=[];let offset=0;for(const [name,content] of Object.entries(fileMap)){const nameB=v1Enc.encode(name),data=content instanceof Uint8Array?content:v1Enc.encode(String(content)),crc=v1Crc32(data),local=new Uint8Array(30+nameB.length);v1U32(local,0,0x04034b50);v1U16(local,4,20);v1U16(local,6,0x0800);v1U16(local,8,0);v1U16(local,10,0);v1U16(local,12,0);v1U32(local,14,crc);v1U32(local,18,data.length);v1U32(local,22,data.length);v1U16(local,26,nameB.length);v1U16(local,28,0);local.set(nameB,30);locals.push(local,data);const central=new Uint8Array(46+nameB.length);v1U32(central,0,0x02014b50);v1U16(central,4,20);v1U16(central,6,20);v1U16(central,8,0x0800);v1U16(central,10,0);v1U16(central,12,0);v1U16(central,14,0);v1U32(central,16,crc);v1U32(central,20,data.length);v1U32(central,24,data.length);v1U16(central,28,nameB.length);v1U16(central,30,0);v1U16(central,32,0);v1U16(central,34,0);v1U16(central,36,0);v1U32(central,38,0);v1U32(central,42,offset);central.set(nameB,46);centrals.push(central);offset+=local.length+data.length}const localPart=v1Concat(locals),centralPart=v1Concat(centrals),end=new Uint8Array(22);v1U32(end,0,0x06054b50);v1U16(end,4,0);v1U16(end,6,0);v1U16(end,8,centrals.length);v1U16(end,10,centrals.length);v1U32(end,12,centralPart.length);v1U32(end,16,localPart.length);v1U16(end,20,0);return v1Concat([localPart,centralPart,end])}
function v1R16(v,o){return v.getUint16(o,true)}function v1R32(v,o){return v.getUint32(o,true)}
async function v1InflateRaw(bytes){
  if(typeof DecompressionStream!=='function')throw new Error('이 브라우저는 일반 압축 ZIP 해제를 지원하지 않습니다.');
  const stream=new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}
async function v1ZipRead(buffer){
  const bytes=buffer instanceof Uint8Array?buffer:new Uint8Array(buffer);
  if(bytes.length<22)throw new Error('ZIP 파일이 너무 짧거나 잘렸습니다.');
  const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),can=(o,n=1)=>Number.isInteger(o)&&o>=0&&o+n<=bytes.length;
  let eocd=-1;const start=Math.max(0,bytes.length-66000);
  for(let i=bytes.length-22;i>=start;i--){if(can(i,4)&&v1R32(view,i)===0x06054b50){eocd=i;break}}
  if(eocd<0||!can(eocd,22))throw new Error('ZIP 끝 정보를 찾지 못했습니다. 파일이 손상되었을 수 있습니다.');
  const count=v1R16(view,eocd+10),centralSize=v1R32(view,eocd+12),centralOffset=v1R32(view,eocd+16);
  if(count<1||count>1000)throw new Error('ZIP 내부 파일 개수가 비정상입니다.');
  if(!can(centralOffset,centralSize)||centralOffset+centralSize>eocd)throw new Error('ZIP 파일 목록 위치가 손상되었습니다.');
  const files={};let p=centralOffset;
  for(let i=0;i<count;i++){
    if(!can(p,46)||v1R32(view,p)!==0x02014b50)throw new Error('ZIP 파일 목록이 손상되었습니다.');
    const method=v1R16(view,p+10),crcExpected=v1R32(view,p+16),compressedSize=v1R32(view,p+20),size=v1R32(view,p+24),nameLen=v1R16(view,p+28),extraLen=v1R16(view,p+30),commentLen=v1R16(view,p+32),localOffset=v1R32(view,p+42),next=p+46+nameLen+extraLen+commentLen;
    if(!can(p+46,nameLen)||next>centralOffset+centralSize)throw new Error('ZIP 파일 이름 또는 목록 길이가 손상되었습니다.');
    const name=v1Dec.decode(bytes.slice(p+46,p+46+nameLen));
    if(!name||Object.prototype.hasOwnProperty.call(files,name))throw new Error('ZIP 내부 파일 이름이 없거나 중복되었습니다.');
    if(!can(localOffset,30)||v1R32(view,localOffset)!==0x04034b50)throw new Error('ZIP 내부 파일 위치가 손상되었습니다.');
    const ln=v1R16(view,localOffset+26),le=v1R16(view,localOffset+28),dataStart=localOffset+30+ln+le;
    if(!can(dataStart,compressedSize))throw new Error(`ZIP 내부 파일이 잘렸습니다: ${name}`);
    const packed=bytes.slice(dataStart,dataStart+compressedSize);let out;
    if(method===0)out=packed;else if(method===8)out=await v1InflateRaw(packed);else throw new Error(`지원하지 않는 ZIP 압축 방식입니다: ${method}`);
    if(out.length!==size)throw new Error(`ZIP 내부 파일 크기가 일치하지 않습니다: ${name}`);
    if(v1Crc32(out)!==crcExpected)throw new Error(`ZIP 내부 CRC가 일치하지 않습니다: ${name}`);
    files[name]=out;p=next;
  }
  return files;
}

function v1ShaFallback(input){const bytes=input instanceof Uint8Array?input:new Uint8Array(input),K=new Uint32Array([0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2]),H=new Uint32Array([0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19]),one=bytes.length+1,pad=(56-one%64+64)%64,total=one+pad+8,msg=new Uint8Array(total);msg.set(bytes);msg[bytes.length]=0x80;let bits=BigInt(bytes.length)*8n;for(let i=0;i<8;i++)msg[total-1-i]=Number((bits>>BigInt(i*8))&255n);const rotr=(x,n)=>(x>>>n)|(x<<(32-n)),w=new Uint32Array(64);for(let off=0;off<total;off+=64){for(let i=0;i<16;i++){const j=off+i*4;w[i]=((msg[j]<<24)|(msg[j+1]<<16)|(msg[j+2]<<8)|msg[j+3])>>>0}for(let i=16;i<64;i++){const x=w[i-15],y=w[i-2],s0=rotr(x,7)^rotr(x,18)^(x>>>3),s1=rotr(y,17)^rotr(y,19)^(y>>>10);w[i]=(w[i-16]+s0+w[i-7]+s1)>>>0}let[a,b,c,d,e,f,g,h]=H;for(let i=0;i<64;i++){const S1=rotr(e,6)^rotr(e,11)^rotr(e,25),ch=(e&f)^((~e)&g),t1=(h+S1+ch+K[i]+w[i])>>>0,S0=rotr(a,2)^rotr(a,13)^rotr(a,22),maj=(a&b)^(a&c)^(b&c),t2=(S0+maj)>>>0;h=g;g=f;f=e;e=(d+t1)>>>0;d=c;c=b;b=a;a=(t1+t2)>>>0}H[0]=(H[0]+a)>>>0;H[1]=(H[1]+b)>>>0;H[2]=(H[2]+c)>>>0;H[3]=(H[3]+d)>>>0;H[4]=(H[4]+e)>>>0;H[5]=(H[5]+f)>>>0;H[6]=(H[6]+g)>>>0;H[7]=(H[7]+h)>>>0}return [...H].map(x=>x.toString(16).padStart(8,'0')).join('')}
async function v1Sha(bytes){if(globalThis.crypto?.subtle?.digest){const hash=await crypto.subtle.digest('SHA-256',bytes);return [...new Uint8Array(hash)].map(b=>b.toString(16).padStart(2,'0')).join('')}return v1ShaFallback(bytes)}
async function v1BuildBackup(data=state){
  const copy=clone(v1EnsureState(clone(data))),validation=v1ValidateData(copy);if(!validation.ok)throw new Error(validation.errors[0]);const files=v1FilesFromState(copy),checksums={};for(const [name,text] of Object.entries(files))checksums[name]=await v1Sha(v1Enc.encode(text));const counts=v1Counts(copy),manifest={appId:'asset-os-pension',dataId:copy.dataId,backupFormatVersion:V1_BACKUP_FORMAT,appVersion:V1_APP_VERSION,schemaVersion:V1_SCHEMA_VERSION,identityContractVersion:'1.0',createdAt:v1DateTime(),counts,requiredFiles:[...V1_REQUIRED],files:Object.fromEntries(Object.entries(files).map(([name,text])=>[name,{bytes:v1Enc.encode(text).length,sha256:checksums[name]}])),validation:{sourceData:'passed',zipReopen:'pending',checksums:'pending',counts:'passed'}};files['manifest.json']=JSON.stringify(manifest,null,2);let zip=v1ZipCreate(files),verified=await v1VerifyBackup(zip);if(!verified.ok)throw new Error(verified.errors[0]);manifest.validation.zipReopen='passed';manifest.validation.checksums='passed';files['manifest.json']=JSON.stringify(manifest,null,2);zip=v1ZipCreate(files);verified=await v1VerifyBackup(zip);if(!verified.ok)throw new Error(verified.errors[0]);return {bytes:zip,blob:new Blob([zip],{type:'application/zip'}),manifest,verification:verified,fileName:`pension-data_${v1FileStamp()}.zip`}}
function v1ValidateData(data){
  const errors=[];const add=m=>{if(!errors.includes(m))errors.push(m)};
  if(!data||typeof data!=='object')return {ok:false,errors:['데이터 객체가 없습니다.']};
  if(data.appId!=='asset-os-pension')add('개인연금 데이터가 아닙니다.');
  const schema=Number(data.schemaVersion)||1;if(schema>V1_SCHEMA_VERSION)add(`더 새로운 데이터 구조입니다: ${schema}`);if(!String(data.dataId||'').startsWith('pension-data-'))add('데이터 원본 고유번호가 없습니다.');if(data.meta?.identityContractVersion!=='1.0')add('ID 고정 계약 버전이 일치하지 않습니다.');if(Number(data.meta?.dataModel?.schemaVersion)!==V1_SCHEMA_VERSION)add('데이터 모델 버전이 일치하지 않습니다.');
  const profile=data.profile||{},settings=data.settings||{};
  const age=Number(profile.age),ret=Number(profile.retirementAge);
  if(!Number.isFinite(age)||age<18||age>80)add('현재 나이 값이 올바르지 않습니다.');
  if(!Number.isFinite(ret)||ret<=age||ret>90)add('연금 개시 나이 값이 올바르지 않습니다.');
  for(const [label,value,min,max] of [
    ['연금저축 월 납입',settings.monthly?.pension,0,100000000],['IRP 월 납입',settings.monthly?.irp,0,100000000],
    ['목표 월연금',settings.goalMonthly,0,100000000],['적립 기대수익률',settings.returnRate,-20,20],
    ['물가상승률',settings.inflation,0,10],['수령 중 수익률',settings.withdrawReturn,-10,15],
    ['수령 기간',settings.withdrawYears,5,50],['총 납입 한도',settings.annualContributionLimit,0,1000000000],
    ['세액공제 한도',settings.taxCreditLimit,0,1000000000],['연금저축 세액공제 한도',settings.pensionTaxCreditLimit??6000000,0,1000000000]
  ]){const n=Number(value);if(!Number.isFinite(n)||n<min||n>max)add(`${label} 값이 올바르지 않습니다.`)}
  if(Number(settings.taxCreditLimit)>Number(settings.annualContributionLimit))add('세액공제 한도가 총 납입 한도보다 큽니다.');
  if(Number(settings.pensionTaxCreditLimit??6000000)>Number(settings.taxCreditLimit))add('연금저축 세액공제 한도가 통합 세액공제 한도보다 큽니다.');
  if(((Number(settings.monthly?.pension)||0)+(Number(settings.monthly?.irp)||0))*12>Number(settings.annualContributionLimit||0))add('연간 납입 계획이 총 납입 한도를 초과합니다.');
  if(Number(data.years?.[CURRENT_YEAR]?.contribution||0)>Number(settings.annualContributionLimit||0))add('현재 연도 총납입이 설정한 납입 한도를 초과합니다.');
  if(Array.isArray(settings.assetClasses)){const sum=settings.assetClasses.reduce((s,c)=>s+(Number(c.target)||0),0);if(Math.abs(sum-100)>.01)add('자산군 목표 비중 합계가 100%가 아닙니다.')}else add('자산군 설정 형식이 올바르지 않습니다.');

  if(!data.accounts?.pension||!data.accounts?.irp)add('연금저축 또는 IRP 계좌가 없습니다.');
  const accountIds=new Set(),holdingIds=new Set();
  for(const [key,a] of Object.entries(data.accounts||{})){
    if(!a||typeof a!=='object'){add(`${key} 계좌 형식이 올바르지 않습니다.`);continue}
    if(!a.id||accountIds.has(a.id))add('계좌 고유번호가 없거나 중복되었습니다.');accountIds.add(a.id);const expectedId=`account-${key}`;if(a.id!==expectedId)add(`${key} 계좌 고유번호가 표준과 다릅니다.`);if(!['active','inactive'].includes(a.status))add(`${key} 계좌 상태가 올바르지 않습니다.`);if(!a.createdAt||Number.isNaN(Date.parse(a.createdAt))||!a.updatedAt||Number.isNaN(Date.parse(a.updatedAt)))add(`${key} 계좌 생성·수정 시각이 올바르지 않습니다.`);
    if([a.principal,a.cash].some(v=>!Number.isFinite(Number(v))||Number(v)<0))add(`${key} 계좌 금액 형식이 올바르지 않습니다.`);
    if(!Array.isArray(a.holdings)){add(`${key} 보유상품 목록 형식이 올바르지 않습니다.`);continue}
    for(const h of a.holdings){
      if(!h.id||holdingIds.has(h.id))add('보유상품 고유번호가 없거나 중복되었습니다.');holdingIds.add(h.id);if(h.accountId!==a.id)add(`${h.name||'보유상품'}의 계좌 참조가 올바르지 않습니다.`);if(!['active','inactive'].includes(h.status))add(`${h.name||'보유상품'} 상태가 올바르지 않습니다.`);if(!h.createdAt||Number.isNaN(Date.parse(h.createdAt))||!h.updatedAt||Number.isNaN(Date.parse(h.updatedAt)))add(`${h.name||'보유상품'} 생성·수정 시각이 올바르지 않습니다.`);
      if(!String(h.name||'').trim())add('이름이 없는 보유상품이 있습니다.');
      if([h.qty,h.value,h.cost].some(v=>!Number.isFinite(Number(v))||Number(v)<0))add(`${h.name||'보유상품'}의 수량 또는 금액이 올바르지 않습니다.`);
    }
  }

  function validateYearMap(map,label){
    if(!map||typeof map!=='object'){add(`${label} 연도 기록 형식이 올바르지 않습니다.`);return}
    const keys=Object.keys(map).map(Number).sort((a,b)=>a-b);let lastCum=-1;
    for(const year of keys){
      const r=map[year];if(!Number.isInteger(year)||year<1900||year>2200||!r||typeof r!=='object'){add(`${label} 연도 값이 올바르지 않습니다.`);continue}
      const fields=['start','end','cumulative','contribution','operating','realized','return','dividend','reinvested'];
      if(fields.some(k=>!Number.isFinite(Number(r[k]||0))))add(`${label} ${year}년 숫자 형식이 올바르지 않습니다.`);
      if(['start','end','cumulative','contribution','dividend','reinvested'].some(k=>Number(r[k]||0)<0))add(`${label} ${year}년 금액에 음수가 있습니다.`);
      if(!Array.isArray(r.monthly)||r.monthly.length!==12||r.monthly.some(v=>!Number.isFinite(Number(v))||Number(v)<0))add(`${label} ${year}년 월별 기록이 올바르지 않습니다.`);
      const end=Number(r.end)||0,calc=(Number(r.start)||0)+(Number(r.contribution)||0)+(Number(r.operating)||0),tol=Math.max(10,Math.abs(end)*1e-6);
      if(Math.abs(end-calc)>tol)add(`${label} ${year}년 자산 증감식이 맞지 않습니다.`);
      const cum=Number(r.cumulative)||0;if(cum+1<lastCum)add(`${label} 누적 순납입이 ${year}년에 감소합니다.`);lastCum=Math.max(lastCum,cum);
    }
  }
  validateYearMap(data.years,'전체');
  for(const key of ['pension','irp'])if(data.accountYears?.[key])validateYearMap(data.accountYears[key],key==='pension'?'연금저축':'IRP');

  const allowed=new Set(['contribution','dividend','buy','sell','snapshot','adjustment','contribution-status','contribution-adjustment','dividend-adjustment','dividend-account-allocation','realized-adjustment']),recordIds=new Set();
  if(!Array.isArray(data.ledger))add('거래 기록 형식이 올바르지 않습니다.');
  for(const r of data.ledger||[]){
    if(!r.id||recordIds.has(r.id))add('기록 고유번호가 없거나 중복되었습니다.');recordIds.add(r.id);if(!['active','void'].includes(r.status))add(`기록 상태가 올바르지 않습니다: ${r.id||'번호 없음'}`);if(!r.createdAt||Number.isNaN(Date.parse(r.createdAt))||!r.updatedAt||Number.isNaN(Date.parse(r.updatedAt)))add(`기록 생성·수정 시각이 올바르지 않습니다: ${r.id||'번호 없음'}`);
    if(!allowed.has(r.type))add(`알 수 없는 기록 종류입니다: ${r.type||'없음'}`);
    if(!r.date||Number.isNaN(Date.parse(r.date)))add(`기록 날짜가 올바르지 않습니다: ${r.id||'번호 없음'}`);
    if(!Number.isFinite(Number(r.amount)))add(`기록 금액이 올바르지 않습니다: ${r.id||'번호 없음'}`);
    if(['contribution','dividend'].includes(r.type)&&Number(r.amount)<=0)add(`납입·배당 금액은 0원보다 커야 합니다: ${r.id||'번호 없음'}`);
    if(r.type==='sell'&&Number(r.amount)===0)add(`매도 손익이 0원입니다: ${r.id||'번호 없음'}`);
    if(r.accountId&&!accountIds.has(r.accountId))add(`존재하지 않는 계좌를 참조합니다: ${r.id||'번호 없음'}`);
    /* Historical records may reference a holding that is no longer in the current snapshot. Keep the ID for audit history instead of rejecting the backup. */
  }
  if(!Array.isArray(data.snapshots))add('스냅샷 형식이 올바르지 않습니다.');
  const snapshotIds=new Set();for(const x of data.snapshots||[]){if(!x.id||snapshotIds.has(x.id))add('스냅샷 고유번호가 없거나 중복되었습니다.');snapshotIds.add(x.id);if(!x.createdAt||Number.isNaN(Date.parse(x.createdAt))||!x.updatedAt||Number.isNaN(Date.parse(x.updatedAt)))add(`스냅샷 날짜가 올바르지 않습니다: ${x.id||'번호 없음'}`);if(!['active','superseded'].includes(x.status))add(`스냅샷 상태가 올바르지 않습니다: ${x.id||'번호 없음'}`);if(!x.accounts||typeof x.accounts!=='object')add(`스냅샷 계좌 데이터가 없습니다: ${x.id||'번호 없음'}`)}
  const archiveIds=new Set();for(const x of data.archives?.holdings||[]){if(!x.archiveId||archiveIds.has(x.archiveId))add('보관 기록 고유번호가 없거나 중복되었습니다.');archiveIds.add(x.archiveId);if(!x.entityId||!x.accountId||!x.archivedAt||Number.isNaN(Date.parse(x.archivedAt))||!x.data)add('보관된 보유상품 기록이 올바르지 않습니다.');}
  try{JSON.stringify(data)}catch(_){add('JSON으로 변환할 수 없는 데이터가 있습니다.')}
  return {ok:!errors.length,errors};
}

async function v1VerifyBackup(input){
  const errors=[];try{
    const files=await v1ZipRead(input);for(const req of V1_REQUIRED)if(!files[req]||!files[req].length)errors.push(`필수 파일 누락: ${req}`);if(errors.length)return {ok:false,errors};
    const manifest=JSON.parse(v1Dec.decode(files['manifest.json']));if(manifest.appId!=='asset-os-pension')errors.push('다른 앱의 백업입니다.');if(Number(manifest.schemaVersion)>V1_SCHEMA_VERSION)errors.push(`더 새로운 데이터 구조입니다: ${manifest.schemaVersion}`);
    const envelope=JSON.parse(v1Dec.decode(files['full-backup.json'])),data=envelope.data||envelope;if(data.appId!=='asset-os-pension')errors.push('백업 원본의 앱 종류가 일치하지 않습니다.');if(String(envelope.appId||data.appId)!==String(manifest.appId))errors.push('manifest와 원본의 앱 종류가 다릅니다.');if(Number(envelope.schemaVersion||data.schemaVersion)!==Number(manifest.schemaVersion))errors.push('manifest와 원본의 데이터 구조 버전이 다릅니다.');if(String(envelope.backupFormatVersion||'')!==String(manifest.backupFormatVersion||''))errors.push('manifest와 원본의 백업 형식 버전이 다릅니다.');if(String(envelope.dataId||data.dataId)!==String(manifest.dataId||''))errors.push('manifest와 원본의 데이터 ID가 다릅니다.');if(String(envelope.identityContractVersion||data.meta?.identityContractVersion)!==String(manifest.identityContractVersion||''))errors.push('manifest와 원본의 ID 계약 버전이 다릅니다.');
    for(const [name,info] of Object.entries(manifest.files||{})){if(!files[name]){errors.push(`체크섬 대상 누락: ${name}`);continue}const actual=await v1Sha(files[name]);if(actual!==info.sha256)errors.push(`체크섬 불일치: ${name}`);if(Number(info.bytes)!==files[name].length)errors.push(`파일 크기 불일치: ${name}`)}
    const counts=v1Counts(data);for(const key of ['accounts','holdings','transactions','contributions','dividends','snapshots','years','archivedHoldings','totalAssets'])if(Number(counts[key])!==Number(manifest.counts?.[key]))errors.push(`데이터 개수 또는 합계 불일치: ${key}`);
    let migrated=null;try{migrated=v1MigrateImported(data)}catch(e){errors.push(String(e?.message||e))}if(migrated){const valid=v1ValidateData(migrated);if(!valid.ok)errors.push(...valid.errors)}
    return {ok:!errors.length,errors,files,manifest,data};
  }catch(e){return {ok:false,errors:[String(e?.message||e)]}}
}

async function v1LoadProjectAssets(providedAssets=null){
  const assets={};
  for(const name of V1_PROJECT_ASSETS){
    let content=providedAssets?.[name];
    if(content===undefined){
      const response=await fetch(`./${name}`,{cache:'no-store'});
      if(!response.ok)throw new Error(`앱 파일을 읽지 못했습니다: ${name} (${response.status})`);
      content=new Uint8Array(await response.arrayBuffer());
    }
    const bytes=content instanceof Uint8Array?content:v1Enc.encode(String(content));
    if(!bytes.length)throw new Error(`앱 파일이 비어 있습니다: ${name}`);
    assets[name]=bytes;
  }
  return assets;
}
async function v1VerifyProjectBackup(input){
  const errors=[];
  try{
    const files=await v1ZipRead(input),manifestBytes=files['project-manifest.json'];
    if(!manifestBytes)throw new Error('프로젝트 백업 정보가 없습니다.');
    const manifest=JSON.parse(v1Dec.decode(manifestBytes));
    if(manifest.appId!=='asset-os-pension')errors.push('다른 앱의 프로젝트 백업입니다.');
    if(String(manifest.projectBackupFormatVersion||'')!==V1_PROJECT_BACKUP_FORMAT)errors.push('지원하지 않는 프로젝트 백업 형식입니다.');
    if(Number(manifest.schemaVersion)>V1_SCHEMA_VERSION)errors.push(`더 새로운 데이터 구조입니다: ${manifest.schemaVersion}`);
    const listed=Array.isArray(manifest.appAssets)?manifest.appAssets:[];
    for(const name of V1_PROJECT_ASSETS){
      const path=`app/${name}`,info=listed.find(x=>x.name===name);
      if(!files[path]){errors.push(`앱 파일 누락: ${name}`);continue}
      if(!info){errors.push(`앱 파일 정보 누락: ${name}`);continue}
      if(Number(info.bytes)!==files[path].length)errors.push(`앱 파일 크기 불일치: ${name}`);
      if(await v1Sha(files[path])!==info.sha256)errors.push(`앱 파일 체크섬 불일치: ${name}`);
    }
    if(listed.length!==V1_PROJECT_ASSETS.length)errors.push('프로젝트 앱 파일 개수가 표준과 다릅니다.');
    const dataPath=String(manifest.dataBackup?.path||'');
    if(!dataPath||!files[dataPath])errors.push('프로젝트 안의 데이터 백업이 없습니다.');
    let dataVerification=null;
    if(dataPath&&files[dataPath]){
      if(Number(manifest.dataBackup.bytes)!==files[dataPath].length)errors.push('데이터 백업 크기가 일치하지 않습니다.');
      if(await v1Sha(files[dataPath])!==manifest.dataBackup.sha256)errors.push('데이터 백업 체크섬이 일치하지 않습니다.');
      dataVerification=await v1VerifyBackup(files[dataPath]);
      if(!dataVerification.ok)errors.push(`내부 데이터 백업 오류: ${dataVerification.errors[0]}`);
      else{
        if(String(dataVerification.manifest.dataId)!==String(manifest.dataId))errors.push('프로젝트와 데이터 백업의 데이터 ID가 다릅니다.');
        if(Number(dataVerification.manifest.schemaVersion)!==Number(manifest.schemaVersion))errors.push('프로젝트와 데이터 백업의 구조 버전이 다릅니다.');
      }
    }
    if(!files['RECOVERY.md'])errors.push('프로젝트 복구 안내서가 없습니다.');
    return {ok:!errors.length,errors,files,manifest,dataVerification,data:dataVerification?.data};
  }catch(e){return {ok:false,errors:[String(e?.message||e)]}}
}
async function v1BuildProjectBackup(data=state,providedAssets=null){
  const dataPack=await v1BuildBackup(data),assets=await v1LoadProjectAssets(providedAssets),files={},assetInfo=[];
  for(const name of V1_PROJECT_ASSETS){
    const bytes=assets[name],path=`app/${name}`;
    files[path]=bytes;assetInfo.push({name,path,bytes:bytes.length,sha256:await v1Sha(bytes)});
  }
  const dataPath=`data/${dataPack.fileName}`;
  files[dataPath]=dataPack.bytes;
  const recovery=`# 개인연금 프로젝트 전체 백업

이 ZIP은 호스팅·클라우드 정책 변경이나 서비스 종료에 대비한 독립 보관본입니다.

## 구성
- app/: GitHub Pages 또는 다른 정적 호스팅에 올릴 앱 파일 ${V1_PROJECT_ASSETS.length}개
- data/: 현재 사용자 데이터의 검증 ZIP
- project-manifest.json: 앱 파일과 데이터 ZIP의 SHA-256 목록

## 복구 순서
1. project-manifest.json의 체크섬을 검증합니다.
2. app/ 안의 ${V1_PROJECT_ASSETS.length}개 파일을 새 정적 호스팅의 루트에 업로드합니다.
3. 새 앱을 연 뒤 데이터 보관 → 백업 파일 불러오기에서 data/ 안의 ZIP을 선택합니다.
4. 계좌 수·기록 수·총자산을 확인한 뒤 복원합니다.

GitHub Pages가 없어져도 정적 파일 호스팅을 지원하는 다른 서비스에 app/ 내용을 그대로 올릴 수 있습니다.
`;
  files['RECOVERY.md']=recovery;
  const manifest={appId:'asset-os-pension',projectBackupFormatVersion:V1_PROJECT_BACKUP_FORMAT,appVersion:V1_APP_VERSION,schemaVersion:V1_SCHEMA_VERSION,dataId:dataPack.manifest.dataId,identityContractVersion:'1.0',createdAt:v1DateTime(),purpose:'hosting-and-cloud-disaster-recovery',appAssetCount:V1_PROJECT_ASSETS.length,appAssets:assetInfo,dataBackup:{path:dataPath,fileName:dataPack.fileName,bytes:dataPack.bytes.length,sha256:await v1Sha(dataPack.bytes),counts:dataPack.manifest.counts},validation:{sourceData:'passed',appAssets:'passed',nestedDataBackup:'passed',zipReopen:'pending',checksums:'pending'}};
  files['project-manifest.json']=JSON.stringify(manifest,null,2);
  let zip=v1ZipCreate(files),verified=await v1VerifyProjectBackup(zip);
  if(!verified.ok)throw new Error(verified.errors[0]);
  manifest.validation.zipReopen='passed';manifest.validation.checksums='passed';files['project-manifest.json']=JSON.stringify(manifest,null,2);
  zip=v1ZipCreate(files);verified=await v1VerifyProjectBackup(zip);
  if(!verified.ok)throw new Error(verified.errors[0]);
  return {bytes:zip,blob:new Blob([zip],{type:'application/zip'}),manifest,verification:verified,dataPack,fileName:`pension-project_${v1FileStamp()}.zip`};
}

function v1Download(blob,name){const a=document.createElement('a'),url=URL.createObjectURL(blob);a.href=url;a.download=name;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),15000)}
async function v1SaveBlobToPhone(blob,name){
  if(window.isSecureContext&&typeof window.showSaveFilePicker==='function'){
    try{const handle=await window.showSaveFilePicker({suggestedName:name,startIn:'documents',types:[{description:'개인연금 ZIP 백업',accept:{'application/zip':['.zip']}}]});const writable=await handle.createWritable();await writable.write(blob);await writable.close();return {method:'picker',name:handle.name||name}}catch(e){if(e?.name==='AbortError')throw new Error('파일 저장을 취소했습니다.');}
  }
  v1Download(blob,name);return {method:'download',name};
}
function v1FormatSize(n){if(n<1024)return `${n}B`;if(n<1048576)return `${(n/1024).toFixed(1)}KB`;return `${(n/1048576).toFixed(1)}MB`}

function v1CreateDataSheet(){if(document.getElementById('dataSheet'))return;const o=document.createElement('div');o.className='overlay';o.id='dataSheet';o.innerHTML=`<div class="sheet"><div class="sheetHead"><div class="sheetTitle">데이터 보관</div><button class="closeBtn" data-close="dataSheet">×</button></div><div id="dataCenterBody"></div></div>`;document.body.appendChild(o);o.querySelector('[data-close]').onclick=()=>closeSheet('dataSheet')}
function v1Status(kind){const s=state.meta.storage||{};if(kind==='local'){const ok=s.localStatus==='정상';return {icon:'▣',name:'이 휴대폰',detail:s.lastLocalSave?`마지막 저장 ${s.lastLocalSave}`:'저장 대기',label:s.localStatus||'대기',cls:ok?'':'wait'}}if(kind==='cloud'){const ok=s.cloudStatus==='정상',off=s.cloudStatus==='연결 전';return {icon:'☁',name:'클라우드 원본',detail:s.lastCloudSave?`마지막 동기화 ${s.lastCloudSave}`:'Firebase 연결 설정 후 자동 동기화',label:s.cloudStatus||'연결 전',cls:ok?'':off?'off':s.cloudStatus==='실패'?'bad':'wait'}}const ok=!!s.lastDriveBackup;return {icon:'D',name:'Google Drive 프로젝트 ZIP',detail:s.lastDriveBackup?`마지막 프로젝트 백업 ${s.lastDriveBackup}`:`앱 ${V1_PROJECT_ASSETS.length}개와 현재 데이터를 함께 보관`,label:ok?'백업 있음':'대기',cls:ok?'':'off'}}
function v1RefreshDataCenter(){const body=document.getElementById('dataCenterBody');if(!body)return;const oldResult=document.getElementById('v1BackupResult'),keptResult=oldResult?.classList.contains('open')?{className:oldResult.className,html:oldResult.innerHTML}:null;const statuses=['local','cloud','drive'].map(v1Status);body.innerHTML=`<div class="sheetNotice"><b>V2.3 데이터 원칙</b><br>기기 저장·클라우드 동기화·독립 ZIP을 분리합니다. 폰에는 데이터 ZIP, Google Drive에는 앱 ${V1_PROJECT_ASSETS.length}개와 현재 데이터를 함께 보관합니다.</div><div class="dataStatusList">${statuses.map(x=>`<div class="dataStatusRow"><div class="dataStatusIcon">${x.icon}</div><div class="dataStatusText"><b>${x.name}</b><small>${x.detail}</small></div><span class="dataState ${x.cls}">${x.label}</span></div>`).join('')}</div><div class="dataActions"><button class="dataAction" id="v1CloudSync"><span><strong>클라우드 지금 동기화</strong><small>연결된 원본과 기기 데이터를 확인합니다</small></span><span class="arrow">›</span></button><button class="dataAction primaryAction" id="v1PhoneBackup"><span><strong>폰에 데이터 ZIP 백업</strong><small>데이터·CSV·체크섬만 가볍게 보관</small></span><span class="arrow">↓</span></button><button class="dataAction" id="v1DriveBackup"><span><strong>Google Drive에 프로젝트 전체 백업</strong><small>앱 ${V1_PROJECT_ASSETS.length}개 + 현재 데이터 · 호스팅 종료 대비</small></span><span class="arrow">›</span></button><button class="dataAction" id="v1RestoreFile"><span><strong>백업 파일 불러오기</strong><small>ZIP 또는 JSON 검사 후 미리보기</small></span><span class="arrow">›</span></button><button class="dataAction" id="v1RestoreText"><span><strong>JSON 텍스트 붙여넣기</strong><small>파일이 없어도 표준 원본을 복원</small></span><span class="arrow">›</span></button></div><input id="v1RestoreInput" type="file" accept=".zip,.json,application/zip,application/json" hidden><textarea class="dataTextarea" id="v1JsonText" placeholder="full-backup.json 내용 또는 data JSON을 붙여넣으세요"></textarea><button class="btn full" id="v1ParseText" style="display:none;margin-top:8px">붙여넣은 데이터 검사</button><div class="backupResult" id="v1BackupResult"></div><div class="restorePreview" id="v1RestorePreview"></div><div class="dataFoot">앱 버전 ${V1_APP_VERSION} · 데이터 구조 ${V1_SCHEMA_VERSION} · 구버전은 복사본에서 단계적으로 변환합니다.</div>`;document.getElementById('v1PhoneBackup').onclick=v1PhoneBackup;document.getElementById('v1DriveBackup').onclick=v1DriveBackup;document.getElementById('v1CloudSync').onclick=v1CloudSync;document.getElementById('v1RestoreFile').onclick=()=>document.getElementById('v1RestoreInput').click();document.getElementById('v1RestoreInput').onchange=e=>v1ReadRestoreFile(e.target.files?.[0]);document.getElementById('v1RestoreText').onclick=()=>{const t=document.getElementById('v1JsonText'),b=document.getElementById('v1ParseText');t.classList.toggle('open');b.style.display=t.classList.contains('open')?'block':'none'};document.getElementById('v1ParseText').onclick=()=>v1ReadRestoreText(document.getElementById('v1JsonText').value);if(keptResult){const r=document.getElementById('v1BackupResult');r.className=keptResult.className;r.innerHTML=keptResult.html}if(v1RestoreCandidate)setTimeout(v1RenderRestorePreview,0)}
function v1ShowResult(title,message,bad=false){const el=document.getElementById('v1BackupResult');if(!el)return;el.className=`backupResult open${bad?' bad':''}`;el.innerHTML=`<b>${esc(title)}</b><p>${message}</p>`;el.scrollIntoView({behavior:'smooth',block:'nearest'})}
async function v1PhoneBackup(){try{v1ShowResult('데이터 백업 생성 중','원본·CSV·ZIP·체크섬을 차례로 검사하고 있습니다.');await v1PersistNow();const pack=await v1BuildBackup(),saved=await v1SaveBlobToPhone(pack.blob,pack.fileName);state.meta.storage.lastBackup=v1LocalTime();state.meta.storage.lastValidation='데이터 백업 정상';save();v1ShowResult(saved.method==='picker'?'폰 데이터 ZIP 저장 완료':'폰 데이터 ZIP 다운로드 요청 완료',`파일명 ${esc(saved.name)}<br>${saved.method==='picker'?'선택한 폴더에 저장했습니다.':'브라우저 기본 다운로드 폴더에 저장됩니다.'}<br>크기 ${v1FormatSize(pack.bytes.length)} · 계좌 ${pack.manifest.counts.accounts}개 · 보유상품 ${pack.manifest.counts.holdings}개 · 기록 ${pack.manifest.counts.transactions}건<br>체크섬·건수·총자산 ${fmt(pack.manifest.counts.totalAssets)} 일치`)}catch(e){v1ShowResult('데이터 백업 생성 중단',esc(e?.message||e),true)}}
async function v1DriveBackup(){try{v1ShowResult('프로젝트 백업 준비 중',`현재 앱 ${V1_PROJECT_ASSETS.length}개 파일과 검증된 데이터 ZIP을 묶고 있습니다.`);await v1PersistNow();const pack=await v1BuildProjectBackup(),drive=v1Adapters().drive;if(drive?.upload){const result=await drive.upload(new File([pack.blob],pack.fileName,{type:'application/zip'}),{folder:'투자시스템/pension/project-backups',backupType:'project',manifest:pack.manifest});if(drive.download&&result?.fileId){const remote=await drive.download(result.fileId),hashA=await v1Sha(pack.bytes),hashB=await v1Sha(new Uint8Array(await remote.arrayBuffer()));if(hashA!==hashB)throw new Error('Drive 재다운로드 체크섬이 일치하지 않습니다.')}state.meta.storage.driveStatus='정상';state.meta.storage.lastDriveBackup=v1LocalTime();save();v1ShowResult('Drive 프로젝트 백업 검증 완료',`${esc(pack.fileName)}<br>앱 ${pack.manifest.appAssetCount}개 · 데이터 ZIP ${v1FormatSize(pack.dataPack.bytes.length)} · 업로드 체크섬 일치`);return}const file=new File([pack.blob],pack.fileName,{type:'application/zip'});if(navigator.share&&(!navigator.canShare||navigator.canShare({files:[file]}))){await navigator.share({title:'개인연금 프로젝트 전체 백업',text:'Google Drive를 선택해 투자시스템/개인연금/프로젝트백업 폴더에 저장하세요.',files:[file]});state.meta.storage.driveStatus='공유 완료';state.meta.storage.lastDriveBackup=v1LocalTime();save();v1ShowResult('Google Drive 선택창 전달 완료',`검증된 ${esc(pack.fileName)}을 전달했습니다.<br>앱 ${V1_PROJECT_ASSETS.length}개와 현재 데이터가 함께 들어 있습니다.`)}else{v1Download(pack.blob,pack.fileName);v1ShowResult('프로젝트 ZIP 다운로드 완료',`직접 Drive 연결이나 안드로이드 공유가 없어 폰으로 내려받았습니다.<br>Google Drive의 투자시스템/개인연금/프로젝트백업 폴더에 올려주세요.`)}}catch(e){v1ShowResult('프로젝트 백업 중단',esc(e?.message||e),true)}}
async function v1CloudSync(){const cloud=v1Adapters().cloud;if(!cloud?.load||!cloud?.save){v1ShowResult('클라우드 연결 전','Firebase 배포 설정이 연결되면 이 버튼에서 기기·클라우드 원본을 비교하고 동기화합니다.',true);return}try{v1ShowResult('클라우드 확인 중','원격 원본과 기기 수정 시각을 비교하고 있습니다.');const remote=await cloud.load();if(!remote){await cloud.save(clone(state));state.meta.storage.cloudStatus='정상';state.meta.storage.lastCloudSave=v1LocalTime();save();return v1ShowResult('클라우드 원본 생성','현재 기기 데이터를 클라우드 원본으로 저장했습니다.')}const r=v1EnsureState(clone(remote)),localTime=Date.parse(state.meta?.updatedAt||0)||0,remoteTime=Date.parse(r.meta?.updatedAt||0)||0;if(remoteTime>localTime){v1RestoreCandidate={data:r,manifest:{schemaVersion:r.schemaVersion,counts:v1Counts(r),createdAt:r.meta?.updatedAt,appVersion:r.meta?.appVersion},source:'cloud'};v1RenderRestorePreview()}else{await cloud.save(clone(state));state.meta.storage.cloudStatus='정상';state.meta.storage.lastCloudSave=v1LocalTime();save();v1ShowResult('클라우드 동기화 완료','기기 데이터가 클라우드 원본에 반영됐습니다.')}}catch(e){state.meta.storage.cloudStatus='실패';v1ShowResult('클라우드 동기화 실패',esc(e?.message||e),true)}}
async function v1ReadRestoreFile(file){if(!file)return;try{v1ShowResult('백업 검사 중',`${esc(file.name)}의 구조와 체크섬을 확인합니다.`);const bytes=new Uint8Array(await file.arrayBuffer());if(file.name.toLowerCase().endsWith('.zip')||bytes[0]===0x50&&bytes[1]===0x4b){const listed=await v1ZipRead(bytes);if(listed['project-manifest.json']){const project=await v1VerifyProjectBackup(bytes);if(!project.ok)throw new Error(project.errors[0]);v1RestoreCandidate={data:project.dataVerification.data,manifest:project.dataVerification.manifest,source:'project-zip',fileName:file.name}}else{const verified=await v1VerifyBackup(bytes);if(!verified.ok)throw new Error(verified.errors[0]);v1RestoreCandidate={data:verified.data,manifest:verified.manifest,source:'zip',fileName:file.name}}}else{const parsed=JSON.parse(v1Dec.decode(bytes)),data=parsed.data||parsed;v1RestoreCandidate={data,manifest:{schemaVersion:parsed.schemaVersion||data.schemaVersion,appVersion:parsed.appVersion||data.meta?.appVersion,createdAt:parsed.createdAt||data.meta?.updatedAt,counts:v1Counts(data)},source:'json',fileName:file.name}}v1RenderRestorePreview()}catch(e){v1RestoreCandidate=null;v1ShowResult('복원 파일 거부',esc(e?.message||e),true)}}
function v1ReadRestoreText(text){try{const parsed=JSON.parse(text),data=parsed.data||parsed;v1RestoreCandidate={data,manifest:{schemaVersion:parsed.schemaVersion||data.schemaVersion,appVersion:parsed.appVersion||data.meta?.appVersion,createdAt:parsed.createdAt||data.meta?.updatedAt,counts:v1Counts(data)},source:'text',fileName:'붙여넣은 JSON'};v1RenderRestorePreview()}catch(e){v1ShowResult('JSON 검사 실패',esc(e?.message||e),true)}}
function v1MigrateImported(input){
  const copy=clone(input);let version=Number(copy.schemaVersion)||1;const applied=[];
  if(copy.appId&&copy.appId!=='asset-os-pension')throw new Error('다른 앱의 데이터입니다.');
  if(!copy.appId&&version>=4)throw new Error('앱 식별자가 없는 데이터입니다.');
  if(version>V1_SCHEMA_VERSION)throw new Error(`이 백업은 더 새로운 데이터 구조(${version})입니다.`);
  copy.appId='asset-os-pension';
  while(version<V1_SCHEMA_VERSION){
    const from=version;
    if(version===1){copy.runtime=copy.runtime||{contributions:{}};copy.dividendsByAsset=copy.dividendsByAsset||{};version=2;}
    else if(version===2){copy.accountYears=copy.accountYears||{pension:{},irp:{}};copy.meta=copy.meta||{};version=3;}
    else if(version===3){copy.ledger=Array.isArray(copy.ledger)?copy.ledger:[];copy.snapshots=Array.isArray(copy.snapshots)?copy.snapshots:[];version=4;}
    else if(version===4){copy.settings=copy.settings||{};copy.settings.annualContributionLimit=Number(copy.settings.annualContributionLimit)||18000000;copy.settings.taxCreditLimit=Number(copy.settings.taxCreditLimit)||9000000;version=5;}
    else if(version===5){copy.schemaVersion=5;if(typeof coreEnsureSchema6!=='function')throw new Error('V5 → V6 변환기가 준비되지 않았습니다.');coreEnsureSchema6(copy);version=6;}
    else throw new Error(`변환 경로가 없는 데이터 구조입니다: ${version}`);
    copy.schemaVersion=version;applied.push({from,to:version,appliedAt:v1DateTime(),reason:from===5?'stable-identity-and-archive-contract':'legacy-step-migration'});
  }
  const migrated=v1EnsureState(copy);migrated.meta=migrated.meta||{};migrated.meta.migrationHistory=Array.isArray(migrated.meta.migrationHistory)?migrated.meta.migrationHistory:[];
  const appliedKeys=new Set(applied.map(x=>`${x.from}->${x.to}`)),preserved=migrated.meta.migrationHistory.filter(x=>!appliedKeys.has(`${x.from}->${x.to}`));migrated.meta.migrationHistory=[...preserved,...applied];
  return migrated;
}

function v1RenderRestorePreview(){if(!v1RestoreCandidate)return;try{const migrated=v1MigrateImported(v1RestoreCandidate.data),valid=v1ValidateData(migrated);if(!valid.ok)throw new Error(valid.errors[0]);v1RestoreCandidate.migrated=migrated;const c=v1Counts(migrated),m=v1RestoreCandidate.manifest||{},el=document.getElementById('v1RestorePreview');el.className='restorePreview open';el.innerHTML=`<h4>복원 미리보기</h4><div class="previewGrid"><div class="previewCell"><small>백업 앱 버전</small><b>${esc(m.appVersion||migrated.meta?.appVersion||'확인 불가')}</b></div><div class="previewCell"><small>데이터 구조 변환</small><b>${Number(v1RestoreCandidate.data.schemaVersion)||1} → ${V1_SCHEMA_VERSION}</b></div><div class="previewCell"><small>계좌·보유상품</small><b>${c.accounts}개 · ${c.holdings}개</b></div><div class="previewCell"><small>기록·스냅샷</small><b>${c.transactions}건 · ${c.snapshots}건</b></div><div class="previewCell"><small>총자산</small><b>${fmt(c.totalAssets)}</b></div><div class="previewCell"><small>검사 결과</small><b class="good">오류 없음</b></div></div><div class="restoreButtons"><button class="btn" id="v1CancelRestore">취소</button><button class="btn primary" id="v1ApplyRestore">안전백업 후 복원</button></div>`;document.getElementById('v1CancelRestore').onclick=()=>{v1RestoreCandidate=null;el.className='restorePreview';el.innerHTML=''};document.getElementById('v1ApplyRestore').onclick=v1ApplyRestore;v1ShowResult('복원 가능','원본은 아직 변경하지 않았습니다. 미리보기 확인 후 적용하세요.')}catch(e){v1RestoreCandidate=null;v1ShowResult('복원 데이터 거부',esc(e?.message||e),true)}}
const V1_SAFETY_LOCAL='pension-v1-pre-restore-safety';
async function v1StoreSafetyBackup(original,safety){
  const record={createdAt:v1DateTime(),fileName:safety.fileName,blob:safety.blob,manifest:safety.manifest,data:clone(original)};
  try{await v1DBPut(V1_SAFETY,record);return '기기 데이터베이스'}catch(dbError){
    try{localStorage.setItem(V1_SAFETY_LOCAL,JSON.stringify({...record,blob:undefined}));return '브라우저 보조 저장소'}catch(storageError){throw new Error('복원 전 안전백업을 저장할 수 없습니다. 브라우저 저장공간을 확인하세요.')}
  }
}
async function v1ApplyRestore(){if(!v1RestoreCandidate?.migrated)return;const original=clone(state);try{v1ShowResult('복원 전 안전백업 생성 중','현재 데이터를 별도 보관한 뒤 복사본에서 변환합니다.');const safety=await v1BuildBackup(original),safetyWhere=await v1StoreSafetyBackup(original,safety);const incoming=clone(v1RestoreCandidate.migrated),valid=v1ValidateData(incoming);if(!valid.ok)throw new Error(valid.errors[0]);state=incoming;state.meta.storage.lastRestore=v1LocalTime();state.meta.storage.lastValidation='복원 정상';lastSignature=dataSignature(state);v1LastCore=v1CoreSignature(state);save();await v1PersistNow();renderAll(true);v1RestoreCandidate=null;v1ShowResult('복원 완료',`교체 전 데이터는 ${esc(safetyWhere)}에 안전백업했습니다.<br>계좌 ${v1Counts(state).accounts}개 · 총자산 ${fmt(v1Counts(state).totalAssets)}`)}catch(e){state=original;lastSignature=dataSignature(state);v1LastCore=v1CoreSignature(state);renderAll(true);v1ShowResult('복원 실패 · 기존 데이터 유지',esc(e?.message||e),true)}}

v1CreateDataSheet();
const v1RenderSettings=renderSettings;
renderSettings=function(){v1EnsureState();v1RenderSettings();const body=document.getElementById('settingsBody'),saveBar=body.querySelector('.saveBar');if(!body||!saveBar)return;const limits=document.createElement('div');limits.className='settingsSection';limits.innerHTML=`<div class="settingsTitle">연간 납입 한도</div><div class="field"><label>연금계좌 총 납입 한도</label><input id="setAnnualLimit" type="text" inputmode="numeric" value="${Number(state.settings.annualContributionLimit).toLocaleString('ko-KR')}"><div class="fieldHint">홈의 올해 총납입 카드에 사용합니다.</div></div><div class="field"><label>세액공제 한도</label><input id="setTaxLimit" type="text" inputmode="numeric" value="${Number(state.settings.taxCreditLimit).toLocaleString('ko-KR')}"><div class="fieldHint">제도 변경에 맞춰 직접 수정할 수 있습니다.</div></div>`;body.insertBefore(limits,saveBar);const data=document.createElement('div');data.className='settingsSection';data.innerHTML=`<div class="settingsTitle">데이터 안정성과 저장</div><button class="dataLaunch" id="openDataCenter"><span><b>3중 저장·ZIP 백업</b><small>기기 · 클라우드 · Google Drive 상태와 복원을 관리합니다.</small></span><span>›</span></button>`;body.insertBefore(data,saveBar);for(const id of ['setAnnualLimit','setTaxLimit']){const input=document.getElementById(id);input.addEventListener('blur',()=>{const n=parseMoney(input.value);input.value=n?Number(n).toLocaleString('ko-KR'):''})}document.getElementById('openDataCenter').onclick=()=>{closeSheet('settingsSheet');setTimeout(()=>{v1RefreshDataCenter();openSheet('dataSheet')},180)};const oldClick=document.getElementById('saveSettings').onclick;document.getElementById('saveSettings').onclick=()=>{settingsDraft.settings.annualContributionLimit=parseMoney(document.getElementById('setAnnualLimit').value);settingsDraft.settings.taxCreditLimit=parseMoney(document.getElementById('setTaxLimit').value);if(settingsDraft.settings.taxCreditLimit>settingsDraft.settings.annualContributionLimit){document.getElementById('settingsError').textContent='세액공제 한도는 총 납입 한도보다 클 수 없어요.';return}oldClick()};const notice=body.querySelector('.sheetNotice');if(notice)notice.textContent=`저장 버튼을 눌러야 반영됩니다. 앱 ${V1_APP_VERSION} · 데이터 구조 ${V1_SCHEMA_VERSION}`};

window.PensionV1Data={
  version:V1_APP_VERSION,
  schemaVersion:V1_SCHEMA_VERSION,
  buildBackup:v1BuildBackup,
  verifyBackup:v1VerifyBackup,
  buildProjectBackup:v1BuildProjectBackup,
  verifyProjectBackup:v1VerifyProjectBackup,
  projectAssets:[...V1_PROJECT_ASSETS],
  migrateImported:v1MigrateImported,
  validate:v1ValidateData,
  counts:v1Counts,
  ensureState:v1EnsureState
};

v1EnsureState();v1LastCore=v1CoreSignature(state);if(!state.meta?.compatibilityReadOnly){state.meta.appVersion=V1_APP_VERSION;state.schemaVersion=V1_SCHEMA_VERSION;}renderAll(true);v1FabShow();setTimeout(v1Hydrate,0);
})();

