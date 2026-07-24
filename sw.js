/* 개인연금 V2.0 RC6 - 오프라인 캐시 */
'use strict';
const CACHE='pension-v2-rc6-20260724';
const ASSETS=['./','./index.html','./base.css','./app.css','./state.js','./engine.js','./ledger.js','./coach.js','./views.js','./forms.js','./ocr.js','./backup.js','./integrity.js','./app.js','./manifest.webmanifest','./icon.svg'];
self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(ASSETS)).then(()=>self.skipWaiting())));
self.addEventListener('activate',event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key!==CACHE).map(key=>caches.delete(key)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',event=>{
  if(event.request.method!=='GET')return;
  event.respondWith(caches.match(event.request).then(cached=>cached||fetch(event.request).then(response=>{if(response&&response.ok&&new URL(event.request.url).origin===location.origin){const copy=response.clone();caches.open(CACHE).then(cache=>cache.put(event.request,copy))}return response}).catch(()=>event.request.mode==='navigate'?caches.match('./index.html'):Promise.reject(new Error('offline')))));
});
