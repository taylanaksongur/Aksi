/* Aksi servis çalışanı (kapsam /Aksi/). Sorun çıkarsa KAPALI'yı true yapıp yayınla: önbellekler silinir, çalışan kendini kaldırır. */
const KAPALI = false;
const SURUM = "aksi-v1";
const HTML_ZAMAN_ASIMI = 3000;
const YAZI_TIPI = ["fonts.googleapis.com", "fonts.gstatic.com"];
const OTURUM_DOSYA = /\/(hesap\.js|esitle\.js)$/;   // oturum/yetki kodu: önce ağ, yalnız ağ yoksa önbellek (eski kod çevrimiçinde çalışmaz)
const SWR_DOSYA = /\/(manifest\.webmanifest|icon-192\.png|icon-512\.png|apple-touch-icon\.png)$/;

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", e => e.waitUntil((async () => {
  for (const k of await caches.keys()) if (KAPALI || (k.startsWith("aksi-") && k !== SURUM)) await caches.delete(k);
  if (KAPALI) { await self.registration.unregister(); }
  else await self.clients.claim();
})()));

const anahtar = url => { const u = new URL(url); u.search = ""; u.hash = ""; return u.href; };
const saklanir = r => r && (r.ok || r.type === "opaque");

async function agOnce(req) {
  const onb = await caches.open(SURUM), k = anahtar(req.url);
  const ag = fetch(req).then(r => { if (saklanir(r)) onb.put(k, r.clone()); return r; });
  const eski = await onb.match(k);
  if (!eski) return ag;
  ag.catch(() => {});
  return Promise.race([ag, new Promise(res => setTimeout(() => res(eski), HTML_ZAMAN_ASIMI))]).catch(() => eski);
}
async function yalnizAgYoksa(req) {
  const onb = await caches.open(SURUM), k = anahtar(req.url);
  try { const r = await fetch(req); if (r.ok) onb.put(k, r.clone()); return r; }
  catch (h) { const eski = await onb.match(k); if (eski) return eski; throw h; }
}
async function eskiyiVer(req, e) {
  const onb = await caches.open(SURUM), k = anahtar(req.url);
  const eski = await onb.match(k);
  const ag = fetch(req).then(r => { if (saklanir(r)) onb.put(k, r.clone()); return r; });
  if (eski) { e.waitUntil(ag.catch(() => {})); return eski; }
  return ag;
}

self.addEventListener("fetch", e => {
  const req = e.request, u = new URL(req.url);
  if (KAPALI || req.method !== "GET") return;           // POST/API: hiç dokunma
  if (u.hostname.endsWith("workers.dev")) return;       // hesap servisi: önbelleğe alma
  if (YAZI_TIPI.includes(u.hostname)) return e.respondWith(eskiyiVer(req, e));
  if (u.origin !== location.origin) return;
  if (req.mode === "navigate") return e.respondWith(agOnce(req));
  if (OTURUM_DOSYA.test(u.pathname)) return e.respondWith(yalnizAgYoksa(req));
  if (SWR_DOSYA.test(u.pathname)) e.respondWith(eskiyiVer(req, e));
});
