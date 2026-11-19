// يولّد مفاتيح إشعارات الجوال (VAPID) مرة وحدة:
//   node tools/vapid-keys.mjs
// بعدين حط القيمتين أسرار في Cloudflare Pages (Settings → Variables and Secrets):
//   VAPID_PUBLIC و VAPID_PRIVATE
// لو تغيّرت المفاتيح بعدين، كل الأجهزة لازم تفعّل التنبيهات من جديد
const b64url = a => Buffer.from(a).toString("base64url");
const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
const pub = new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey));
const jwk = await crypto.subtle.exportKey("jwk", pair.privateKey);
console.log("VAPID_PUBLIC=" + b64url(pub));
console.log("VAPID_PRIVATE=" + jwk.d);
// سر الـ cron (للـ Worker اللي يفحص الطلبات الواقفة كل دقيقة)
console.log("CRON_SECRET=" + b64url(crypto.getRandomValues(new Uint8Array(24))));
