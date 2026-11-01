/* Service worker mínimo: hace la página instalable y la abre rápido.
   Los datos NUNCA se guardan en caché: solo se cachea la "cáscara" de la app. */
const CACHE = 'brocoli-movil-v2';
const SHELL = ['./movil.html', './manifest.webmanifest', './icon-192.png', './icon-512.png', './apple-touch-icon.png'];
self.addEventListener('install', e=>{ e.waitUntil(caches.open(CACHE).then(c=>c.addAll(SHELL)).then(()=>self.skipWaiting())); });
self.addEventListener('activate', e=>{ e.waitUntil(caches.keys().then(ks=>Promise.all(ks.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim())); });
self.addEventListener('fetch', e=>{
  const req = e.request, url = new URL(req.url);
  if(req.method!=='GET' || url.origin!==location.origin) return;   // API de datos y CDNs: siempre a la red
  e.respondWith(fetch(req,{cache:'no-cache'}).then(r=>{ const copy=r.clone(); caches.open(CACHE).then(c=>c.put(req,copy)); return r; }).catch(()=>caches.match(req)));
});
