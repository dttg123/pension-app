/* ===== js/20-v0-final.js ===== */
(()=>{
'use strict';
const V0_VERSION='0.0.0';

function ensurePhotoViewer(){
 if(document.getElementById('photoViewer'))return;
 const v=document.createElement('div');v.id='photoViewer';v.className='photoViewer';v.innerHTML=`<div class="photoViewerHead"><b>잔고 화면 확인</b><div class="photoViewerActions"><button data-pv="minus" aria-label="축소">−</button><button data-pv="plus" aria-label="확대">＋</button><button data-pv="rotate" aria-label="회전">↻</button><button data-pv="close" aria-label="닫기">×</button></div></div><div class="photoViewerBody"><img id="photoViewerImg" alt="확대한 잔고 화면"></div>`;document.body.appendChild(v);
 let scale=1,rotation=0;const img=v.querySelector('img'),body=v.querySelector('.photoViewerBody');
 const paint=()=>{img.style.transform=`scale(${scale}) rotate(${rotation}deg)`;img.style.marginBottom=rotation%180?`${Math.max(0,img.clientWidth-img.clientHeight)}px`:'0'};
 v.querySelector('[data-pv=plus]').onclick=()=>{scale=clamp(scale+.25,1,3);paint()};
 v.querySelector('[data-pv=minus]').onclick=()=>{scale=clamp(scale-.25,1,3);paint()};
 v.querySelector('[data-pv=rotate]').onclick=()=>{rotation=(rotation+90)%360;paint()};
 v.querySelector('[data-pv=close]').onclick=()=>{v.classList.remove('open');window.syncModalState?.()};
 v.addEventListener('click',e=>{if(e.target===v) v.querySelector('[data-pv=close]').click()});
 window.openPhotoViewer=src=>{if(!src)return;scale=1;rotation=0;img.src=src;paint();v.classList.add('open');window.syncModalState?.();body.scrollTo(0,0)};
}
ensurePhotoViewer();

const previousQuickForm=quickForm;
quickForm=function(type){if(type==='history'){document.getElementById('quickSheet').classList.remove('open');const title=document.getElementById('formTitle'),body=document.getElementById('formBody');renderHistoryForm(title,body);openSheet('formSheet',true);return}previousQuickForm(type)};
document.querySelectorAll('[data-quick]').forEach(b=>b.onclick=()=>quickForm(b.dataset.quick));

function parseHistory(text){
 const out=[],errors=[];
 String(text||'').split(/\n+/).forEach((raw,idx)=>{const line=raw.trim();if(!line)return;const p=line.split(/\s*[|\t]\s*/);if(p.length<3){errors.push(idx+1);return}const year=Number(String(p[0]).replace(/[^0-9]/g,'')),end=parseMoney(p[1]),cumulative=parseMoney(p[2]),dividend=parseMoney(p[3]||0);if(year<1990||year>2100||end<0||cumulative<0){errors.push(idx+1);return}out.push({year,end,cumulative,dividend})});
 out.sort((a,b)=>a.year-b.year);return {rows:out,errors};
}
function renderHistoryForm(title,body){
 title.textContent='과거 연도 요약';
 const latest=Object.keys(state.years||{}).map(Number).sort((a,b)=>a-b).slice(-10).map(y=>{const r=state.years[y];return `${y} | ${Math.round(r.end).toLocaleString('ko-KR')} | ${Math.round(r.cumulative).toLocaleString('ko-KR')} | ${Math.round(r.dividend||0).toLocaleString('ko-KR')}`}).join('\n');
 body.innerHTML=`<div class="sheetNotice">처음 시작할 때 과거 10년을 연도별 요약으로 넣어요. 월별 자료를 억지로 다시 입력하지 않아도 장기 흐름을 볼 수 있습니다.</div><div class="field"><label>연도 | 연말 총자산 | 누적 순납입 | 연간 배당</label><textarea id="historyText" rows="10" placeholder="2020 | 17,200,000 | 14,400,000 | 190,000">${esc(latest)}</textarea><div class="historyExample">한 줄에 한 해만 입력 · 세로줄(|) 또는 탭 지원 · 연간 배당은 비워도 됨</div></div><div class="settingsInfo historyPreview" id="historyPreview"></div><button class="btn primary full" id="applyHistory" style="margin-top:14px">확인한 10년 반영</button>`;
 const update=()=>{const d=parseHistory(document.getElementById('historyText').value),dup=d.rows.filter((r,i,a)=>a.findIndex(x=>x.year===r.year)!==i);document.getElementById('historyPreview').innerHTML=`<b>${d.rows.length}개 연도 인식</b><div class="previewList"><div class="previewItem"><span>범위</span><b>${d.rows.length?`${d.rows[0].year}~${d.rows.at(-1).year}`:'-'}</b></div><div class="previewItem"><span>마지막 총자산</span><b>${d.rows.length?fmt(d.rows.at(-1).end):'-'}</b></div>${d.errors.length?`<div class="previewItem"><span>확인할 줄</span><b class="bad">${d.errors.join(', ')}</b></div>`:''}${dup.length?`<div class="previewItem"><span>중복 연도</span><b class="bad">${dup[0].year}</b></div>`:''}</div>`};
 document.getElementById('historyText').addEventListener('input',update);update();
 document.getElementById('applyHistory').onclick=()=>{const d=parseHistory(document.getElementById('historyText').value);if(!d.rows.length)return toast('과거 연도 자료를 입력하세요');if(d.errors.length)return toast(`${d.errors[0]}번째 줄을 확인하세요`);if(new Set(d.rows.map(r=>r.year)).size!==d.rows.length)return toast('중복 연도를 정리하세요');let prevEnd=0,prevCum=0;for(const r of d.rows){const contribution=Math.max(0,r.cumulative-prevCum),operating=r.end-prevEnd-contribution,base=prevEnd+contribution/2;state.years[r.year]={start:prevEnd,end:r.end,cumulative:r.cumulative,contribution,operating,realized:0,return:base?operating/base*100:0,dividend:r.dividend,reinvested:0,monthly:Array(12).fill(0)};prevEnd=r.end;prevCum=r.cumulative}const cur=state.years[CURRENT_YEAR];if(cur){cur.end=totalAsset();cur.cumulative=totalPrincipal();cur.operating=cur.end-cur.start-cur.contribution;const base=cur.start+cur.contribution/2;cur.return=base?cur.operating/base*100:0}state.ui.performanceIndex=Object.keys(state.years).length-1;save();closeSheet('formSheet');renderAll();toast(`${d.rows.length}년 기록을 반영했어요`)};
}

const oldSnapshotV0=renderSnapshotForm;
renderSnapshotForm=function(title,body){
 oldSnapshotV0(title,body);
 const preview=document.getElementById('photoPreview'),img=document.getElementById('photoImg'),file=document.getElementById('photoFile'),rows=document.getElementById('photoRows'),summary=document.getElementById('photoSummary'),add=document.getElementById('addPhotoRow'),apply=document.getElementById('applyPhoto');
 if(!preview||!img)return;
 const commit=document.createElement('div');commit.className='photoCommit';summary.before(commit);commit.append(summary,apply);
 preview.onclick=()=>openPhotoViewer(img.src);
 const tools=document.createElement('div');tools.className='photoTools';tools.innerHTML=`<button type="button" class="btn light" id="photoOpenFull">사진 크게 보기</button><button type="button" class="btn" id="photoReplace">다른 사진</button>`;preview.after(tools);tools.hidden=true;
 const float=document.createElement('div');float.className='photoFloat';float.innerHTML='<button type="button">사진 다시 보기</button>';summary.before(float);
 tools.querySelector('#photoOpenFull').onclick=()=>openPhotoViewer(img.src);tools.querySelector('#photoReplace').onclick=()=>file.click();float.querySelector('button').onclick=()=>openPhotoViewer(img.src);
 file.addEventListener('change',()=>setTimeout(()=>{if(img.src){tools.hidden=false;float.classList.add('show');openPhotoViewer(img.src)}},80));
 const decorate=()=>{[...rows.querySelectorAll('.photoRow')].forEach(r=>{const name=r.querySelector('[data-f=name]')?.value.trim(),value=parseMoney(r.querySelector('[data-f=value]')?.value),profit=parseMoney(r.querySelector('[data-f=profit]')?.value);r.classList.toggle('is-complete',Boolean(name&&value>=0&&value-profit>=0))})};
 rows.addEventListener('input',decorate);rows.addEventListener('keydown',e=>{if(e.key==='Enter'&&e.target.matches('[data-f=profit]')){e.preventDefault();add.click();setTimeout(()=>rows.lastElementChild?.querySelector('[data-f=name]')?.focus(),30)}});add.addEventListener('click',()=>setTimeout(()=>{decorate();rows.lastElementChild?.querySelector('[data-f=name]')?.focus()},30));decorate();
};

const oldHomeV0=renderHome;
renderHome=function(){oldHomeV0();const home=document.getElementById('home'),stack=home?.querySelector('.stack');if(!stack)return;const badge=document.createElement('span');badge.className='v0Badge';badge.textContent='V0.0';const hero=home.querySelector('.heroTop');if(hero&&!hero.querySelector('.v0Badge'))hero.appendChild(badge);if(totalAsset()===0&&!home.querySelector('.firstStart')){const c=document.createElement('section');c.className='card firstStart';c.innerHTML=`<div class="eyebrow">처음 시작하기</div><div class="sectionTitle" style="margin:5px 0 0">세 단계면 충분해요</div><div class="firstStartSteps"><button class="firstStartStep" data-start="snapshot"><i>1</i><div><b>현재 연금자산 입력</b><span>사진 자동 인식 또는 텍스트 붙여넣기</span></div></button><button class="firstStartStep" data-start="history"><i>2</i><div><b>과거 연도 요약</b><span>원할 때만 장기 흐름 추가</span></div></button><button class="firstStartStep" data-start="settings"><i>3</i><div><b>목표와 납입액 설정</b><span>나이·월 납입·목표 월연금</span></div></button></div>`;stack.prepend(c);c.querySelector('[data-start=snapshot]').onclick=()=>quickForm('snapshot');c.querySelector('[data-start=history]').onclick=()=>quickForm('history');c.querySelector('[data-start=settings]').onclick=()=>{renderSettings();openSheet('settingsSheet')}}};

const oldPerfV0=renderPerformance;
renderPerformance=function(el){oldPerfV0(el);const years=Object.keys(state.years||{}).map(Number).sort((a,b)=>a-b);if(years.length<=3)return;const d=document.createElement('details');d.className='card compact historyDetails';d.innerHTML=`<summary>${years.length}년 전체 연도</summary><table class="table"><thead><tr><th>연도</th><th>총자산</th><th>누적납입</th><th>수익률</th></tr></thead><tbody>${years.slice().reverse().map(y=>{const r=state.years[y];return `<tr><td>${y}</td><td>${man(r.end)}</td><td>${man(r.cumulative)}</td><td class="${r.return>=0?'good':'bad'}">${pct(r.return)}</td></tr>`}).join('')}</tbody></table>`;el.querySelector('.stack')?.appendChild(d)};

// Update version copy and keep photo itself out of saved state.
const oldSettingsV0=renderSettings;
renderSettings=function(){oldSettingsV0();const n=document.querySelector('#settingsBody .sheetNotice');if(n)n.textContent=`입력값은 저장 버튼을 눌러야 반영돼요. 앱 버전 ${V0_VERSION}`};
state.meta=state.meta||{};state.meta.appVersion=V0_VERSION;renderAll(true);
})();


