/* ===== js/40-release-polish.js ===== */
(()=>{
'use strict';
const RELEASE_VERSION='2.3.0';
state.meta=state.meta||{};state.meta.appVersion=RELEASE_VERSION;

/* ---------- clean chart interaction ---------- */
bindChart=function(hitId,data,chart,update){
  const hit=document.getElementById(hitId);if(!hit)return;
  const card=hit.closest('.chartCard');let dragging=false,hideTimer=null;
  const nearest=e=>{const r=hit.getBoundingClientRect(),px=clamp((e.clientX-r.left)/Math.max(1,r.width),0,1);return clamp(Math.round(px*(data.length-1)),0,data.length-1)};
  const show=()=>{clearTimeout(hideTimer);card?.classList.add('chart-active')};
  const hide=()=>{clearTimeout(hideTimer);hideTimer=setTimeout(()=>card?.classList.remove('chart-active'),650)};
  hit.onpointerdown=e=>{dragging=true;show();document.body.classList.add('charting');try{hit.setPointerCapture(e.pointerId)}catch(_){}update(nearest(e),false)};
  hit.onpointermove=e=>{if(dragging){show();update(nearest(e),false)}};
  hit.onpointerup=e=>{if(!dragging)return;dragging=false;document.body.classList.remove('charting');update(nearest(e),true);hide()};
  hit.onpointercancel=()=>{dragging=false;document.body.classList.remove('charting');hide()};
  hit.onkeydown=e=>{if(!['ArrowLeft','ArrowRight'].includes(e.key))return;e.preventDefault();show();const cur=Number(state.ui.performanceIndex)||0,dir=e.key==='ArrowRight'?1:-1;update(clamp(cur+dir,0,data.length-1),true);hide()};
  hit.setAttribute('tabindex','0');hit.setAttribute('role','slider');
};

/* ---------- stable floating input button ---------- */
const oldFab=document.getElementById('fab');const fab=oldFab.cloneNode(true);oldFab.replaceWith(fab);
let releaseFabTimer=null,lastScroll=window.scrollY;
function releaseHideFab(){clearTimeout(releaseFabTimer);fab.classList.remove('fabVisible')}
function releaseShowFab(){
  const screen=document.body.dataset.screen||state.ui.screen;
  if(!['home','account'].includes(screen)){releaseHideFab();return}
  fab.classList.add('fabVisible');clearTimeout(releaseFabTimer);releaseFabTimer=setTimeout(releaseHideFab,10000);
}
fab.onclick=()=>{releaseHideFab();openSheet('quickSheet')};
let scrollQueued=false;
window.addEventListener('scroll',()=>{if(scrollQueued)return;scrollQueued=true;requestAnimationFrame(()=>{const y=window.scrollY;if(y<lastScroll-10)releaseShowFab();else if(y>lastScroll+10)releaseHideFab();lastScroll=y;scrollQueued=false})},{passive:true});
const oldNavigateRelease=navigate;
navigate=function(screen,accountKey=null){oldNavigateRelease(screen,accountKey);requestAnimationFrame(()=>{if(['home','account'].includes(screen))releaseShowFab();else releaseHideFab()})};
document.querySelectorAll('.nav button').forEach(b=>b.addEventListener('click',()=>setTimeout(releaseShowFab,0)));

/* ---------- OCR helpers ---------- */
let ocrObjectUrl=null,ocrFile=null,ocrRows=[],ocrViewerScale=1;
const moneyToken=/[-+]?\d[\d,]*(?:\.\d+)?%?/g;
const numToken=v=>Number(String(v||'').replace(/[%+,\s]/g,''))||0;
function numericTokens(line){const out=[];for(const m of line.matchAll(moneyToken))out.push({raw:m[0],value:numToken(m[0]),index:m.index});return out}
function cleanLine(s){return String(s||'').replace(/[·•ㆍ]/g,' ').replace(/[“”‘’]/g,'').replace(/\s+/g,' ').trim()}
function normalizeFundName(raw){
  let s=cleanLine(raw).replace(/^[^A-Za-z가-힣0-9]+/,'').replace(/\b현금\b/g,'').trim();
  const c=s.replace(/\s/g,'').toUpperCase();
  if(/글로벌반도/.test(c)&&(/PLUS/.test(c)||/(TOP4|1064|10P4|17004)/.test(c)))return 'ACE 글로벌반도체TOP4 Plus';
  if(/미국나스/.test(c)&&/(닥|DAK)?100/.test(c))return 'RISE 미국나스닥100';
  if(/다우존스/.test(c)&&(/미국배/.test(c)||/KODEX/.test(c)||/^K/.test(c)))return 'KODEX 미국배당다우존스';
  if(/켓액티브/.test(c)&&(/머니마/.test(c)||/LO[}I1]/.test(c)||/GLO[}I1]/.test(c)))return 'KODEX 머니마켓액티브';
  if(/전력핵심인프라/.test(c))return 'KODEX 미국AI전력핵심인프라';
  s=s.replace(/^006[×xX]?/,'KODEX ').replace(/^K[0O]D[E3]X/i,'KODEX').replace(/^R[|I1]SE/i,'RISE').replace(/^A[C0]E/i,'ACE');
  return s.replace(/\s+/g,' ').trim().slice(0,60);
}
function isNoiseLine(line){return /종목명|평가손익|수익률|평가금액|매입단가|현재가|실시간|대출일별|매매구분|물타기|보유잔고|주식 잔고|메뉴|재가|주문|잔고|이체|지수|국내|해외|KRX|구분/.test(line)}
function parseBrokerOcr(text){
  const lines=String(text||'').split(/\r?\n/).map(cleanLine).filter(Boolean),rows=[];let buffer=[],pending=null;
  for(const line of lines){
    if(isNoiseLine(line)){if(!pending)buffer=[];continue}
    const tokens=numericTokens(line),hasPct=/%/.test(line);
    if(!pending&&!hasPct&&tokens.length>=3){
      const last=tokens.slice(-3),profit=last[0].value,qty=last[1].value,avg=last[2].value;
      const prefix=line.slice(0,last[0].index).trim(),name=normalizeFundName([...buffer,prefix].join(' '));
      if(name&&qty>=0&&qty<10000000&&Math.abs(profit)<10000000000&&avg>=0){pending={name,profit,qty,avg,rawName:[...buffer,prefix].join(' ')};buffer=[];continue}
    }
    if(pending&&(hasPct||/현금/.test(line))&&tokens.length>=2){
      const last=tokens.slice(-2),value=last[0].value,current=last[1].value,cost=value-pending.profit;
      if(value>=0&&current>=0&&cost>=0){
        const canonical=pending.name,recognized=/^(ACE|RISE|KODEX|TIGER|SOL|PLUS|HANARO|KIWOOM|TIMEFOLIO)\b/.test(canonical);
        rows.push({name:canonical,qty:pending.qty,value,profit:pending.profit,cost,current,avg:pending.avg,classId:guessClassRelease(canonical),confidence:recognized?96:82});
      }
      pending=null;buffer=[];continue;
    }
    if(!pending&&!hasPct&&!/현금/.test(line)&&tokens.length<3&&/[A-Za-z가-힣]/.test(line))buffer.push(line);
  }
  const unique=[];for(const r of rows){const k=`${r.name}|${r.value}`;if(!unique.some(x=>`${x.name}|${x.value}`===k))unique.push(r)}
  return unique;
}
function guessClassRelease(name){const n=String(name||'').toLowerCase();const find=id=>state.settings.assetClasses.find(c=>c.id===id)?.id;if(/배당|다우존스|dividend/.test(n))return find('dividend')||state.settings.assetClasses[0].id;if(/머니마켓|채권|국채|단기금리|mmf|cd금리/.test(n))return find('bond')||state.settings.assetClasses[0].id;if(/금|gold/.test(n))return find('gold')||state.settings.assetClasses[0].id;return find('growth')||state.settings.assetClasses[0].id}
function releaseClassOptions(selected){return state.settings.assetClasses.map(c=>`<option value="${esc(c.id)}" ${c.id===selected?'selected':''}>${esc(c.name)}</option>`).join('')}
function formatInput(n){return Number(n||0).toLocaleString('ko-KR')}
function readOcrRowsFromDom(){return [...document.querySelectorAll('.ocrRow')].map((el,i)=>{const value=parseMoney(el.querySelector('[data-o=value]').value),profit=parseMoney(el.querySelector('[data-o=profit]').value);return {line:i+1,name:el.querySelector('[data-o=name]').value.trim(),qty:parseMoney(el.querySelector('[data-o=qty]').value),value,profit,cost:value-profit,classId:el.querySelector('[data-o=class]').value}})}
function applyReleaseSnapshot(key,rows,total){
  const a=state.accounts[key],wasEmpty=!a.holdings.length&&!Number(a.principal);archiveMissingHoldings(key,rows,'snapshot-ocr-replaced');const old=Object.fromEntries(a.holdings.map(h=>[h.name,h])),sum=rows.reduce((s,r)=>s+r.value,0);
  a.holdings=rows.map(r=>{const prev=old[r.name]||{},cls=r.classId||prev.class||state.settings.assetClasses[0].id;return prepareHolding(key,{...prev,name:r.name,qty:r.qty,value:r.value,cost:r.cost,class:cls,dividend:prev.dividend||0,realized:prev.realized||0,risk:key==='irp'?(prev.risk??((state.settings.assetClasses.find(c=>c.id===cls)?.riskWeight||0)>=70)):undefined,riskSource:key==='irp'?(prev.riskSource||'estimated'):undefined},prev)});
  a.cash=Math.max(0,(total||sum)-sum);if(wasEmpty)a.principal=rows.reduce((s,r)=>s+r.cost,0)+a.cash;state.ui.accountView=key;state.lastUpdated=localDisplayDate(new Date());updateYearFromAssets();save();closeSheet('formSheet');renderAll();toast(`${a.name} ${rows.length}개 종목을 반영했어요`);
}
function setOcrProgress(p,label,message,error=false){const box=document.getElementById('ocrProgress');if(!box)return;box.classList.add('open');box.classList.toggle('ocrError',error);box.querySelector('i').style.width=`${clamp(p,0,100)}%`;box.querySelector('[data-progress-label]').textContent=label;box.querySelector('[data-progress-pct]').textContent=error?'확인 필요':`${Math.round(p)}%`;box.querySelector('.ocrMessage').textContent=message}
function updateOcrSummary(){
  const rows=readOcrRowsFromDom(),sum=rows.reduce((s,r)=>s+r.value,0),cost=rows.reduce((s,r)=>s+r.cost,0),profit=sum-cost,total=parseMoney(document.getElementById('ocrTotal')?.value)||sum,cash=total-sum,invalid=rows.filter(r=>!r.name||r.qty<0||r.value<0||r.cost<0);
  const box=document.getElementById('ocrSummary');if(box)box.innerHTML=`<div class="ocrSummaryRow"><span>인식 종목</span><b>${rows.length}개</b></div><div class="ocrSummaryRow"><span>평가금액 합계</span><b>${fmt(sum)}</b></div><div class="ocrSummaryRow"><span>계산 원금</span><b>${fmt(cost)}</b></div><div class="ocrSummaryRow"><span>평가손익</span><b class="${profit>=0?'good':'bad'}">${profit>=0?'+':''}${fmt(profit)}</b></div>${total!==sum?`<div class="ocrSummaryRow"><span>현금으로 반영</span><b class="${cash<0?'bad':''}">${fmt(cash)}</b></div>`:''}${invalid.length?`<div class="ocrSummaryRow"><span>확인 필요</span><b class="bad">${invalid.length}개</b></div>`:''}`;
  const btn=document.getElementById('ocrApply');if(btn){btn.disabled=!rows.length||invalid.length>0||cash<0;btn.textContent=rows.length?`검토한 ${rows.length}개 종목 반영`:'인식 후 반영'};
  document.querySelectorAll('.ocrRow').forEach(el=>{const value=parseMoney(el.querySelector('[data-o=value]').value),profit=parseMoney(el.querySelector('[data-o=profit]').value),cost=value-profit;el.querySelector('[data-o=cost]').textContent=cost>=0?fmt(cost):'손익 확인 필요'});
}
function renderOcrRows(rows){
  ocrRows=rows;const host=document.getElementById('ocrRows'),head=document.getElementById('ocrResultHead');if(!host)return;
  head.hidden=!rows.length;host.innerHTML=rows.map((r,i)=>`<div class="ocrRow" data-index="${i}"><div class="ocrRowTop"><span class="ocrRowNo">종목 ${i+1}</span><span class="ocrConfidence">${(r.confidence||0)>=90?'자동 인식':'이름 확인 권장'}</span><button class="ocrRemove" type="button" aria-label="종목 제외">×</button></div><input class="ocrName" data-o="name" value="${esc(r.name)}" aria-label="종목명"><div class="ocrNumbers"><div class="ocrMini"><label>수량</label><input data-o="qty" inputmode="decimal" value="${formatInput(r.qty)}"></div><div class="ocrMini"><label>평가금액</label><input data-o="value" inputmode="numeric" value="${formatInput(r.value)}"></div><div class="ocrMini"><label>평가손익</label><input data-o="profit" inputmode="decimal" value="${formatInput(r.profit)}"></div></div><div class="ocrRowBottom"><div class="ocrCalc">계산 원금<b data-o="cost">${fmt(r.cost)}</b></div><div class="ocrClass"><select data-o="class" aria-label="자산군">${releaseClassOptions(r.classId)}</select></div></div></div>`).join('');
  host.querySelectorAll('input,select').forEach(x=>x.addEventListener('input',updateOcrSummary));host.querySelectorAll('.ocrRemove').forEach(b=>b.onclick=()=>{b.closest('.ocrRow').remove();[...host.children].forEach((el,i)=>{el.querySelector('.ocrRowNo').textContent=`종목 ${i+1}`});updateOcrSummary()});updateOcrSummary();
}
function loadExternalScript(src,timeout=18000){return new Promise((resolve,reject)=>{const old=[...document.scripts].find(s=>s.src===src);if(old){old.addEventListener('load',resolve,{once:true});old.addEventListener('error',reject,{once:true});if(window.Tesseract)resolve();return}const s=document.createElement('script');s.src=src;s.async=true;s.crossOrigin='anonymous';const t=setTimeout(()=>{s.remove();reject(new Error('timeout'))},timeout);s.onload=()=>{clearTimeout(t);resolve()};s.onerror=()=>{clearTimeout(t);reject(new Error('load'))};document.head.appendChild(s)})}
async function ensureTesseract(){if(window.Tesseract)return window.Tesseract;const urls=['https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js','https://unpkg.com/tesseract.js@5.1.1/dist/tesseract.min.js'];let last;for(const u of urls){try{await loadExternalScript(u);if(window.Tesseract)return window.Tesseract}catch(e){last=e}}throw last||new Error('OCR engine unavailable')}
async function preprocessForOcr(file,crop=true){
  const bitmap=await createImageBitmap(file),sx=0,sy=crop?Math.round(bitmap.height*.27):0,sw=bitmap.width,sh=crop?Math.round(bitmap.height*.53):bitmap.height,targetW=Math.min(1800,Math.max(1200,sw*2)),targetH=Math.round(sh*targetW/sw),canvas=document.createElement('canvas');canvas.width=targetW;canvas.height=targetH;const ctx=canvas.getContext('2d',{willReadFrequently:true});ctx.fillStyle='#fff';ctx.fillRect(0,0,targetW,targetH);ctx.filter='grayscale(1) contrast(1.35) brightness(1.04)';ctx.drawImage(bitmap,sx,sy,sw,sh,0,0,targetW,targetH);bitmap.close?.();return canvas.toDataURL('image/png')
}
async function nativeTextDetect(file){if(!('TextDetector' in window))return '';try{const bitmap=await createImageBitmap(file),items=await new TextDetector().detect(bitmap);bitmap.close?.();return items.sort((a,b)=>(a.boundingBox?.y||0)-(b.boundingBox?.y||0)||(a.boundingBox?.x||0)-(b.boundingBox?.x||0)).map(x=>x.rawValue||'').join('\n')}catch(_){return ''}}
async function runPhotoOcr(file){
  setOcrProgress(4,'사진 준비','표 영역을 선명하게 변환하고 있어요.');
  try{
    let text=window.__PENSION_OCR_TEST_TEXT||await nativeTextDetect(file);
    if(text)setOcrProgress(42,'문자 인식','기기 문자 인식 결과를 정리하고 있어요.');
    if(!text){
      const T=await ensureTesseract();setOcrProgress(12,'OCR 준비','첫 사용 시 한글 인식 모듈을 내려받아 시간이 조금 걸릴 수 있어요.');const img=await preprocessForOcr(file,true);
      const worker=await T.createWorker('kor+eng',1,{logger:m=>{if(m.status==='recognizing text')setOcrProgress(20+(m.progress||0)*65,'사진 읽는 중',`종목명과 숫자를 찾고 있어요 · ${Math.round((m.progress||0)*100)}%`)},workerPath:'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/worker.min.js',corePath:'https://cdn.jsdelivr.net/npm/tesseract.js-core@5.1.1',langPath:'https://tessdata.projectnaptha.com/4.0.0_fast'});
      try{await worker.setParameters({tessedit_pageseg_mode:'4',preserve_interword_spaces:'1'});const result=await worker.recognize(img);text=result.data.text||''}finally{await worker.terminate()}
    }
    setOcrProgress(90,'결과 검증','평가손익·수량·평가금액의 위치를 맞추고 있어요.');let rows=parseBrokerOcr(text);
    if(!rows.length&&window.__PENSION_OCR_TEST_ROWS)rows=clone(window.__PENSION_OCR_TEST_ROWS);
    if(!rows.length)throw new Error('종목 행을 찾지 못했어요. 표가 모두 보이는 잔고 화면을 사용하세요.');
    renderOcrRows(rows);setOcrProgress(100,'자동 인식 완료',`${rows.length}개 종목을 찾았어요. 숫자만 한 번 확인한 뒤 반영하세요.`);document.getElementById('ocrTotal').value=formatInput(rows.reduce((s,r)=>s+r.value,0));updateOcrSummary();const sheet=document.querySelector('#formSheet .sheet'),target=document.getElementById('ocrResultHead');if(sheet&&target)sheet.scrollTo({top:Math.max(0,target.offsetTop-66),behavior:'smooth'});
  }catch(e){console.error(e);setOcrProgress(100,'사진을 읽지 못했어요',e.message||'인터넷 연결을 확인하고 다시 시도하세요.',true)}
}
function ensureOcrViewer(){
  let v=document.getElementById('ocrViewer');if(v)return v;v=document.createElement('div');v.id='ocrViewer';v.className='ocrViewer';v.innerHTML=`<div class="ocrViewerHead"><b>원본 사진 확인</b><div class="ocrViewerActions"><button data-view="minus">−</button><button data-view="plus">＋</button><button data-view="close">×</button></div></div><div class="ocrViewerBody"><img alt="잔고 원본"></div>`;document.body.appendChild(v);const img=v.querySelector('img');const paint=()=>{img.style.transform='none';img.style.width=`${100*ocrViewerScale}%`;img.style.maxWidth='none';img.style.margin=ocrViewerScale===1?'0 auto':'0'};v.querySelector('[data-view=minus]').onclick=()=>{ocrViewerScale=clamp(ocrViewerScale-.25,1,3);paint()};v.querySelector('[data-view=plus]').onclick=()=>{ocrViewerScale=clamp(ocrViewerScale+.25,1,3);paint()};v.querySelector('[data-view=close]').onclick=()=>{v.classList.remove('open');document.body.style.overflow='hidden'};v.addEventListener('click',e=>{if(e.target===v)v.querySelector('[data-view=close]').click()});return v
}
function openOcrViewer(){if(!ocrObjectUrl)return;const v=ensureOcrViewer();ocrViewerScale=1;v.querySelector('img').src=ocrObjectUrl;v.querySelector('img').style.transform='none';v.querySelector('img').style.width='100%';v.querySelector('img').style.margin='0 auto';v.classList.add('open');v.querySelector('.ocrViewerBody').scrollTo(0,0)}

renderSnapshotForm=function(title,body){
  title.textContent='사진으로 자산 읽기';body.innerHTML=`<div class="ocrIntro"><i>✓</i><div><b>사진을 선택하면 종목과 숫자를 자동으로 읽습니다.</b><br>자동 인식 결과는 바로 저장하지 않고, 확인 화면을 거친 뒤에만 반영해요.</div></div><div class="field"><label>반영할 계좌</label><select id="ocrAccount"><option value="pension">연금저축</option><option value="irp">IRP</option></select></div><input id="ocrFile" type="file" accept="image/*" hidden><div class="ocrUpload" id="ocrUpload" role="button" tabindex="0"><div id="ocrEmpty"><strong>잔고 화면 사진 선택</strong><span>증권사 보유 종목 표가 모두 보이는 캡처</span></div><div class="ocrPhotoLine" id="ocrPhotoLine" hidden><img class="ocrThumb" id="ocrThumb" alt="선택한 잔고 사진"><div class="ocrPhotoMeta"><b id="ocrFileName"></b><small>사진은 인식 중에만 사용하며 앱 데이터에 저장하지 않아요.</small></div><button class="ocrPhotoAction" id="ocrView" type="button">원본 보기</button></div></div><div class="ocrProgress" id="ocrProgress"><div class="ocrProgressTop"><b data-progress-label>준비</b><span data-progress-pct>0%</span></div><div class="ocrTrack"><i></i></div><div class="ocrMessage"></div></div><div class="ocrResultHead" id="ocrResultHead" hidden><h3>자동 인식 결과</h3><span>틀린 칸만 고치면 됩니다</span></div><div class="ocrRows" id="ocrRows"></div><div class="field"><label>계좌 총액 · 선택</label><input id="ocrTotal" inputmode="numeric" placeholder="종목 합계를 자동 사용"><div class="inputHelp">예수금이 있으면 계좌 전체 총액을 입력하세요. 차이는 현금으로 반영합니다.</div></div><div class="ocrSummary" id="ocrSummary"><div class="ocrSummaryRow"><span>인식 종목</span><b>0개</b></div></div><button class="btn primary full ocrApply" id="ocrApply" disabled>인식 후 반영</button><details class="ocrManual"><summary>자동 인식이 안 될 때 텍스트로 붙여넣기</summary><textarea id="ocrManualText" placeholder="종목명 | 수량 | 평가금액 | 원금 | 자산군"></textarea><button class="btn full" id="ocrManualParse" type="button">붙여넣은 내용 확인</button></details>`;
  const fileInput=document.getElementById('ocrFile'),upload=document.getElementById('ocrUpload');upload.onclick=e=>{if(e.target.closest('#ocrView'))return;fileInput.click()};upload.onkeydown=e=>{if((e.key==='Enter'||e.key===' ')&&!e.target.closest('#ocrView')){e.preventDefault();fileInput.click()}};document.getElementById('ocrView').onclick=e=>{e.stopPropagation();openOcrViewer()};
  fileInput.onchange=async e=>{const file=e.target.files?.[0];if(!file)return;ocrFile=file;if(ocrObjectUrl)URL.revokeObjectURL(ocrObjectUrl);ocrObjectUrl=URL.createObjectURL(file);upload.classList.add('has-photo');document.getElementById('ocrEmpty').hidden=true;document.getElementById('ocrPhotoLine').hidden=false;document.getElementById('ocrThumb').src=ocrObjectUrl;document.getElementById('ocrFileName').textContent=file.name||'잔고 화면';renderOcrRows([]);await runPhotoOcr(file)};
  document.getElementById('ocrTotal').addEventListener('input',updateOcrSummary);
  document.getElementById('ocrManualParse').onclick=()=>{const rows=parseHoldingText(document.getElementById('ocrManualText').value).map(r=>({name:r.name,qty:r.qty,value:r.value,cost:r.cost,profit:r.value-r.cost,classId:state.settings.assetClasses.find(c=>c.name===r.className||c.id===r.className)?.id||guessClassRelease(r.name),confidence:100}));if(!rows.length)return toast('붙여넣은 종목을 찾지 못했어요');renderOcrRows(rows);document.getElementById('ocrTotal').value=formatInput(rows.reduce((s,r)=>s+r.value,0));updateOcrSummary()};
  document.getElementById('ocrApply').onclick=()=>{const rows=readOcrRowsFromDom(),names=rows.map(r=>r.name),duplicate=names.find((n,i)=>names.indexOf(n)!==i),invalid=rows.find(r=>!r.name||!Number.isFinite(r.qty)||!Number.isFinite(r.value)||!Number.isFinite(r.cost)||r.qty<0||r.value<0||r.cost<0);if(!rows.length)return toast('사진에서 종목을 먼저 읽으세요');if(duplicate)return toast(`중복 종목을 확인하세요: ${duplicate}`);if(invalid)return toast(`${invalid.line}번째 종목을 확인하세요`);const sum=rows.reduce((s,r)=>s+r.value,0),total=parseMoney(document.getElementById('ocrTotal').value)||sum;if(total<sum)return toast('계좌 총액이 종목 평가금 합계보다 작아요');applyReleaseSnapshot(document.getElementById('ocrAccount').value,rows,total)};
};

/* Clean up temporary image every time the form closes. */
const oldCloseRelease=closeSheet;
closeSheet=function(id,fromPop=false){oldCloseRelease(id,fromPop);if(id==='formSheet'&&ocrObjectUrl){URL.revokeObjectURL(ocrObjectUrl);ocrObjectUrl=null;ocrFile=null;document.getElementById('ocrViewer')?.classList.remove('open')}};

/* Stronger but still deterministic smart analysis; engine can be replaced later. */
const previousEngine=window.PensionAnalysisEngine;
window.PensionAnalysisEngine={version:'rules-0.2',run(){const base=previousEngine?.run?.()||{},rows=Object.values(state.years||{}),rets=rows.map(r=>Number(r.return)||0),mean=rets.length?rets.reduce((s,n)=>s+n,0)/rets.length:0,variance=rets.length?rets.reduce((s,n)=>s+(n-mean)**2,0)/rets.length:0,vol=Math.sqrt(variance),drawdown=rets.length?Math.min(...rets):0,monthly=Number(state.settings.monthly.pension)+Number(state.settings.monthly.irp),years=Math.max(0,state.profile.retirementAge-state.profile.age),allHoldings=Object.values(state.accounts||{}).flatMap(a=>a.holdings||[]),allTotal=Object.values(state.accounts||{}).reduce((sum,a)=>sum+(Number(a.cash)||0)+(a.holdings||[]).reduce((x,h)=>x+(Number(h.value)||0),0),0),topPct=allTotal&&allHoldings.length?Math.max(...allHoldings.map(h=>Number(h.value)||0))/allTotal*100:0,score=clamp((base.score||70)-(vol>12?5:0)-(drawdown<-15?5:0)+(monthly>0?3:0),0,100);return {...base,score,diagnostics:{volatility:vol,worstYear:drawdown,monthly,years,topPct}}}};

window.PensionOCRV2={
  version:'parser-1.0',
  parseText:text=>parseBrokerOcr(text),
  normalizeName:value=>normalizeFundName(value),
  privacyState:()=>({hasObjectUrl:!!ocrObjectUrl,hasFileReference:!!ocrFile,storedAudit:window.PensionV12?.privacyAudit?.(state)||{ok:true,issues:[]}}),
  parserAudit(){
    const valid=parseBrokerOcr('ACE 글로벌반도체TOP4 Plus 100,000 12 25,000\n현금 420,000 35,000');
    const blank=parseBrokerOcr('');
    const invalid=parseBrokerOcr('오독 종목 900,000 2 100,000\n현금 100,000 50,000');
    return {ok:valid.length===1&&valid[0].name==='ACE 글로벌반도체TOP4 Plus'&&valid[0].qty===12&&valid[0].value===420000&&valid[0].cost===320000&&blank.length===0&&invalid.length===0,valid,blankCount:blank.length,invalidCount:invalid.length};
  }
};

/* Version copy and final rerender. */
const oldRenderSettingsRelease=renderSettings;
renderSettings=function(){oldRenderSettingsRelease();const n=document.querySelector('#settingsBody .sheetNotice');if(n)n.textContent=`저장 버튼을 눌러야 반영됩니다. 앱 ${RELEASE_VERSION}`};
renderAll(true);save();releaseShowFab();
})();

