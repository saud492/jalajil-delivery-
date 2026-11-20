// لوحة التشغيل: الطلبات الحية، اقتراح المندوب، التحليلات، الزبائن والحظر، والتصدير
import test from "node:test";
import assert from "node:assert/strict";
import { localServer } from "./local.mjs";

const today = () => new Date(Date.now() + 3 * 3600_000).toISOString().slice(0, 10);

test("operations dashboard", async () => {
  const f = localServer();
  const jar = {};
  const call = async (who, method, path, body) => {
    const r = await f("http://localhost:8788" + path, { method, body: body ? JSON.stringify(body) : undefined,
      headers: { ...(body ? { "content-type": "application/json" } : {}), ...(jar[who] ? { cookie: jar[who] } : {}) } });
    const sc = r.headers.get("set-cookie"); if (sc) jar[who] = sc.split(";")[0];
    await f.settle();
    const text = new TextDecoder("utf-8", { ignoreBOM: true }).decode(await r.arrayBuffer());
    let data = null; try { data = JSON.parse(text.replace(/^FEFF/, "")); } catch {}
    return { status: r.status, data, text, headers: r.headers };
  };
  const raw = sql => f.env.DB.raw.prepare(sql);
  const IMG = "data:image/png;base64," + "A".repeat(100);

  let r = await call("x", "GET", "/api/admin/live"); assert.equal(r.status, 401);
  await call("admin", "POST", "/api/admin/login", { password: "test-pass-123" });
  await call("admin", "PUT", "/api/admin/settings", { prepay_cap: 0, driver_share: 75 });
  r = await call("admin", "POST", "/api/admin/shops", { name: "مطعم الريف", category: "مطعم", code: "rif", pin: "1111", commission: 2, phone: "٠٥٥٥١٢٣٤٥٦" });
  assert.equal(r.status, 200, JSON.stringify(r.data)); const shopId = r.data.id;
  r = await call("admin", "GET", "/api/admin/shops"); assert.equal(r.data.shops[0].phone, "0555123456");
  r = await call("admin", "POST", "/api/admin/shops", { name: "x", category: "مطعم", code: "xx", pin: "1111", phone: "12" }); assert.equal(r.status, 400);
  await call("admin", "POST", "/api/admin/drivers", { name: "أبو فهد", code: "abu", pin: "2222" });
  await call("admin", "POST", "/api/admin/drivers", { name: "سالم", code: "salem", pin: "3333" });
  await call("shop", "POST", "/api/partner/login", { code: "rif", pin: "1111" });
  await call("d1", "POST", "/api/driver/login", { code: "abu", pin: "2222" });
  await call("d2", "POST", "/api/driver/login", { code: "salem", pin: "3333" });
  await call("d2", "POST", "/api/driver/duty", { on: false });

  // طلبين من نفس الزبون + طلب من زبون ثاني
  const order = (k, phone, items, extra = {}) => call("anon", "POST", "/api/orders", { key: k, track: k + "trackxxxxxxxx", order_no: k.toUpperCase(), dest: "home", name: "زبون " + phone.slice(-2), phone,
    parts: [{ shop_id: shopId, cat: "مطعم", items }], ...extra });
  await order("ord-aaa-111", "0500000001", "برجر");
  await order("ord-bbb-222", "0500000002", "شاورما");

  // ١) لوحة العمليات: كل طلب في عموده، والتأخير يتلوّن
  r = await call("admin", "GET", "/api/admin/live");
  assert.equal(r.data.orders.length, 2); assert.ok(r.data.orders.every(o => o.column === "new" && o.level === "green"));
  assert.equal(r.data.orders[0].parts[0].shop_phone, "0555123456");
  raw(`UPDATE orders SET created_at = created_at - ${11 * 60000} WHERE id = 1`).run();
  r = await call("admin", "GET", "/api/admin/live"); assert.equal(r.data.orders.find(o => o.id === 1).level, "red", "over 10 min waiting for the bill");
  // اقتراح المندوب: الشغّال قبل اللي مو شغّال
  assert.equal(r.data.drivers[0].name, "أبو فهد"); assert.equal(r.data.drivers[0].suggested, true);
  assert.equal(r.data.drivers.find(d => d.name === "سالم").on_duty, false);

  // ٢) طلب ١ يكمل للتسليم
  r = await call("shop", "GET", "/api/partner/orders");
  const p1 = r.data.orders.find(o => o.order_no === "ORD-AAA-111").id;
  await call("shop", "POST", "/api/partner/parts/" + p1, { action: "accept", minutes: 10, bill: 50 });
  assert.ok(raw("SELECT billed_at FROM orders WHERE id = 1").get().billed_at, "bill time is stamped");
  r = await call("admin", "GET", "/api/admin/live"); assert.equal(r.data.orders.find(o => o.id === 1).column, "customer");
  await call("anon", "POST", "/api/track/ord-aaa-111trackxxxxxxxx", { action: "approve", total: 50 });
  await call("d1", "POST", "/api/driver/orders/1", { action: "take" });
  r = await call("admin", "GET", "/api/admin/live"); assert.equal(r.data.orders.find(o => o.id === 1).column, "buying");
  // المندوب الشغّال يظل قبل اللي مو شغّال حتى لو معه طلب، والحمل يطلع
  assert.equal(r.data.drivers[0].name, "أبو فهد"); assert.equal(r.data.drivers[0].load, 1);
  await call("shop", "POST", "/api/partner/parts/" + p1, { action: "ready" });
  await call("d1", "POST", "/api/driver/orders/1", { action: "picked" });
  r = await call("admin", "GET", "/api/admin/live"); assert.equal(r.data.orders.find(o => o.id === 1).column, "onway");
  const code = raw("SELECT delivery_code FROM orders WHERE id = 1").get().delivery_code;
  await call("d1", "POST", "/api/driver/orders/1", { action: "delivered", code });
  r = await call("admin", "GET", "/api/admin/live"); assert.equal(r.data.orders.find(o => o.id === 1).column, "done");

  // ٣) التحليلات
  r = await call("admin", "GET", `/api/admin/analytics?from=${today()}&to=${today()}`);
  const s = r.data.stats;
  assert.equal(s.orders, 2); assert.equal(s.delivered, 1); assert.equal(s.fees, 8); assert.equal(s.driver_share, 6); assert.equal(s.commissions, 2);
  assert.equal(s.net, 4, "8 fee - 6 driver + 2 commission"); assert.equal(s.sales, 50);
  assert.ok(s.stages.shop_accept >= 11, "the shop accepted ~11 min after the order");
  assert.equal(r.data.days.length, 1); assert.equal(r.data.days[0].orders, 2);
  assert.equal(r.data.heat.flat().reduce((a, b) => a + b, 0), 2);
  assert.equal(r.data.shops[0].orders, 2); assert.equal(r.data.shops[0].accept_rate, 50);
  assert.equal(r.data.drivers[0].delivered, 1); assert.equal(r.data.drivers[0].earned, 6);

  // ٤) الزبائن والحظر
  await order("ord-ccc-333", "+966 50 000 0001", "بيبسي");
  r = await call("admin", "GET", "/api/admin/customers");
  const c1 = r.data.customers.find(c => c.phone_key === "966500000001");
  assert.equal(c1.orders, 2, "same customer across phone formats"); assert.equal(c1.segment, "returning"); assert.equal(c1.spent, 58);
  assert.equal(r.data.counts.all, 2);
  r = await call("admin", "PUT", "/api/admin/customers/966500000002", { blocked: true, reason: "طلبات وهمية" }); assert.equal(r.data.blocked, true);
  r = await call("admin", "GET", "/api/admin/customers?segment=blocked"); assert.equal(r.data.customers.length, 1);
  await order("ord-ddd-444", "0500000002", "طلب وهمي");
  r = await call("shop", "GET", "/api/partner/orders"); assert.ok(!r.data.orders.some(o => o.order_no === "ORD-DDD-444"), "shop doesn't see a blocked number's order");
  r = await call("d2", "GET", "/api/driver/orders"); assert.ok(!r.data.available.some(o => o.order_no === "ORD-DDD-444"), "drivers don't either");
  r = await call("d2", "POST", "/api/driver/orders/4", { action: "take" }); assert.equal(r.status, 409);
  r = await call("admin", "GET", "/api/admin/live"); assert.equal(r.data.orders.find(o => o.order_no === "ORD-DDD-444").blocked, true);
  await call("admin", "PUT", "/api/admin/customers/966500000002", { note: "يتصل كثير" });
  r = await call("admin", "GET", "/api/admin/customers?q=0000002"); assert.equal(r.data.customers[0].note, "يتصل كثير"); assert.equal(r.data.customers[0].blocked, true);

  // ٥) التصدير
  r = await call("admin", "GET", `/api/admin/export?type=orders&from=${today()}&to=${today()}`);
  assert.match(r.headers.get("content-type"), /text\/csv/); assert.ok(r.text.startsWith("﻿رقم الطلب"));
  assert.equal(r.text.trim().split("\r\n").length, 5, "header + 4 orders");
  r = await call("admin", "GET", `/api/admin/export?type=shops&from=${today()}&to=${today()}`); assert.match(r.text, /مطعم الريف,1,50,2/);
  r = await call("admin", "GET", `/api/admin/export?type=drivers&from=${today()}&to=${today()}`); assert.match(r.text, /أبو فهد,,1,8,6/);
  r = await call("admin", "GET", `/api/admin/export?type=x&from=${today()}&to=${today()}`); assert.equal(r.status, 400);
});
