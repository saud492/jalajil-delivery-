// لوحة التحكم: ما تحفظ أي بيانات على الجهاز، بس تستقبل الإشعارات (وتفتح الصفحة لو ما فيه نت)
const CACHE = "jalajil-admin-v1";
self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(["/admin/"])).then(() => self.skipWaiting()));
});
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k.startsWith("jalajil-admin") && k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", e => {
  if (e.request.method !== "GET" || e.request.mode !== "navigate") return;
  e.respondWith(fetch(e.request).catch(() => caches.match("/admin/")));
});
importScripts("/sw-push.js");
