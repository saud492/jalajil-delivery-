// الإشعارات: التشفير يتفك بمفتاح الجهاز، التوقيع صحيح، وكل حدث يوصل للشخص الصح
// node --test tests/
import test from "node:test";
import assert from "node:assert/strict";
import { localServer } from "./local.mjs";

const b64 = a => Buffer.from(a).toString("base64url");
const unb64 = s => new Uint8Array(Buffer.from(s, "base64url"));
const enc = new TextEncoder();
const cat = (...a) => Uint8Array.from(a.flatMap(x => [...x]));
async function hmac(key, data) {
  const k = await crypto.subtle.importKey("raw", key, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", k, data));
}

// جهاز مقلّد: عنده مفتاحه، ويفك الرسايل مثل المتصفح (RFC 8291)
async function device(name) {
  const pair = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  const pub = new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey));
  const auth = crypto.getRandomValues(new Uint8Array(16));
  return {
    sub: { endpoint: "https://push.test/" + name, keys: { p256dh: b64(pub), auth: b64(auth) } },
    async decrypt(body) {
      const salt = body.slice(0, 16), idlen = body[20], asPub = body.slice(21, 21 + idlen), ct = body.slice(21 + idlen);
      const k = await crypto.subtle.importKey("raw", asPub, { name: "ECDH", namedCurve: "P-256" }, false, []);
      const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: k }, pair.privateKey, 256));
      const ikm = await hmac(await hmac(auth, shared), cat(enc.encode("WebPush: info\0"), pub, asPub, [1]));
      const prk = await hmac(salt, ikm);
      const cek = (await hmac(prk, cat(enc.encode("Content-Encoding: aes128gcm\0"), [1]))).slice(0, 16);
      const nonce = (await hmac(prk, cat(enc.encode("Content-Encoding: nonce\0"), [1]))).slice(0, 12);
      const key = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["decrypt"]);
      const pt = new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: nonce }, key, ct));
      assert.equal(pt[pt.length - 1], 2, "last-record delimiter");
      return JSON.parse(new TextDecoder().decode(pt.slice(0, -1)));
    },
  };
}

test("push alerts reach the right people at each step", async () => {
  const keys = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const VAPID_PUBLIC = b64(await crypto.subtle.exportKey("raw", keys.publicKey));
  const VAPID_PRIVATE = (await crypto.subtle.exportKey("jwk", keys.privateKey)).d;
  const f = localServer({ VAPID_PUBLIC, VAPID_PRIVATE, CRON_SECRET: "cron-test-secret" });

  // خدمة الإشعارات المقلّدة: تستقبل، تتحقق من التوقيع، وتفك الرسالة
  const devices = {}, inbox = [], gone = new Set();
  const real = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    if (!String(url).startsWith("https://push.test/")) return real(url, init);
    const name = String(url).split("/").pop();
    if (gone.has(name)) return new Response("", { status: 410 });
    const h = new Headers(init.headers);
    assert.equal(h.get("content-encoding"), "aes128gcm");
    const m = /^vapid t=([^.]+)\.([^.]+)\.([^,]+), k=(.+)$/.exec(h.get("authorization"));
    assert.ok(m, "vapid header");
    assert.equal(m[4], VAPID_PUBLIC);
    const claims = JSON.parse(Buffer.from(m[2], "base64url"));
    assert.equal(claims.aud, "https://push.test");
    const ok = await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, keys.publicKey, unb64(m[3]), enc.encode(m[1] + "." + m[2]));
    assert.ok(ok, "JWT signature verifies with the public key");
    inbox.push({ to: name, msg: await devices[name].decrypt(new Uint8Array(init.body)) });
    return new Response("", { status: 201 });
  };

  const jar = {};
  const call = async (who, method, path, body, headers = {}) => {
    const r = await f("http://localhost:8788" + path, {
      method, body: body ? JSON.stringify(body) : undefined,
      headers: { ...(body ? { "content-type": "application/json" } : {}), ...(jar[who] ? { cookie: jar[who] } : {}), ...headers },
    });
    const sc = r.headers.get("set-cookie"); if (sc) jar[who] = sc.split(";")[0];
    await f.settle();
    return { status: r.status, data: await r.json() };
  };
  const take = () => inbox.splice(0);
  const to = (list, name) => list.filter(x => x.to === name).map(x => x.msg);

  let r = await call("anon", "GET", "/api/push/key"); assert.equal(r.data.key, VAPID_PUBLIC);
  await call("admin", "POST", "/api/admin/login", { password: "test-pass-123" });
  await call("admin", "PUT", "/api/admin/settings", { delivery_fee: 8, prepay_cap: 0 });
  r = await call("admin", "POST", "/api/admin/shops", { name: "مطعم الريف", category: "مطعم", code: "rif", pin: "1111", commission: 2 }); const shopId = r.data.id;
  r = await call("admin", "POST", "/api/admin/drivers", { name: "أبو فهد", code: "abu", pin: "2222", phone: "0511111111" }); assert.equal(r.status, 200, JSON.stringify(r.data));
  await call("shop", "POST", "/api/partner/login", { code: "rif", pin: "1111" });
  await call("drv", "POST", "/api/driver/login", { code: "abu", pin: "2222" });

  for (const n of ["shop", "drv", "admin", "cust"]) devices[n] = await device(n);
  r = await call("anon", "POST", "/api/partner/push", { sub: devices.shop.sub }); assert.equal(r.status, 401, "login needed");
  assert.equal((await call("shop", "POST", "/api/partner/push", { sub: devices.shop.sub })).status, 200);
  assert.equal((await call("drv", "POST", "/api/driver/push", { sub: devices.drv.sub })).status, 200);
  assert.equal((await call("admin", "POST", "/api/admin/push", { sub: devices.admin.sub })).status, 200);
  r = await call("shop", "POST", "/api/partner/push", { sub: { endpoint: "https://x", keys: { p256dh: "bad", auth: "x" } } }); assert.equal(r.status, 400);

  // ١) طلب جديد: المحل والمندوب وصاحب الخدمة (والمندوب ما يشوف بيانات الزبون)
  const track = "trk" + "a".repeat(20);
  r = await call("anon", "POST", "/api/orders", { key: "order-one-123", track, code: "4321", order_no: "JL-1", dest: "home", place: "حي السلام",
    name: "زبون", phone: "0500000000", parts: [{ shop_id: shopId, cat: "مطعم", items: "٢ برجر" }] });
  assert.equal(r.status, 200);
  let got = take();
  assert.equal(to(got, "shop")[0].title, "🔔 طلب جديد JL-1"); assert.match(to(got, "shop")[0].body, /برجر/);
  assert.match(to(got, "drv")[0].body, /بيت · حي السلام · رسوم 8/); assert.doesNotMatch(JSON.stringify(to(got, "drv")), /0500000000|برجر/);
  assert.equal(to(got, "admin").length, 1);
  assert.equal((await call("cust", "POST", "/api/track/" + track, { action: "push", sub: devices.cust.sub })).status, 200);

  // ٢) المحل يقبل ويكتب الفاتورة: الزبون يجيه «وافق»
  r = await call("shop", "GET", "/api/partner/orders"); const partId = r.data.orders[0].id;
  await call("drv", "POST", "/api/driver/orders/1", { action: "take" }); take();
  await call("shop", "POST", "/api/partner/parts/" + partId, { action: "accept", minutes: 20, bill: 45 });
  got = take();
  assert.equal(to(got, "cust")[0].title, "💰 فاتورة طلبك جاهزة"); assert.match(to(got, "cust")[0].url, /\/track\/\?k=trk/);
  assert.equal(to(got, "drv").length, 0, "driver waits quietly");
  // ٣) الزبون يوافق: المندوب يجيه «اشترِ»
  await call("cust", "POST", "/api/track/" + track, { action: "approve", total: 45 });
  got = take(); assert.equal(to(got, "drv")[0].title, "✅ تقدر تشتري الحين");
  // ٤) المحل جهّز: المندوب. ٥) المندوب استلم: الزبون «في الطريق»
  await call("shop", "POST", "/api/partner/parts/" + partId, { action: "ready" });
  got = take(); assert.match(to(got, "drv")[0].title, /جهّز الطلب/);
  await call("drv", "POST", "/api/driver/orders/1", { action: "picked" });
  got = take(); assert.equal(to(got, "cust")[0].title, "🛵 طلبك في الطريق");

  // ٦) موافقة تلقائية: فاتورة تحت الحد ما تنتظر الزبون
  const t2 = "trk" + "b".repeat(20);
  await call("anon", "POST", "/api/orders", { key: "order-two-456", track: t2, order_no: "JL-2", dest: "home", phone: "0500000000", auto_approve: "١٠٠",
    parts: [{ shop_id: null, cat: "بقالة", name: "بقالة الحي", items: "خبز" }] });
  await call("drv", "POST", "/api/driver/orders/2", { action: "take" }); take();
  r = await call("drv", "GET", "/api/driver/orders"); const p2 = r.data.mine.find(o => o.id === 2).parts[0].id;
  const IMG = "data:image/png;base64," + "A".repeat(100);
  await call("drv", "POST", `/api/driver/parts/${p2}/bill`, { amount: 60, image: IMG });
  got = take(); assert.match(to(got, "drv")[0].body, /تحت حد الموافقة التلقائية/);
  r = await call("anon", "GET", "/api/track/" + t2); assert.equal(r.data.stage, "buying"); assert.equal(r.data.auto_approved, true); assert.equal(r.data.order.auto_approve, 100);
  assert.equal((await call("drv", "POST", "/api/driver/orders/2", { action: "picked" })).status, 200, "driver can buy without waiting");
  // فوق الحد: يرجع ينتظر الزبون
  const t3 = "trk" + "c".repeat(20);
  await call("anon", "POST", "/api/orders", { key: "order-three-789", track: t3, order_no: "JL-3", dest: "home", auto_approve: 50,
    parts: [{ shop_id: null, cat: "بقالة", name: "بقالة", items: "رز" }] });
  await call("drv", "POST", "/api/driver/orders/3", { action: "take" });
  r = await call("drv", "GET", "/api/driver/orders"); const p3 = r.data.mine.find(o => o.id === 3).parts[0].id;
  await call("drv", "POST", `/api/driver/parts/${p3}/bill`, { amount: 60, image: IMG }); take();
  r = await call("anon", "GET", "/api/track/" + t3); assert.equal(r.data.stage, "approve");

  // ٧) الحارس: محل ما رد دقيقتين، طلب بدون مندوب ٣ دقايق
  r = await call("anon", "POST", "/api/orders", { key: "order-four-000", order_no: "JL-4", dest: "home", parts: [{ shop_id: shopId, cat: "مطعم", items: "شاورما" }] });
  take();
  f.env.DB.raw.prepare("UPDATE orders SET created_at = created_at - 200000 WHERE id = 4").run();
  f.env.DB.raw.prepare("UPDATE parts SET updated_at = updated_at - 400000 WHERE order_id = 3").run();
  r = await call("x", "POST", "/api/cron", {}, { "x-cron-secret": "wrong" }); assert.equal(r.status, 403);
  r = await call("x", "POST", "/api/cron", {}, { "x-cron-secret": "cron-test-secret" }); assert.equal(r.data.nudged, 3, JSON.stringify(r.data));
  got = take();
  const adm = to(got, "admin").map(m => m.title);
  assert.ok(adm.includes("⏰ مطعم الريف ما رد"), adm.join(" | "));
  assert.ok(adm.includes("⏰ طلب JL-4 بدون مندوب"));
  assert.ok(adm.includes("⏰ الزبون ما وافق على المبلغ"));
  assert.equal(to(got, "shop")[0].title, "⏰ طلب ينتظرك JL-4");
  r = await call("x", "POST", "/api/cron", {}, { "x-cron-secret": "cron-test-secret" }); assert.equal(r.data.nudged, 0, "each guard fires once");

  // ٨) الزبون يلغي: المندوب يدري
  await call("cust", "POST", "/api/track/" + t3, { action: "reject" });
  got = take(); assert.equal(to(got, "drv")[0].title, "❌ الطلب انلغى");

  // ٩) جهاز انحذف (410) ينشال من القائمة، وإيقاف التنبيهات يحذف الاشتراك
  gone.add("shop");
  await call("anon", "POST", "/api/orders", { key: "order-five-111", order_no: "JL-5", dest: "home", parts: [{ shop_id: shopId, cat: "مطعم", items: "x" }] });
  assert.equal(f.env.DB.raw.prepare("SELECT COUNT(*) n FROM push_subs WHERE kind = 'shop'").get().n, 0);
  await call("admin", "POST", "/api/admin/push", { sub: devices.admin.sub, off: true });
  assert.equal(f.env.DB.raw.prepare("SELECT COUNT(*) n FROM push_subs WHERE kind = 'admin'").get().n, 0);

  globalThis.fetch = real;
});
