/* 개인연금 V2.5 차트 엔진 · 스플라인/스크러버/막대 선택 공통 모듈 */
(()=>{
'use strict';
const N=v=>Number.isFinite(Number(v))?Number(v):0;
const clampValue=(v,min,max)=>Math.min(max,Math.max(min,v));
const lerp=(a,b,t)=>a+(b-a)*t;

function compactMoney(v){
  const n=N(v),a=Math.abs(n),sign=n<0?'-':'';
  const unit=(x,suffix)=>`${sign}${Number.isInteger(x)?x.toFixed(0):x.toFixed(x>=10?1:2).replace(/0+$/,'').replace(/\.$/,'')}${suffix}`;
  if(a>=1e12)return unit(a/1e12,'조');
  if(a>=1e8)return unit(a/1e8,'억');
  if(a>=1e4)return unit(a/1e4,'만');
  return `${Math.round(n).toLocaleString('ko-KR')}`;
}
function niceStep(raw){
  if(!Number.isFinite(raw)||raw<=0)return 1;
  const power=10**Math.floor(Math.log10(raw)),fraction=raw/power;
  return (fraction<=1?1:fraction<=2?2:fraction<=2.5?2.5:fraction<=5?5:10)*power;
}
function axisScale(values,tickCount=4,includeZero=true){
  const finite=values.map(N).filter(Number.isFinite),rawMin=Math.min(...finite,0),rawMax=Math.max(...finite,1);
  let min=includeZero?Math.min(0,rawMin):rawMin,max=includeZero?Math.max(0,rawMax):rawMax;
  const step=niceStep((max-min)/tickCount||1);
  min=Math.floor(min/step)*step;max=Math.ceil(max/step)*step;if(max===min)max=min+step;
  const ticks=[];for(let v=min,i=0;i<=tickCount;i++,v=min+step*i)ticks.push(v);
  if(ticks.at(-1)<max-step*.1)ticks.push(max);
  return {min,max,step,ticks};
}
function linePath(points){return points.map((p,i)=>`${i?'L':'M'} ${p.x.toFixed(2)} ${p.y.toFixed(2)}`).join(' ')}

/* Fritsch-Carlson monotone cubic spline: smooth without overshooting between data points. */
function smoothPath(points){
  const pts=(points||[]).filter(p=>Number.isFinite(p?.x)&&Number.isFinite(p?.y));
  const n=pts.length;if(n<3)return linePath(pts);
  const h=[],delta=[],m=new Array(n).fill(0);
  for(let i=0;i<n-1;i++){h[i]=Math.max(.0001,pts[i+1].x-pts[i].x);delta[i]=(pts[i+1].y-pts[i].y)/h[i]}
  m[0]=delta[0];m[n-1]=delta[n-2];
  for(let i=1;i<n-1;i++){
    if(delta[i-1]===0||delta[i]===0||delta[i-1]*delta[i]<=0){m[i]=0;continue}
    const w1=2*h[i]+h[i-1],w2=h[i]+2*h[i-1];
    m[i]=(w1+w2)/(w1/delta[i-1]+w2/delta[i]);
  }
  let d=`M ${pts[0].x.toFixed(2)} ${pts[0].y.toFixed(2)}`;
  for(let i=0;i<n-1;i++){
    const dx=h[i],p1=pts[i],p2=pts[i+1];
    const c1x=p1.x+dx/3,c1y=p1.y+m[i]*dx/3,c2x=p2.x-dx/3,c2y=p2.y-m[i+1]*dx/3;
    d+=` C ${c1x.toFixed(2)} ${c1y.toFixed(2)}, ${c2x.toFixed(2)} ${c2y.toFixed(2)}, ${p2.x.toFixed(2)} ${p2.y.toFixed(2)}`;
  }
  return d;
}
function areaToFloor(points,floor){
  if(!points?.length)return '';
  return `${smoothPath(points)} L ${points.at(-1).x.toFixed(2)} ${Number(floor).toFixed(2)} L ${points[0].x.toFixed(2)} ${Number(floor).toFixed(2)} Z`;
}
function areaBetween(top,bottom){
  if(!top?.length||!bottom?.length)return '';
  const reverse=[...bottom].reverse(),lower=smoothPath(reverse).replace(/^M\s+/,'L ');
  return `${smoothPath(top)} ${lower} Z`;
}
function interpolatePoint(points,raw){
  const max=Math.max(0,(points?.length||1)-1),value=clampValue(N(raw),0,max),lo=Math.floor(value),hi=Math.min(max,Math.ceil(value)),t=value-lo,a=points?.[lo]||points?.[0]||{},b=points?.[hi]||a,out={};
  for(const key of Object.keys(a))out[key]=typeof a[key]==='number'?lerp(a[key],b[key],t):a[key];
  return out;
}
function interpolateX(points,raw){return N(interpolatePoint(points,raw).x)}

const samplerCache=new WeakMap();
function samplerFor(path){
  if(!path||typeof path.getTotalLength!=='function'||typeof path.getPointAtLength!=='function')return null;
  const cached=samplerCache.get(path);if(cached)return cached;
  let total=0;try{total=path.getTotalLength()}catch(_){return null}
  if(!Number.isFinite(total)||total<=0)return null;
  const count=Math.max(180,Math.min(900,Math.ceil(total*1.4))),samples=[];
  for(let i=0;i<=count;i++){const p=path.getPointAtLength(total*i/count);samples.push({x:p.x,y:p.y})}
  const sample=x=>{
    let lo=0,hi=samples.length-1;
    if(x<=samples[0].x)return samples[0].y;if(x>=samples[hi].x)return samples[hi].y;
    while(hi-lo>1){const mid=(lo+hi)>>1;if(samples[mid].x<x)lo=mid;else hi=mid}
    const a=samples[lo],b=samples[hi],span=Math.max(.0001,b.x-a.x),t=clampValue((x-a.x)/span,0,1);return lerp(a.y,b.y,t);
  };
  samplerCache.set(path,sample);return sample;
}
function samplePathY(pathId,x,fallback=0){
  const path=document.getElementById(pathId),sample=samplerFor(path);return sample?sample(x):N(fallback);
}

/* Frame-synchronised scrubber.
   Samsung/Android browsers can deliver touch samples unevenly. The marker therefore follows
   a time-based low-pass target instead of jumping directly between sparse pointer events. */
function bindSmoothScrubber(hitId,count,{position,index,commit,initialRaw}={}){
  const hit=document.getElementById(hitId);if(!hit||count<1)return ()=>{};
  const max=Math.max(0,count-1);
  let display=clampValue(Number.isFinite(Number(initialRaw))?N(initialRaw):max,0,max),target=display;
  let pointerId=null,startX=0,startY=0,horizontal=false,active=false,raf=0,lastIndex=-1,lastNow=0,destroyed=false,commitIndex=null;
  const rawFromClientX=x=>{const r=hit.getBoundingClientRect(),pct=clampValue((x-r.left)/Math.max(1,r.width),0,1);return pct*max};
  const latestX=e=>{const list=typeof e.getCoalescedEvents==='function'?e.getCoalescedEvents():null;return list?.length?list.at(-1).clientX:e.clientX};
  const draw=raw=>{display=clampValue(raw,0,max);position?.(display);const i=Math.round(display);if(i!==lastIndex){lastIndex=i;index?.(i)}};
  const ensureFrame=()=>{if(!raf)raf=requestAnimationFrame(frame)};
  const frame=now=>{
    raf=0;if(destroyed)return;
    const dt=lastNow?Math.min(34,Math.max(8,now-lastNow)):16;lastNow=now;
    const distance=target-display;
    /* 38 ms response while dragging, 58 ms while softly settling. */
    const tau=active?26:54,alpha=1-Math.exp(-dt/tau);
    display=Math.abs(distance)<.0008?target:display+distance*alpha;
    draw(display);
    if(Math.abs(target-display)>.0008||active){ensureFrame();return}
    draw(target);
    if(commitIndex!==null){const value=commitIndex;commitIndex=null;commit?.(value)}
  };
  const setTarget=raw=>{target=clampValue(raw,0,max);ensureFrame()};
  const cancelFrame=()=>{if(raf)cancelAnimationFrame(raf);raf=0;lastNow=0};
  const releaseCapture=e=>{try{hit.releasePointerCapture(e.pointerId)}catch(_){}};
  const move=e=>{
    if(pointerId!==e.pointerId)return;
    const x=latestX(e),dx=Math.abs(x-startX),dy=Math.abs(e.clientY-startY);
    if(!horizontal&&Math.max(dx,dy)>5){
      if(dy>dx*1.08){pointerId=null;active=false;releaseCapture(e);return}
      horizontal=true;active=true;document.body.classList.add('charting');
      /* Start exactly under the finger. Do not travel across the whole chart from the previous selection. */
      const raw=rawFromClientX(x);display=target=raw;lastNow=0;draw(raw);
    }
    if(horizontal){if(e.cancelable)e.preventDefault();setTarget(rawFromClientX(x))}
  };
  draw(display);
  hit.onpointerdown=e=>{
    cancelFrame();pointerId=e.pointerId;startX=e.clientX;startY=e.clientY;horizontal=false;active=false;commitIndex=null;
    const raw=rawFromClientX(e.clientX);display=target=raw;draw(raw);
    try{hit.setPointerCapture(e.pointerId)}catch(_){}
  };
  hit.onpointermove=move;
  /* Higher-frequency samples when the browser exposes them. */
  hit.onpointerrawupdate=e=>{if(horizontal)move(e)};
  hit.onpointerup=e=>{
    if(pointerId!==e.pointerId)return;
    const raw=rawFromClientX(latestX(e));pointerId=null;active=false;horizontal=false;document.body.classList.remove('charting');
    target=Math.round(raw);commitIndex=target;ensureFrame();releaseCapture(e)
  };
  hit.onpointercancel=e=>{
    if(pointerId!==e.pointerId)return;pointerId=null;active=false;horizontal=false;commitIndex=null;target=display;document.body.classList.remove('charting');releaseCapture(e)
  };
  return ()=>{destroyed=true;cancelFrame();document.body.classList.remove('charting');hit.onpointerdown=hit.onpointermove=hit.onpointerrawupdate=hit.onpointerup=hit.onpointercancel=null};
}

/* Cash-flow bars are independent tap targets. Zero-value slots have no target and cannot be
   selected accidentally; dragging remains page scrolling and never sweeps across bars. */
function bindDiscreteBarTargets(selector,{select,commit,initialIndex}={}){
  const targets=[...document.querySelectorAll(selector)];if(!targets.length)return ()=>{};
  let current=Number.isFinite(Number(initialIndex))?Math.round(N(initialIndex)):-1;
  select?.(current);
  const cleanups=[];
  for(const target of targets){
    let pointerId=null,startX=0,startY=0,moved=false;
    const index=Number(target.dataset.barHitIndex);
    const down=e=>{pointerId=e.pointerId;startX=e.clientX;startY=e.clientY;moved=false;try{target.setPointerCapture(e.pointerId)}catch(_){}};
    const move=e=>{if(pointerId===e.pointerId&&Math.hypot(e.clientX-startX,e.clientY-startY)>8)moved=true};
    const up=e=>{if(pointerId!==e.pointerId)return;if(!moved&&Number.isFinite(index)){current=index;select?.(index);commit?.(index)}pointerId=null;try{target.releasePointerCapture(e.pointerId)}catch(_){}};
    const cancel=e=>{if(pointerId===e.pointerId)pointerId=null};
    target.addEventListener('pointerdown',down);target.addEventListener('pointermove',move);target.addEventListener('pointerup',up);target.addEventListener('pointercancel',cancel);
    cleanups.push(()=>{target.removeEventListener('pointerdown',down);target.removeEventListener('pointermove',move);target.removeEventListener('pointerup',up);target.removeEventListener('pointercancel',cancel)})
  }
  return ()=>cleanups.forEach(fn=>fn());
}

window.PensionCharts={compactMoney,axisScale,linePath,smoothPath,areaToFloor,areaBetween,interpolatePoint,interpolateX,samplePathY,bindSmoothScrubber,bindDiscreteBarTargets,lerp};
})();
