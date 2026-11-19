// إشعارات الجوال: كل خدمات التطبيقات (sw.js) تستورد هالملف
// يعرض الإشعار، ولما ينضغط يفتح الصفحة المطلوبة (أو يرجع لها لو مفتوحة)
self.addEventListener("push", e => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (err) { d = { body: e.data ? e.data.text() : "" }; }
  e.waitUntil(self.registration.showNotification(d.title || "توصيل جلاجل", {
    body: d.body || "", tag: d.tag || undefined, renotify: !!d.tag,
    icon: "/icon-192.png", badge: "/icon-192.png", dir: "rtl", lang: "ar",
    vibrate: [200, 100, 200], data: { url: d.url || "/" },
  }));
});
self.addEventListener("notificationclick", e => {
  e.notification.close();
  const url = new URL((e.notification.data && e.notification.data.url) || "/", self.location.origin);
  e.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(list => {
    for (const c of list) {
      const cu = new URL(c.url);
      if (cu.pathname === url.pathname && (!url.search || cu.search === url.search)) return c.focus();
    }
    return self.clients.openWindow(url.href);
  }));
});
