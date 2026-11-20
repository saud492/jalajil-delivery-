// خيارات المحل والمندوب: وقت التجهيز، «صنف خلص»، إغلاق مؤقت، السجل، موقع المحل، شغّال/مو شغّال، بلاغات المندوب
import test from "node:test";
import assert from "node:assert/strict";
import { localServer } from "./local.mjs";

const b64 = a => Buffer.from(a).toString("base64url");
async function sub(name) {
  const pair = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  return { endpoint: "https://push.test/" + name, keys: { p256dh: b64(await crypto.subtle.exportKey("raw", pair.publicKey)), auth: b64(crypto.getRandomValues(new Uint8Array(16))) } };
}
const riyadhToday = () => new Date(Date.now() + 3 * 3600_000).toISOString().slice(0, 10);

test("shop and driver options", async () => {
  const keys = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const f = localServer({ VAPID_PUBLIC: b64(await crypto.subtle.exportKey("raw", keys.publicKey)), VAPID_PRIVATE: (await crypto.subtle.exportKey("jwk", keys.privateKey)).d, CRON_SECRET: "c" });
  const sent = [], real = globalThis.fetch;
  globalThis.fetch = async (url, init) => String(url).startsWith("https://push.test/") ? (sent.push(String(url).split("/").pop()), new Response("", { status: 201 })) : real(url, init);
  const jar = {};
  const call = async (who, method, path, body, headers = {}) => {
    const r = await f("http://localhost:8788" + path, { method, body: body ? JSON.stringify(body) : undefined,
      headers: { ...(body ? { "content-type": "application/json" } : {}), ...(jar[who] ? { cookie: jar[who] } : {}), ...headers } });
    const sc = r.headers.get("set-cookie"); if (sc) jar[who] = sc.split(";")[0];
    await f.settle();
    return { status: r.status, data: await r.json() };
  };
  const raw = sql => f.env.DB.raw.prepare(sql);

  await call("admin", "POST", "/api/admin/login", { password: "test-pass-123" });
  await call("admin", "PUT", "/api/admin/settings", { prepay_cap: 0 });
  let r = await call("admin", "POST", "/api/admin/shops", { name: "مطعم الريف", category: "مطعم", code: "rif", pin: "1111", commission: 2, map_url: "https://maps.google.com/?q=2,2" });
  const shopId = r.data.id;
  await call("admin", "POST", "/api/admin/drivers", { name: "أبو فهد", code: "abu", pin: "2222" });
  await call("admin", "POST", "/api/admin/drivers", { name: "سالم", code: "salem", pin: "3333" });
  await call("shop", "POST", "/api/partner/login", { code: "rif", pin: "1111" });
  await call("d1", "POST", "/api/driver/login", { code: "abu", pin: "2222" });
  await call("d2", "POST", "/api/driver/login", { code: "salem", pin: "3333" });
  await call("d1", "POST", "/api/driver/push", { sub: await sub("d1") });
  await call("d2", "POST", "/api/driver/push", { sub: await sub("d2") });
  await call("admin", "POST", "/api/admin/push", { sub: await sub("admin") });

  // ١) المندوب «مو شغّال»: ما يوصله تنبيه الطلب الجديد
  r = await call("d2", "POST", "/api/driver/duty", { on: false }); assert.equal(r.data.on_duty, false);
  r = await call("d2", "GET", "/api/driver/me"); assert.equal(r.data.driver.on_duty, false);
  sent.length = 0;
  const track = "trk" + "a".repeat(20);
  await call("anon", "POST", "/api/orders", { key: "order-one-123", track, order_no: "JL-1", dest: "home", auto_approve: 500,
    parts: [{ shop_id: shopId, cat: "مطعم", items: "٢ برجر + بيبسي" }] });
  assert.ok(sent.includes("d1")); assert.ok(!sent.includes("d2"), "off-duty driver gets no new-order alert");
  r = await call("admin", "GET", "/api/admin/drivers"); assert.equal(r.data.drivers.find(d => d.code === "salem").on_duty, 0);

  // ٢) موقع المحل يطلع للمندوب
  r = await call("d1", "GET", "/api/driver/orders");
  assert.equal(r.data.available[0].parts[0].shop_map, "https://maps.google.com/?q=2,2");

  // ٣) وقت التجهيز ٥ إلى ٤٥، و«صنف خلص» مع الفاتورة يلغي الموافقة التلقائية
  r = await call("shop", "GET", "/api/partner/orders"); const partId = r.data.orders[0].id;
  r = await call("shop", "POST", "/api/partner/parts/" + partId, { action: "accept", minutes: 25, bill: 40 }); assert.equal(r.status, 400, "25 isn't a choice");
  r = await call("shop", "POST", "/api/partner/parts/" + partId, { action: "accept", minutes: 45, bill: 40, note: "البيبسي خلص، حطينا سفن" }); assert.equal(r.status, 200);
  r = await call("anon", "GET", "/api/track/" + track);
  assert.equal(r.data.stage, "approve", "a shop note needs the customer's own approval even under the auto limit");
  assert.equal(r.data.parts[0].shop_note, "البيبسي خلص، حطينا سفن");
  // الفاتورة تنقفل بعد القبول: «جاهز» ما يغيّرها
  await call("shop", "POST", "/api/partner/parts/" + partId, { action: "ready", bill: 99 });
  r = await call("shop", "GET", "/api/partner/orders"); assert.equal(r.data.orders[0].bill, 40, "bill locked after accept");
  assert.equal(r.data.orders[0].shop_note, "البيبسي خلص، حطينا سفن");

  // ٤) سجل المحل لأي فترة
  const today = riyadhToday();
  r = await call("shop", "GET", `/api/partner/history?from=${today}&to=${today}`);
  assert.equal(r.data.totals.count, 1); assert.equal(r.data.totals.bills, 40); assert.equal(r.data.totals.commission, 2);
  r = await call("shop", "GET", "/api/partner/history?from=2026-01-01&to=2027-06-01"); assert.equal(r.status, 400, "max one year");
  r = await call("shop", "GET", "/api/partner/history"); assert.equal(r.status, 400);

  // ٥) زحمة: مسكّر نص ساعة ويفتح لحاله
  r = await call("shop", "POST", "/api/partner/status", { open: false, minutes: 45 }); assert.equal(r.status, 400);
  r = await call("shop", "POST", "/api/partner/status", { open: false, minutes: 30 }); assert.ok(r.data.closed_until > Date.now());
  r = await call("anon", "GET", "/api/shops"); assert.equal(r.data.shops[0].open, false);
  r = await call("shop", "GET", "/api/partner/me"); assert.equal(r.data.shop.open, false); assert.ok(r.data.shop.closed_until);
  raw(`UPDATE shops SET closed_until = ${Date.now() - 1000}`).run();
  r = await call("anon", "GET", "/api/shops"); assert.equal(r.data.shops[0].open, true, "reopens when the time is up");
  await call("x", "POST", "/api/cron", {}, { "x-cron-secret": "c" });
  assert.equal(raw("SELECT is_open FROM shops").get().is_open, 1, "the guard flips it back in the database");
  r = await call("shop", "POST", "/api/partner/status", { open: false }); assert.equal(r.data.closed_until, null, "closed until reopened by hand");
  await call("shop", "POST", "/api/partner/status", { open: true });

  // ٦) المندوب يبلّغ وهو في الطريق: صاحب الخدمة يدري، والزبون ما يشوفه، وما ينحسب ضد المندوب
  await call("d1", "POST", "/api/driver/orders/1", { action: "take" });
  r = await call("d1", "POST", "/api/driver/orders/1", { action: "issue", kind: "مزيف" }); assert.equal(r.status, 400);
  r = await call("d2", "POST", "/api/driver/orders/1", { action: "issue", kind: "الزبون ما يرد" }); assert.equal(r.status, 404, "only the driver who has it");
  sent.length = 0;
  r = await call("d1", "POST", "/api/driver/orders/1", { action: "issue", kind: "الزبون ما يرد", note: "اتصلت مرتين" }); assert.equal(r.status, 200);
  assert.deepEqual(sent, ["admin"]);
  r = await call("admin", "GET", "/api/admin/reports?status=open"); assert.equal(r.data.reports[0].source, "driver"); assert.equal(r.data.reports[0].driver_name, "أبو فهد");
  r = await call("anon", "GET", "/api/track/" + track); assert.equal(r.data.reports.length, 0, "customer doesn't see the driver's report");
  r = await call("admin", "GET", "/api/admin/drivers"); assert.equal(r.data.drivers.find(d => d.code === "abu").reports.count, 0, "not counted against the driver");

  // ٧) سجل المندوب
  await call("anon", "POST", "/api/track/" + track, { action: "approve", total: 40 });
  await call("d1", "POST", "/api/driver/orders/1", { action: "picked" });
  const code = raw("SELECT delivery_code FROM orders WHERE id = 1").get().delivery_code;
  r = await call("d1", "POST", "/api/driver/orders/1", { action: "delivered", code }); assert.equal(r.status, 200);
  r = await call("d1", "GET", `/api/driver/history?from=${today}&to=${today}`);
  assert.equal(r.data.totals.count, 1); assert.equal(r.data.totals.fees, 8); assert.equal(r.data.totals.earned, 8);
  assert.equal(r.data.orders[0].order_no, "JL-1");

  globalThis.fetch = real;
});
