/* 개인연금 V3.1 입력·분류·시뮬레이션 완성 */
(()=>{
'use strict';
const V29_VERSION='3.1.0';
const V29_CLASSES=[
  {id:'growth',name:'성장',target:55,riskWeight:100,color:'#2f80ed',hint:'S&P500·나스닥·반도체·AI·일반 주식형'},
  {id:'dividend',name:'배당',target:15,riskWeight:100,color:'#22a06b',hint:'배당주·커버드콜·리츠·월배당 ETF'},
  {id:'bond',name:'채권',target:15,riskWeight:0,color:'#7b8ba3',hint:'국채·미국채·회사채·종합채권 ETF'},
  {id:'cash',name:'현금성',target:10,riskWeight:0,color:'#23a6a6',hint:'MMF·머니마켓·CMA·KOFR·CD금리·대기자금'},
  {id:'alternative',name:'대체재',target:5,riskWeight:50,color:'#d69e2e',hint:'금·원자재·원유·은 등 대체투자'}
];
const V29_CLASS_MAP={growth:'growth',dividend:'dividend',income:'dividend',bond:'bond',stable:'bond',cash:'cash',gold:'alternative',alternative:'alternative',other:'growth'};
const V29_KNOWN=[
  'TIGER 미국S&P500','ACE 미국S&P500','KODEX 미국S&P500TR','RISE 미국나스닥100','TIGER 미국나스닥100','ACE 글로벌반도체TOP4 Plus',
  'KODEX 미국배당다우존스','TIGER 미국배당다우존스','ACE 미국배당다우존스','KODEX 미국배당커버드콜액티브',
  'KODEX 머니마켓액티브','TIGER CD금리투자KIS(합성)','KOFR금리액티브(합성)','ACE 미국채10년','TIGER 미국채10년선물',
  'ACE KRX금현물','TIGER 골드선물(H)'
];
const v29N=v=>Number(v)||0;
const v29CurrentAge=()=>{const y=Number(state.profile?.birthYear),nowY=new Date().getFullYear();return Number.isInteger(y)?nowY-y+1:v29N(state.profile?.age)||32};
const v29Norm=v=>String(v||'').toLowerCase().replace(/\s+/g,'').replace(/[()\[\]{}·ㆍ,._-]/g,'');
const v29MapClass=id=>V29_CLASS_MAP[id]||'growth';
const v29Class=id=>V29_CLASSES.find(c=>c.id===id)||V29_CLASSES[0];
const v29ClassOptions=(selected='')=>V29_CLASSES.map(c=>`<option value="${c.id}" ${c.id===selected?'selected':''}>${esc(c.name)}</option>`).join('');
function v29GuessClass(name){
  const key=v29Norm(name),saved=state.settings?.assetAliases?.[key];if(saved&&V29_CLASSES.some(c=>c.id===saved))return saved;
  const n=String(name||'').toLowerCase();
  if(/머니마켓|money\s*market|\bmmf\b|\bcma\b|\bko?fr\b|cd금리|단기금리|초단기|대기자금|현금|cash|예금|발행어음|\brp\b/.test(n))return 'cash';
  if(/채권|국채|미국채|회사채|종합채권|bond|treasury/.test(n))return 'bond';
  if(/배당|dividend|커버드콜|covered\s*call|인컴|income|리츠|reit|우선주|월배당|고배당/.test(n))return 'dividend';
  if(/금현물|골드|gold|원자재|commodity|은선물|silver|원유|oil|대체/.test(n))return 'alternative';
  return 'growth';
}
function v29MigrateHoldingClass(h){
  const old=String(h.class||'');
  if(old==='cash')return 'cash';
  if(old==='bond')return v29GuessClass(h.name)==='cash'?'cash':'bond';
  if(old==='gold'||old==='alternative')return 'alternative';
  if(old==='dividend'||old==='income')return 'dividend';
  if(old==='growth')return 'growth';
  return v29GuessClass(h.name);
}
function v29EnsureState(){
  state.settings=state.settings||{};state.settings.assetAliases=state.settings.assetAliases&&typeof state.settings.assetAliases==='object'?state.settings.assetAliases:{};
  state.settings.input={mergeDuplicates:true,rememberClass:true,...(state.settings.input||{})};
  if(state.meta?.assetClassModelVersion!=='3.0'){
    state.settings.assetClasses=V29_CLASSES.map(c=>({...c,extensions:{standard:true}}));
    state.settings.assetAliases={};
  }else{
    const old=Array.isArray(state.settings.assetClasses)?state.settings.assetClasses:[];
    state.settings.assetClasses=V29_CLASSES.map(c=>({...c,target:Number(old.find(x=>x.id===c.id)?.target??c.target),extensions:{standard:true}}));
    const total=state.settings.assetClasses.reduce((sum,c)=>sum+v29N(c.target),0);if(Math.abs(total-100)>.01)state.settings.assetClasses=V29_CLASSES.map(c=>({...c,extensions:{standard:true}}));
  }
  for(const key of ['pension','irp'])for(const h of state.accounts?.[key]?.holdings||[]){
    h.class=v29MigrateHoldingClass(h);
    state.settings.assetAliases[v29Norm(h.name)]=h.class;
    if(key==='irp'&&typeof h.risk!=='boolean'){h.risk=v29Class(h.class).riskWeight>=70;h.riskSource='estimated'}
  }
  for(const [alias,id] of Object.entries(state.settings.assetAliases)){state.settings.assetAliases[alias]=V29_CLASSES.some(c=>c.id===id)?id:v29MapClass(id)}
  state.settings.theme=['auto','light','dark'].includes(state.settings.theme)?state.settings.theme:'auto';
  state.ui=state.ui||{};state.meta=state.meta||{};state.meta.assetClassModelVersion='3.0';state.meta.appVersion=V29_VERSION;
}
function v29Allocation(key){
  const a=state.accounts[key],sums=Object.fromEntries(V29_CLASSES.map(c=>[c.id,0]));let holdings=0;
  for(const h of a.holdings||[]){const value=Math.max(0,v29N(h.value));if(value<=0)continue;sums[v29MigrateHoldingClass(h)]+=value;holdings++}
  if(v29N(a.cash)>0)sums.cash+=v29N(a.cash);
  const total=Object.values(sums).reduce((sum,n)=>sum+n,0),active=V29_CLASSES.map(c=>({...c,value:sums[c.id],pct:total?sums[c.id]/total*100:0})).filter(c=>c.value>0.5);
  let cursor=0;const stops=[];for(const row of active){const next=cursor+row.pct;stops.push(`${row.color} ${cursor.toFixed(2)}% ${next.toFixed(2)}%`);cursor=next}
  return {total,holdings,active,gradient:stops.length?`conic-gradient(${stops.join(',')})`:'conic-gradient(#dfe5ee 0 100%)'};
}
function v29RiskSummary(key){
  if(key!=='irp')return null;const a=state.accounts.irp,total=accountTotal(a),risk=(a.holdings||[]).filter(h=>h.risk!==false).reduce((sum,h)=>sum+v29N(h.value),0),safe=Math.max(0,total-risk);return {risk,safe,total,pct:total?risk/total*100:0};
}
function v29OpenAllocationDetails(key){
  const pack=v29Allocation(key),a=state.accounts[key],title=document.getElementById('formTitle'),body=document.getElementById('formBody');title.textContent='자산 구성 상세';
  body.innerHTML=pack.active.length?`<div class="sheetNotice">보기 전용입니다. 분류를 바꾸려면 해당 종목을 추가·수정할 때 자산군을 선택하세요.</div><div class="v30AllocationDetail">${pack.active.map(row=>{const holdings=(a.holdings||[]).filter(h=>v29MigrateHoldingClass(h)===row.id&&v29N(h.value)>0);const cash=row.id==='cash'&&v29N(a.cash)>0?`<div class="v30DetailHolding"><span>계좌 대기자금</span><b>${man(a.cash)}</b></div>`:'';return `<section><div class="v30DetailHead"><span><i style="--dot:${row.color}"></i><b>${esc(row.name)}</b></span><strong>${row.pct.toFixed(1)}%<small>${man(row.value)}</small></strong></div>${holdings.map(h=>`<div class="v30DetailHolding"><span>${esc(h.name)}</span><b>${man(h.value)}</b></div>`).join('')}${cash}</section>`}).join('')}</div>`:`<div class="empty"><b>구성할 자산이 없어요</b><p>자산현황을 입력하면 보유 중인 자산군만 표시됩니다.</p></div>`;
  openSheet('formSheet',true);
}
function v29AllocationCard(key){
  const pack=v29Allocation(key),risk=v29RiskSummary(key),legend=pack.active.map(row=>`<div class="v29LegendRow"><i style="--dot:${row.color}"></i><span><b>${esc(row.name)}</b></span><strong>${row.pct.toFixed(1)}%</strong></div>`).join('');
  const card=document.createElement('section');card.className='card v29AllocationCard v30AllocationCompact';card.innerHTML=`<div class="v29CardHead"><div><div class="eyebrow">현재 보유 기준</div><h2>자산 구성</h2></div><small>원그래프를 눌러 상세보기</small></div>${pack.active.length?`<div class="v29AllocationBody"><button class="v29Donut" id="v29Donut" style="--donut:${pack.gradient}" aria-label="자산 구성 상세 보기"><span><b>${pack.active.length}</b><small>자산군</small></span></button><div class="v29Legend">${legend}</div></div>`:`<div class="empty"><b>구성할 자산이 없어요</b><p>자산현황을 입력하면 보유 중인 자산군만 표시됩니다.</p></div>`}${risk?`<div class="v29RiskStrip"><span>IRP 위험자산 참고 추정</span><b>${risk.pct.toFixed(1)}%</b><small>안전자산 ${(100-risk.pct).toFixed(1)}% · 증권사 법정 분류가 우선</small></div>`:''}`;
  card.querySelector('#v29Donut')?.addEventListener('click',()=>v29OpenAllocationDetails(key));return card;
}
function v29KnownNames(){return [...new Set([...V29_KNOWN,...['pension','irp'].flatMap(k=>(state.accounts[k].holdings||[]).map(h=>h.name))])].sort((a,b)=>a.localeCompare(b,'ko'))}
function v31ArchiveHolding(key,index,reason='user-deleted'){
  const a=state.accounts[key],h=a?.holdings?.[index];if(!h)return false;
  state.archives=state.archives||{};state.archives.holdings=Array.isArray(state.archives.holdings)?state.archives.holdings:[];
  state.archives.holdings.push({archiveId:entityUid('holding-archive'),entityType:'holding',entityId:h.id,accountId:a.id,archivedAt:isoNow(),reason,data:clone({...h,status:'inactive'})});
  a.holdings.splice(index,1);state.lastUpdated=localDisplayDate(new Date());updateYearFromAssets();save();renderAll(true);return true;
}
function v31ConfirmDeleteHolding(key,index){
  const h=state.accounts?.[key]?.holdings?.[index];if(!h)return;
  const title=document.getElementById('formTitle'),body=document.getElementById('formBody');title.textContent='종목 삭제';body.innerHTML=`<div class="v30DangerConfirm"><strong>${esc(h.name)}을(를) 삭제하시겠습니까?</strong><p>현재 보유목록에서는 제거되지만, 복구와 이력 확인을 위해 보관 기록에는 남습니다.</p></div><div class="v30ConfirmActions"><button class="btn full" id="v31CancelDelete">취소</button><button class="btn danger full" id="v31ConfirmDelete">삭제</button></div>`;document.getElementById('v31CancelDelete').onclick=()=>closeSheet('formSheet');document.getElementById('v31ConfirmDelete').onclick=()=>{if(v31ArchiveHolding(key,index)){closeSheet('formSheet');toast('종목을 삭제했어요')}};openSheet('formSheet',true);
}
function v29OpenHoldingForm(prefKey=state.ui.accountView,editIndex=null){
  const editing=Number.isInteger(editIndex)&&editIndex>=0,source=editing?state.accounts[prefKey]?.holdings?.[editIndex]:null;
  const title=document.getElementById('formTitle'),body=document.getElementById('formBody');title.textContent=editing?'종목 수정':'종목 추가';
  const initialClass=source?v29MigrateHoldingClass(source):'growth';
  body.innerHTML=`<div class="sheetNotice">${editing?'이 화면에서 종목 정보와 자산군을 함께 수정합니다.':'종목명을 입력하면 자산군을 자동 제안합니다. 같은 계좌에 같은 종목명이 있으면 중복 생성 없이 기존 종목을 갱신합니다.'}</div><div class="field"><label>계좌</label><select id="v29HoldingAccount" ${editing?'disabled':''}><option value="pension" ${prefKey==='pension'?'selected':''}>연금저축</option><option value="irp" ${prefKey==='irp'?'selected':''}>IRP</option></select></div><div class="field"><label>종목명</label><input id="v29HoldingName" list="v29HoldingNames" autocomplete="off" placeholder="예: KODEX 머니마켓액티브" value="${esc(source?.name||'')}"><datalist id="v29HoldingNames">${v29KnownNames().map(n=>`<option value="${esc(n)}"></option>`).join('')}</datalist><div class="inputHelp" id="v29DuplicateHelp">이름을 입력하면 자산군을 자동 제안합니다.</div></div><div class="twoFields"><div class="field"><label>평가금액</label><input id="v29HoldingValue" inputmode="numeric" value="${source?v29N(source.value).toLocaleString('ko-KR'):''}" placeholder="예: 5,800,000"></div><div class="field"><label>매입금액</label><input id="v29HoldingCost" inputmode="numeric" value="${source?v29N(source.cost).toLocaleString('ko-KR'):''}" placeholder="예: 4,900,000"></div></div><div class="twoFields"><div class="field"><label>수량</label><input id="v29HoldingQty" inputmode="decimal" value="${source?v29N(source.qty):''}" placeholder="예: 66"></div><div class="field"><label>자산군</label><select id="v29HoldingClass">${v29ClassOptions(initialClass)}</select></div></div><label class="balanceCheck" id="v29CashAdjustWrap"><input type="checkbox" id="v29CashAdjust"><span>신규 종목 금액만큼 계좌 대기자금에서 차감</span></label><div class="field v29RiskField" id="v29RiskField"><label>IRP 위험자산 분류</label><select id="v29HoldingRisk"><option value="auto">자동 추정</option><option value="risk" ${source?.risk===true?'selected':''}>위험자산</option><option value="safe" ${source?.risk===false?'selected':''}>안전자산</option></select></div><div class="settingsInfo" id="v29HoldingPreview"></div><button class="btn primary full" id="v29SaveHolding">${editing?'수정 저장':'종목 저장'}</button>${editing?'<button class="btn dangerOutline full" id="v31DeleteHolding" style="margin-top:10px">이 종목 삭제</button>':''}`;
  ['v29HoldingValue','v29HoldingCost'].forEach(id=>{const el=document.getElementById(id);el.onblur=()=>{const n=parseMoney(el.value);el.value=n?Number(n).toLocaleString('ko-KR'):''}});
  const account=document.getElementById('v29HoldingAccount'),name=document.getElementById('v29HoldingName'),cls=document.getElementById('v29HoldingClass'),riskField=document.getElementById('v29RiskField'),cashWrap=document.getElementById('v29CashAdjustWrap'),preview=document.getElementById('v29HoldingPreview'),help=document.getElementById('v29DuplicateHelp'),btn=document.getElementById('v29SaveHolding');
  let classTouched=editing;
  const findDuplicate=()=>state.accounts[account.value].holdings.findIndex((h,i)=>i!==editIndex&&v29Norm(h.name)===v29Norm(name.value)&&v29Norm(name.value));
  const update=()=>{const key=account.value,idx=findDuplicate(),suggest=v29GuessClass(name.value);if(!classTouched)cls.value=suggest;riskField.style.display=key==='irp'?'block':'none';cashWrap.style.display=!editing&&idx<0&&v29N(state.accounts[key].cash)>0?'flex':'none';help.textContent=editing?'현재 종목을 수정합니다. 자산군 변경도 이곳에서만 합니다.':idx>=0?'같은 이름의 기존 종목을 찾았습니다. 저장하면 중복 생성 없이 갱신합니다.':`자동 분류: ${v29Class(cls.value).name}`;help.className=`inputHelp ${idx>=0?'good':''}`;btn.textContent=editing?'수정 저장':idx>=0?'기존 종목 갱신':'새 종목 추가';preview.innerHTML=`<b>${esc(v29Class(cls.value).name)} · ${editing?'현재 종목 수정':idx>=0?'기존 종목 갱신':'신규 등록'}</b><div class="tiny" style="margin-top:5px">${esc(v29Class(cls.value).hint)}</div>`};
  account.onchange=()=>{classTouched=false;update()};name.oninput=update;cls.onchange=()=>{classTouched=true;update()};update();
  btn.onclick=()=>{const key=account.value,a=state.accounts[key],nm=name.value.trim(),value=parseMoney(document.getElementById('v29HoldingValue').value),cost=parseMoney(document.getElementById('v29HoldingCost').value),qty=Number(String(document.getElementById('v29HoldingQty').value).replace(/,/g,''))||0,classId=cls.value,duplicate=findDuplicate(),targetIndex=editing?editIndex:duplicate;if(!nm)return toast('종목명을 입력하세요');if(value<0||cost<0||qty<0)return toast('금액과 수량은 0 이상으로 입력하세요');if(value===0&&cost===0)return toast('평가금액 또는 매입금액을 입력하세요');if(editing&&duplicate>=0)return toast('같은 계좌에 같은 종목명이 이미 있습니다');const previous=targetIndex>=0?a.holdings[targetIndex]:{},riskMode=document.getElementById('v29HoldingRisk').value,risk=key==='irp'?(riskMode==='auto'?(typeof previous.risk==='boolean'?previous.risk:v29Class(classId).riskWeight>=70):riskMode==='risk'):undefined;const next=prepareHolding(key,{...previous,name:nm,value,cost:cost||value,qty,class:classId,dividend:v29N(previous.dividend),realized:v29N(previous.realized),risk,riskSource:key==='irp'?(riskMode==='auto'?'estimated':'user'):undefined},previous);if(targetIndex>=0)a.holdings[targetIndex]=next;else{a.holdings.push(next);if(document.getElementById('v29CashAdjust').checked)a.cash=Math.max(0,v29N(a.cash)-value)}state.settings.assetAliases[v29Norm(nm)]=classId;state.ui.accountView=key;state.lastUpdated=localDisplayDate(new Date());updateYearFromAssets();save();closeSheet('formSheet');renderAll(true);toast(editing?'종목을 수정했어요':targetIndex>=0?'기존 종목을 갱신했어요':'종목을 추가했어요')};
  document.getElementById('v31DeleteHolding')?.addEventListener('click',()=>{closeSheet('formSheet');setTimeout(()=>v31ConfirmDeleteHolding(prefKey,editIndex),80)});openSheet('formSheet',true);
}
async function v29ExportJson(){try{await window.PensionV1Data?.persistNow?.({strict:true,syncCloud:false});const data=clone(state),validation=window.PensionV1Data?.validate?.(data);if(validation&&!validation.ok)throw new Error(validation.errors[0]);const blob=new Blob([JSON.stringify({appId:'asset-os-pension',appVersion:V29_VERSION,schemaVersion:data.schemaVersion,createdAt:new Date().toISOString(),data},null,2)],{type:'application/json'}),name=`pension_${localYmd(new Date())}.json`;if(typeof v1Download==='function')v1Download(blob,name);else{const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000)}toast('검증된 JSON 내보내기를 시작했어요')}catch(e){toast(`JSON 내보내기 중단: ${e?.message||e}`)}}
function v29CsvEscape(v){let s=String(v??'');if(/^[=+\-@\t\r]/.test(s))s="'"+s;return /[",\n]/.test(s)?`"${s.replace(/"/g,'""')}"`:s}
async function v29ExportCsv(){try{await window.PensionV1Data?.persistNow?.({strict:true,syncCloud:false});const validation=window.PensionV1Data?.validate?.(clone(state));if(validation&&!validation.ok)throw new Error(validation.errors[0]);const rows=[['date','account','type','asset','amount','note'],...(state.ledger||[]).filter(r=>r.status!=='void').map(r=>[String(r.date||'').slice(0,10),r.accountKey||String(r.accountId||'').replace('account-',''),r.type,r.assetName||'',r.amount||0,r.note||''])],text='\ufeff'+rows.map(r=>r.map(v29CsvEscape).join(',')).join('\r\n'),blob=new Blob([text],{type:'text/csv;charset=utf-8'}),name=`pension-ledger_${localYmd(new Date())}.csv`;if(typeof v1Download==='function')v1Download(blob,name);else{const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=name;a.click()}toast('검증된 CSV 내보내기를 시작했어요')}catch(e){toast(`CSV 내보내기 중단: ${e?.message||e}`)}}
function v29OpenFutureEditor(){
  const baseMonthly=v29N(state.settings.monthly.pension)+v29N(state.settings.monthly.irp),saved=state.ui.v29Custom||state.ui.v21Custom||{monthly:baseMonthly,rate:v29N(state.settings.returnRate),retAge:v29N(state.profile.retirementAge),inflation:v29N(state.settings.inflation),withdrawYears:v29N(state.settings.withdrawYears),withdrawReturn:v29N(state.settings.withdrawReturn)};
  document.getElementById('formTitle').textContent='내 가정 비교';document.getElementById('formBody').innerHTML=`<div class="sheetNotice">기본 계획은 바꾸지 않고 비교 화면에만 적용합니다.</div><div class="field"><label>월 납입액</label><input id="v29FutureMonthly" inputmode="numeric" value="${Number(saved.monthly).toLocaleString('ko-KR')}"></div><div class="twoFields"><div class="field"><label>기대수익률</label><input id="v29FutureRate" type="number" step="0.1" value="${saved.rate}"></div><div class="field"><label>연금 개시 나이</label><input id="v29FutureRet" type="number" value="${saved.retAge}"></div></div><div class="twoFields"><div class="field"><label>물가상승률</label><input id="v29FutureInflation" type="number" step="0.1" value="${saved.inflation??state.settings.inflation}"></div><div class="field"><label>수령 기간</label><input id="v29FutureYears" type="number" value="${saved.withdrawYears??state.settings.withdrawYears}"></div></div><div class="field"><label>수령 중 수익률</label><input id="v29FutureWithdraw" type="number" step="0.1" value="${saved.withdrawReturn??state.settings.withdrawReturn}"></div><button class="btn primary full" id="v29FutureApply">내 가정 적용</button><button class="btn full" id="v29FutureReset" style="margin-top:10px">비교 가정 초기화</button>`;const m=document.getElementById('v29FutureMonthly');m.onblur=()=>{const n=parseMoney(m.value);m.value=n?Number(n).toLocaleString('ko-KR'):''};document.getElementById('v29FutureApply').onclick=()=>{const custom={monthly:parseMoney(m.value),rate:Number(document.getElementById('v29FutureRate').value),retAge:Number(document.getElementById('v29FutureRet').value),inflation:Number(document.getElementById('v29FutureInflation').value),withdrawYears:Number(document.getElementById('v29FutureYears').value),withdrawReturn:Number(document.getElementById('v29FutureWithdraw').value)};if(custom.monthly<0||custom.rate<-20||custom.rate>20||custom.retAge<v29CurrentAge()||custom.retAge>90||custom.inflation<0||custom.inflation>10||custom.withdrawYears<5||custom.withdrawYears>50||custom.withdrawReturn<-10||custom.withdrawReturn>15)return toast('비교 가정 값을 확인하세요');state.ui.v29Custom=custom;state.ui.v21Custom={monthly:custom.monthly,rate:custom.rate,retAge:custom.retAge};state.ui.v21Scenario='custom';state.ui.futureAge=custom.retAge;save();closeSheet('formSheet');renderFutureContent()};document.getElementById('v29FutureReset').onclick=()=>{delete state.ui.v29Custom;delete state.ui.v21Custom;state.ui.v21Scenario='base';state.ui.futureAge=state.profile.retirementAge;save();closeSheet('formSheet');renderFutureContent()};openSheet('formSheet',true);
}
function v29Project(custom){
  const cfg=custom||{monthly:v29N(state.settings.monthly.pension)+v29N(state.settings.monthly.irp),rate:v29N(state.settings.returnRate),retAge:v29N(state.profile.retirementAge),inflation:v29N(state.settings.inflation),withdrawYears:v29N(state.settings.withdrawYears),withdrawReturn:v29N(state.settings.withdrawReturn)},years=Math.max(0,cfg.retAge-v29CurrentAge()),rm=Math.pow(Math.max(.01,1+cfg.rate/100),1/12)-1;let bal=totalAsset();for(let i=0;i<years*12;i++){bal*=1+rm;bal+=cfg.monthly}
  /* 예상자산은 은퇴 시점 명목금액이다. 월연금은 먼저 현재가치로 환산한 뒤,
     수령 중 실질수익률과 수령기간을 적용해 계산한다. 같은 숫자를 홈·미래·비교에 공통 사용한다. */
  const inflationFactor=Math.pow(Math.max(.01,1+cfg.inflation/100),years),todayAsset=bal/inflationFactor,annualReal=(1+cfg.withdrawReturn/100)/(1+cfg.inflation/100)-1,months=Math.max(1,cfg.withdrawYears*12),r=Math.pow(Math.max(.01,1+annualReal),1/12)-1,den=1-Math.pow(1+r,-months),monthly=Math.abs(r)>1e-10&&Math.abs(den)>1e-10?todayAsset*r/den:todayAsset/months;return {asset:bal,todayAsset,monthly,cfg};
}
function v29EnhanceFuture(){
  const segment=document.querySelector('#future .v21Scenario'),safe=segment?.querySelector('[data-scenario="safe"]');safe?.remove();if(segment)segment.classList.add('v29TwoScenario');const customBtn=segment?.querySelector('[data-scenario="custom"]');if(customBtn){const clone=customBtn.cloneNode(true);customBtn.replaceWith(clone);clone.onclick=()=>v29OpenFutureEditor()}
  const edit=document.getElementById('v21EditCustom');if(edit){const clone=edit.cloneNode(true);edit.replaceWith(clone);clone.onclick=v29OpenFutureEditor}
  const stack=document.querySelector('#future .stack'),summary=stack?.querySelector('.v21FutureSummary');if(!stack||!summary)return;const base=v29Project(),custom=state.ui.v29Custom?v29Project(state.ui.v29Custom):null,selected=state.ui.v21Scenario==='custom'&&custom?custom:base,goal=v29N(state.settings.goalMonthly),gap=selected.monthly-goal;
  const assetEl=summary.querySelector('.v21FutureTop strong'),monthlyEl=summary.querySelector('.v21FutureKpi span:first-child b'),gapEl=summary.querySelector('.v21FutureKpi span:nth-child(2) b'),gapLabel=summary.querySelector('.v21FutureKpi span:nth-child(2)'),fine=summary.querySelector(':scope > small');if(assetEl)assetEl.textContent=man(selected.asset);if(monthlyEl)monthlyEl.textContent=man(selected.monthly);if(gapLabel)gapLabel.childNodes[0].textContent=gap>=0?'목표보다 ':'목표까지 ';if(gapEl){gapEl.textContent=`${man(Math.abs(gap))}${gap>=0?' 여유':' 부족'}`;gapEl.className=gap>=0?'good':'bad'}if(fine)fine.textContent=`오늘 돈 가치 · ${selected.cfg.withdrawYears}년 수령 · 수령 중 ${selected.cfg.withdrawReturn}% 가정 · 국민연금·세금·수수료 제외`;
  const card=document.createElement('section');card.className='card v29ScenarioCompare';card.innerHTML=custom?`<div class="v29CardHead"><div><div class="eyebrow">기본 계획과 비교</div><h2>내 가정 차이</h2></div><button class="v29TextBtn" id="v29EditScenario">가정 편집</button></div><div class="v29CompareGrid"><div><small>예상자산</small><b>${man(custom.asset)}</b><span class="${custom.asset>=base.asset?'good':'bad'}">${custom.asset>=base.asset?'+':''}${man(custom.asset-base.asset)}</span></div><div><small>현재가치 월연금</small><b>${man(custom.monthly)}</b><span class="${custom.monthly>=base.monthly?'good':'bad'}">${custom.monthly>=base.monthly?'+':''}${man(custom.monthly-base.monthly)}</span></div></div><div class="v29AssumptionLine">월 ${man(custom.cfg.monthly)} · 수익률 ${custom.cfg.rate}% · ${custom.cfg.retAge}세 개시 · 물가 ${custom.cfg.inflation}% · ${custom.cfg.withdrawYears}년 수령</div>`:`<button class="v29ScenarioEmpty" id="v29CreateScenario"><span><b>내 가정과 비교하기</b><small>월 납입·수익률·개시 나이·물가·수령기간을 한 번에 바꿉니다.</small></span><span>›</span></button>`;summary.after(card);card.querySelector('#v29EditScenario,#v29CreateScenario')?.addEventListener('click',v29OpenFutureEditor);
}
function v29EnhanceHome(){
  const home=document.getElementById('home');if(!home)return;const hero=home.querySelector('.v21HomeHero,.hero');hero?.classList.add('v29HomeHero');const coach=home.querySelector('#homeCoach,.uxHomeCoach');if(coach){const status=coach.querySelector('.v12CoachState')?.textContent||'';if(/정상|특이사항 없음|관찰/.test(status))coach.classList.add('v29CoachCompact')}
  const exact=home.querySelector('.v21Exact,.heroFoot');if(exact)exact.title='원 단위 총액과 누적 순납입';const future=home.querySelector('#v21Future'),project=v29Project(),goal=v29N(state.settings.goalMonthly),value=future?.querySelector('strong'),small=future?.querySelector('small');if(value)value.textContent=man(project.monthly);if(small)small.textContent=project.monthly>=goal?'목표 달성권 · 자세히 ›':`목표보다 ${man(goal-project.monthly)} 부족 · 자세히 ›`;
}
function v29BlankState(previousRevision=0){
  const blank=clone(sample),created=isoNow();blank.profile={...clone(sample.profile)};blank.settings={...clone(sample.settings),assetClasses:V29_CLASSES.map(c=>({...c,extensions:{standard:true}})),assetAliases:{},theme:'auto'};blank.accounts={pension:{...clone(sample.accounts.pension),principal:0,cash:0,holdings:[]},irp:{...clone(sample.accounts.irp),principal:0,cash:0,holdings:[]}};blank.years={};blank.accountYears={pension:{},irp:{}};blank.dividendsByAsset={};blank.ledger=[];blank.snapshots=[];blank.archives={holdings:[],records:[],snapshots:[]};blank.extensions={monthlySummaries:[]};blank.runtime={contributions:{}};blank.ui={...clone(sample.ui),screen:'home',accountView:'pension',futureAge:65};blank.dataId=entityUid('pension-data');blank.meta={...clone(sample.meta),createdAt:created,updatedAt:created,revision:Math.max(1,Number(previousRevision)||0)+1,appVersion:V29_VERSION,assetClassModelVersion:'3.0',identityContractVersion:DATA_CONTRACT_VERSION,ledgerMigrationV11:{completedAt:created,ledgerSchemaVersion:2},resetAt:created};blank.lastUpdated=localDisplayDate(new Date());return coreEnsureSchema6(blank)
}
async function v29CommitReset(){
  const previousRevision=Number(state.meta?.revision)||0;
  state=v29BlankState(previousRevision);lastSignature=dataSignature(state);
  for(const key of LEGACY_KEYS)localStorage.removeItem(key);
  localStorage.setItem(STORAGE,JSON.stringify(state));
  if(typeof putDB==='function')await putDB();
  if(window.PensionV1Data?.persistNow)await window.PensionV1Data.persistNow({strict:true,syncCloud:false});
  const local=JSON.parse(localStorage.getItem(STORAGE)||'null'),db=await window.PensionV1Data?.readLocal?.();
  const empty=x=>x&&x.accounts?.pension?.holdings?.length===0&&x.accounts?.irp?.holdings?.length===0&&(x.ledger||[]).length===0;
  if(!empty(local)||!empty(db))throw new Error('초기화 후 저장 검증이 일치하지 않습니다.');
  sessionStorage.setItem('pension-v30-reset-ok','1');location.reload();
}
function v29OpenResetConfirm(){
  document.getElementById('formTitle').textContent='전체 초기화';document.getElementById('formBody').innerHTML=`<div class="v30DangerConfirm"><strong>정말 초기화하시겠습니까?</strong><p>연금저축·IRP 자산, 거래·납입·배당 기록, 설정과 백업 상태가 모두 삭제됩니다. 되돌릴 수 없습니다.</p></div><div class="v30ConfirmActions"><button class="btn full" id="v30CancelReset">취소</button><button class="btn danger full" id="v30ConfirmReset">초기화</button></div>`;document.getElementById('v30CancelReset').onclick=()=>closeSheet('formSheet');document.getElementById('v30ConfirmReset').onclick=async()=>{const btn=document.getElementById('v30ConfirmReset');btn.disabled=true;btn.textContent='초기화 중…';try{await v29CommitReset()}catch(e){btn.disabled=false;btn.textContent='초기화';toast(`초기화 실패: ${e?.message||e}`)}};openSheet('formSheet',true)
}
function v29EnhanceSettings(){
  const body=document.getElementById('settingsBody');if(!body)return;const notice=body.querySelector('.sheetNotice'),theme=body.querySelector('.v21ThemeSection');if(theme){theme.classList.add('v29ThemeTop');notice?.after(theme)}
  const classRows=document.getElementById('classRows'),add=document.getElementById('addClass');if(classRows){classRows.innerHTML=state.settings.assetClasses.map((c,i)=>`<div class="v29TargetRow"><input class="className" data-i="${i}" value="${esc(c.name)}" readonly aria-label="자산군 이름"><span><small>${esc(c.hint)}</small></span><input class="classTarget" data-i="${i}" type="number" min="0" max="100" step="1" value="${c.target}" aria-label="${esc(c.name)} 목표 비중"><b>%</b></div>`).join('');add?.remove();const sum=document.getElementById('targetSum'),refreshSum=()=>{const total=[...classRows.querySelectorAll('.classTarget')].reduce((n,x)=>n+(Number(x.value)||0),0);if(sum){sum.textContent=`합계 ${total.toFixed(total%1?1:0)}%`;sum.classList.toggle('bad',Math.abs(total-100)>.01)}};classRows.querySelectorAll('.classTarget').forEach(x=>x.addEventListener('input',refreshSum));refreshSum();classRows.closest('.settingsSection')?.classList.add('v29ClassSettings')}
  if(!body.querySelector('#v29ClassificationGuide')){const section=classRows?.closest('.settingsSection'),guide=document.createElement('details');guide.id='v29ClassificationGuide';guide.className='v29Guide';guide.innerHTML=`<summary>자동 분류 기준 보기</summary><div>${V29_CLASSES.map(c=>`<p><b>${c.name}</b><span>${c.hint}</span></p>`).join('')}<small>자산군은 종목 추가·수정 화면에서 확인하거나 바꿉니다. 계좌의 원그래프는 보기 전용입니다.</small></div>`;section?.appendChild(guide)}
  const dataLaunch=body.querySelector('#openDataCenter')?.closest('.settingsSection');if(dataLaunch&&theme)dataLaunch.classList.add('v29DataSettings');
  if(!body.querySelector('#v30ResetSection')){const saveBar=body.querySelector('.saveBar'),danger=document.createElement('div');danger.id='v30ResetSection';danger.className='settingsSection v30DangerSection';danger.innerHTML=`<div class="settingsTitle">위험 작업</div><button class="dataLaunch v30ResetButton" id="v30ResetAll"><span><b>모든 데이터 초기화</b><small>확인창을 거친 뒤 자산·기록·설정을 모두 삭제합니다.</small></span><span>›</span></button>`;body.insertBefore(danger,saveBar);danger.querySelector('#v30ResetAll').onclick=v29OpenResetConfirm}
  const n=body.querySelector('.sheetNotice');if(n)n.innerHTML=`<b>개인연금 V3.1</b> · 저장 버튼을 눌러야 반영됩니다.<br>테마·계획·고정 자산군·백업을 관리합니다.`;
}
function v29EnhanceDataCenter(){
  const body=document.getElementById('dataCenterBody');if(!body||body.querySelector('#v29ExportJson'))return;const actions=body.querySelector('.dataActions');if(!actions)return;const extra=document.createElement('div');extra.className='v29ExportActions';extra.innerHTML=`<button class="dataAction" id="v29ExportJson"><span><strong>JSON 단독 내보내기</strong><small>다른 앱이나 AI 복구용 표준 원본</small></span><span class="arrow">↓</span></button><button class="dataAction" id="v29ExportCsv"><span><strong>원장 CSV 내보내기</strong><small>납입·배당·매도 기록을 표로 저장</small></span><span class="arrow">↓</span></button>`;actions.after(extra);document.getElementById('v29ExportJson').onclick=v29ExportJson;document.getElementById('v29ExportCsv').onclick=v29ExportCsv;const notice=body.querySelector('.sheetNotice');if(notice)notice.innerHTML=`<b>V3.1 데이터 보관</b><br>기기 저장과 독립 ZIP·JSON·CSV를 제공합니다. Firebase 클라우드 원본 연결 전에는 기기 저장·ZIP·JSON·CSV만 실제 사용합니다.`;
}
function v29UpgradeQuickSheet(){
  const grid=document.querySelector('#quickSheet .quickGrid');if(!grid||grid.querySelector('[data-quick="holding"]'))return;const detail=grid.querySelector('[data-quick="detail"]'),btn=document.createElement('button');btn.className='quickItem';btn.dataset.quick='holding';btn.innerHTML='<span class="quickIcon">◎</span><span><b>종목 추가·수정</b><small>자동 분류·중복 갱신</small></span><span>›</span>';grid.insertBefore(btn,detail);btn.onclick=()=>quickForm('holding');
}
function v29PatchGlobals(){
  try{guessClassId=v29GuessClass}catch(_){}try{guessClassRelease=v29GuessClass}catch(_){}try{classOptions=v29ClassOptions}catch(_){}try{releaseClassOptions=v29ClassOptions}catch(_){}
  if(typeof V1_PROJECT_ASSETS!=='undefined'){for(const f of ['v29.css','v29.js'])if(!V1_PROJECT_ASSETS.includes(f))V1_PROJECT_ASSETS.push(f)}
}
v29EnsureState();v29PatchGlobals();
const v29PrevAccount=renderAccount;renderAccount=function(){v29EnsureState();v29PrevAccount();const key=state.ui.accountView,stack=document.querySelector('#account .accountWrap .stack'),holdings=stack?.querySelector('.card.holdings');if(!stack||!holdings)return;stack.querySelector('.v29AllocationCard')?.remove();stack.insertBefore(v29AllocationCard(key),holdings);const metric=stack.querySelectorAll('.miniMetric small')[2];if(metric)metric.textContent='대기자금';if(!holdings.querySelector('.v29HoldingHead')){const head=document.createElement('div');head.className='v29HoldingHead';head.innerHTML=`<div><div class="eyebrow">현재 등록</div><h2>보유상품 ${state.accounts[key].holdings.length}개</h2></div><button id="v29AddHolding">종목 추가</button>`;holdings.prepend(head);head.querySelector('#v29AddHolding').onclick=()=>v29OpenHoldingForm(key)}holdings.querySelectorAll('.holdingRow').forEach((row,i)=>{const h=state.accounts[key].holdings[i],small=row.querySelector('.holdingBtn>div>small');if(h&&small)small.textContent=`${v29Class(h.class).name} · ${Number(h.qty||0).toLocaleString('ko-KR')}주`;const detail=row.querySelector('.holdingDetailInner');if(detail&&!detail.querySelector('.v31HoldingActions')){const actions=document.createElement('div');actions.className='v31HoldingActions';actions.innerHTML='<button class="btn" data-v31-edit>종목 수정</button><button class="btn dangerOutline" data-v31-delete>삭제</button>';detail.appendChild(actions);actions.querySelector('[data-v31-edit]').onclick=e=>{e.stopPropagation();v29OpenHoldingForm(key,i)};actions.querySelector('[data-v31-delete]').onclick=e=>{e.stopPropagation();v31ConfirmDeleteHolding(key,i)}}})};
const v29PrevHome=renderHome;renderHome=function(){v29EnsureState();v29PrevHome();v29EnhanceHome()};
const v29PrevSettings=renderSettings;renderSettings=function(){v29EnsureState();v29PrevSettings();v29EnhanceSettings()};
const v29PrevFutureContent=renderFutureContent;renderFutureContent=function(){v29EnsureState();let restore=null;if(state.ui.v21Scenario==='custom'&&state.ui.v29Custom){restore={inflation:state.settings.inflation,withdrawYears:state.settings.withdrawYears,withdrawReturn:state.settings.withdrawReturn};state.settings.inflation=state.ui.v29Custom.inflation;state.settings.withdrawYears=state.ui.v29Custom.withdrawYears;state.settings.withdrawReturn=state.ui.v29Custom.withdrawReturn;state.ui.v21Custom={monthly:state.ui.v29Custom.monthly,rate:state.ui.v29Custom.rate,retAge:state.ui.v29Custom.retAge}}v29PrevFutureContent();if(restore)Object.assign(state.settings,restore);v29EnhanceFuture()};
const v29PrevQuick=quickForm;quickForm=function(type){if(type==='holding'){document.getElementById('quickSheet')?.classList.remove('open');v29OpenHoldingForm();return}v29PrevQuick(type)};
const v29PrevDataRefresh=typeof v1RefreshDataCenter==='function'?v1RefreshDataCenter:null;if(v29PrevDataRefresh){v1RefreshDataCenter=function(){v29PrevDataRefresh();v29EnhanceDataCenter()}}
const v29PrevSave=save;save=function(){v29EnsureState();const ok=v29PrevSave();state.meta.appVersion=V29_VERSION;try{localStorage.setItem(STORAGE,JSON.stringify(state))}catch(_){}return ok};
const v29PrevRenderAll=renderAll;renderAll=function(keep=false){v29EnsureState();v29PrevRenderAll(keep);v29EnhanceHome();document.title='개인연금 V3.1';v29UpgradeQuickSheet();const sub=document.getElementById('headerSub');if(sub)sub.textContent=`${v29CurrentAge()}세 · ${state.profile.retirementAge}세 연금 개시 계획`;state.meta.appVersion=V29_VERSION};
v29UpgradeQuickSheet();
const v29DataHost=document.getElementById('dataCenterBody');if(v29DataHost)new MutationObserver(()=>v29EnhanceDataCenter()).observe(v29DataHost,{childList:true,subtree:false});document.addEventListener('click',e=>{if(e.target.closest('#openDataCenter'))setTimeout(v29EnhanceDataCenter,260)});
document.title='개인연금 V3.1';renderAll(true);save();
window.PensionV29={version:V29_VERSION,classes:V29_CLASSES,classify:v29GuessClass,allocation:v29Allocation,openHolding:v29OpenHoldingForm,openAllocation:v29OpenAllocationDetails,project:v29Project,ensure:v29EnsureState,deleteHolding:v31ArchiveHolding};
})();
