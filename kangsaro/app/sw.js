// 강사로: 새 버전은 항상 인터넷에서 먼저 받고, 안 될 때만 저장해 둔 화면을 씀
const C='kangsaro-app-v2';
self.addEventListener('install',e=>{self.skipWaiting();e.waitUntil(caches.open(C).then(c=>c.addAll(['./','./manifest.webmanifest','../try/icons/icon-192.png'])))});
self.addEventListener('activate',e=>e.waitUntil(caches.keys().then(ks=>Promise.all(ks.filter(k=>k!==C).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',e=>{const r=e.request;if(r.method!=='GET'||new URL(r.url).origin!==location.origin)return;
  e.respondWith(fetch(r).then(res=>{if(res.ok){const cp=res.clone();caches.open(C).then(c=>c.put(r,cp))}return res}).catch(()=>caches.match(r).then(m=>m||caches.match('./'))))});
// 푸시 알림 (서버가 data 메시지로 보냄: title·body·url·tag)
self.addEventListener('push',e=>{let p={};try{p=e.data?e.data.json():{}}catch(_){}const d=p.data||p.notification||p;
  e.waitUntil(self.registration.showNotification(d.title||'강사로',{body:d.body||'',tag:d.tag||'kangsaro',icon:'../try/icons/icon-192.png',badge:'../try/icons/icon-192.png',data:{url:d.url||'./'}}))});
self.addEventListener('notificationclick',e=>{e.notification.close();const u=(e.notification.data&&e.notification.data.url)||'./';
  e.waitUntil(clients.matchAll({type:'window',includeUncontrolled:true}).then(ws=>{for(const w of ws)if(w.url.includes('/kangsaro/app/')){w.focus();return w.navigate?w.navigate(u).catch(()=>{}):null}return clients.openWindow(u)}))});
