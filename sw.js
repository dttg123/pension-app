const CACHE='pension-v3-1-1';
const ASSETS=[
  './','./index.html','./manifest.webmanifest','./icon.svg',
  './base.css','./components.css','./features.css','./v21.css','./v29.css',
  './core.js','./ui.js','./analysis.js','./ocr.js','./backup.js',
  './planning.js','./ledger.js','./coach.js','./integrity.js','./charts.js','./v21.js','./v29.js'
];
self.addEventListener('install',event=>event.waitUntil(
  caches.open(CACHE).then(cache=>cache.addAll(ASSETS)).then(()=>self.skipWaiting())
));
self.addEventListener('activate',event=>event.waitUntil(
  caches.keys().then(keys=>Promise.all(keys.filter(key=>key!==CACHE).map(key=>caches.delete(key)))).then(()=>self.clients.claim())
));
self.addEventListener('message',event=>{if(event.data?.type==='SKIP_WAITING')self.skipWaiting()});
self.addEventListener('fetch',event=>{
  if(event.request.method!=='GET')return;
  const url=new URL(event.request.url);
  if(url.origin!==self.location.origin)return;
  event.respondWith((async()=>{
    const cache=await caches.open(CACHE);
    try{
      const response=await fetch(event.request,{cache:event.request.mode==='navigate'?'no-store':'reload'});
      if(response?.ok)await cache.put(event.request,response.clone());
      return response;
    }catch(_){
      const cached=await cache.match(event.request,{ignoreSearch:true});
      if(cached)return cached;
      if(event.request.mode==='navigate')return cache.match('./index.html');
      throw _;
    }
  })());
});
