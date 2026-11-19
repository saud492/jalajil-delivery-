// تطبيق المناديب: كل شي من الشبكة مباشرة، وما ينحفظ أي طلب على الجهاز
// لو ما فيه نت تفتح الصفحة نفسها بس (بدون بيانات)
const CACHE = "jalajil-driver-v1";
self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(["/driver/", "/driver/icon-192.png"])).then(() => self.skipWaiting()));
});
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k.startsWith("jalajil-driver") && k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", e => {
  if (e.request.method !== "GET" || e.request.mode !== "navigate") return;
  e.respondWith(fetch(e.request).catch(() => caches.match("/driver/")));
});

// إشعارات الجوال
importScripts("/sw-push.js");
