/* 개인연금 V2.0 RC6 - 앱 시작·탐색 */
'use strict';
(function(){
const screens=['home','account','analysis','future'];
function applyScreen(screen,{replaceHistory=false,history=true,persist=true}={}){
  const next=screens.includes(screen)?screen:'home';
  state.ui.screen=next;
  document.querySelectorAll('.screen').forEach(el=>el.classList.toggle('active',el.id===next));
  const buttons=[...document.querySelectorAll('.nav button')];
  buttons.forEach(b=>b.classList.toggle('active',b.dataset.screen===next));
  const index=Math.max(0,buttons.findIndex(b=>b.dataset.screen===next));
  document.getElementById('navMark')?.style.setProperty('left',`calc(${(index+.5)*25}% - 19px)`);
  document.body.dataset.screen=next;
  document.getElementById('fab')?.classList.toggle('hidden',next==='future'||next==='analysis');
  if(history){const url=new URL(location.href);url.hash=next==='home'?'':next;try{window.history[replaceHistory?'replaceState':'pushState']({screen:next},'',url)}catch{}}
  if(persist)saveState({quiet:true});window.scrollTo({top:0,behavior:'auto'});
}
function navigate(screen,accountKey){
  if(accountKey&&['pension','irp'].includes(accountKey))state.ui.accountView=accountKey;
  renderAll(true);applyScreen(screen);
}
function closeAllSheets(){document.querySelectorAll('.overlay.open').forEach(x=>closeSheet(x.id));PensionOCR?.cleanup?.()}
function bindShell(){
  document.querySelectorAll('.nav button').forEach(button=>button.addEventListener('click',()=>navigate(button.dataset.screen)));
  document.getElementById('fab').addEventListener('click',()=>openSheet('quickSheet'));
  document.getElementById('settingsBtn').addEventListener('click',()=>openSettings());
  document.querySelectorAll('[data-close]').forEach(button=>button.addEventListener('click',()=>closeSheet(button.dataset.close)));
  document.querySelectorAll('.overlay').forEach(overlay=>overlay.addEventListener('click',e=>{if(e.target===overlay)closeSheet(overlay.id)}));
  document.querySelectorAll('[data-quick]').forEach(button=>button.addEventListener('click',()=>openForm(button.dataset.quick)));
  window.addEventListener('popstate',e=>{const target=e.state?.screen||location.hash.slice(1)||'home';state.ui.screen=target;renderAll(true);applyScreen(target,{history:false,persist:false})});
  document.addEventListener('pension:state-saved',()=>{const sub=document.getElementById('headerSub');if(sub)sub.textContent=`${state.profile.age}세 · ${state.profile.retirementAge}세 연금 개시 계획`});
  document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='hidden')saveState({quiet:true})});
}
async function boot(){
  bindShell();
  try{await PensionStorage?.hydrate?.()}catch(e){console.warn('보조 저장소를 불러오지 못했습니다.',e)}
  renderAll(true);
  applyScreen(location.hash.slice(1)||state.ui.screen||'home',{replaceHistory:true});
  if('serviceWorker'in navigator&&/^https?:$/.test(location.protocol))navigator.serviceWorker.register('./sw.js').catch(e=>console.warn('오프라인 준비 실패',e));
  document.documentElement.classList.add('ready');
}
window.navigate=navigate;window.applyScreen=applyScreen;window.closeAllSheets=closeAllSheets;
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot,{once:true});else boot();
})();
