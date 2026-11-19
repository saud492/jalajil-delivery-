// خدمة بسيطة: تجيب أحدث نسخة من الشبكة، ولو ما فيه نت تفتح آخر نسخة محفوظة
// ما تلمس طلبات السيرفر (/api) ولا تطبيق الشركاء ولا لوحة التحكم، عشان ما تنحفظ بيانات الطلبات على الجهاز
const CACHE = "jalajil-v3";
const SKIP = /^\/(api|partner|admin|driver|track)(\/|$)/;
self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(["./", "icon-192.png"])).then(() => self.skipWaiting()));
});
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", e => {
  if (e.request.method !== "GET") return;
  const u = new URL(e.request.url);
  if (u.origin === self.location.origin && SKIP.test(u.pathname)) return;
  e.respondWith(
    fetch(e.request).then(r => {
      const copy = r.clone();
      caches.open(CACHE).then(c => c.put(e.request, copy)).catch(() => {});
      return r;
    }).catch(() => caches.match(e.request))
  );
});

// إشعارات الجوال
importScripts("/sw-push.js");
