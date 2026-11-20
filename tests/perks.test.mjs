// مزايا المحلات: الانضمام، عرض التوصيل المجاني وحساباته، المميز، الملصق (ref)، والتقرير الشهري
import test from "node:test";
import assert from "node:assert/strict";
import { localServer } from "./local.mjs";

test("partner perks", async () => {
  const f = localServer();
  const jar = {};
  const call = async (who, method, path, body) => {
    const r = await f("http://localhost:8788" + path, { method, body: body ? JSON.stringify(body) : undefined,
      headers: { ...(body ? { "content-type": "application/json" } : {}), ...(jar[who] ? { cookie: jar[who] } : {}) } });
    const sc = r.headers.get("set-cookie"); if (sc) jar[who] = sc.split(";")[0];
    await f.settle();
    return { status: r.status, data: await r.json() };
  };
  const raw = sql => f.env.DB.raw.prepare(sql);
  const month = new Date(Date.now() + 3 * 3600_000).toISOString().slice(0, 7);

  // ١) صفحة الانضمام
  let r = await call("anon", "GET", "/api/join"); assert.equal(r.data.trial_days, 30); assert.equal(r.data.commission, 2);
  r = await call("anon", "POST", "/api/join", { name: "مخبز الفجر", category: "مطعم", owner: "أبو سالم", phone: "123" }); assert.equal(r.status, 400);
  r = await call("anon", "POST", "/api/join", { name: "مخبز الفجر", category: "مطعم", owner: "أبو سالم", phone: "٠٥٥٥٥٥٥٥٥٥", note: "نبي نشترك" }); assert.equal(r.status, 200);
  await call("anon", "POST", "/api/join", { name: "مخبز الفجر", category: "مطعم", owner: "أبو سالم", phone: "0555555555" });
  r = await call("anon", "POST", "/api/join", { name: "مخبز الفجر", category: "مطعم", owner: "أبو سالم", phone: "0555555555" }); assert.equal(r.status, 429, "same phone at most twice a day");
  r = await call("x", "GET", "/api/admin/requests"); assert.equal(r.status, 401);
  await call("admin", "POST", "/api/admin/login", { password: "test-pass-123" });
  r = await call("admin", "GET", "/api/admin/requests"); assert.equal(r.data.open, 2); assert.equal(r.data.requests[0].phone, "0555555555");
  r = await call("admin", "POST", "/api/admin/requests/" + r.data.requests[0].id, { status: "done" }); assert.equal(r.status, 200);
  r = await call("admin", "PUT", "/api/admin/settings", { partner_trial_days: 14, partner_commission: "١.٥", prepay_cap: 0 }); assert.equal(r.status, 200);
  r = await call("anon", "GET", "/api/join"); assert.equal(r.data.trial_days, 14); assert.equal(r.data.commission, 1.5);

  // ٢) محل مميز وعنده عرض
  r = await call("admin", "POST", "/api/admin/shops", { name: "مطعم الريف", category: "مطعم", code: "rif", pin: "1111", commission: 2 }); const shopId = r.data.id;
  await call("admin", "PUT", "/api/admin/shops/" + shopId, { featured: true });
  await call("admin", "POST", "/api/admin/drivers", { name: "أبو فهد", code: "abu", pin: "2222" });
  await call("shop", "POST", "/api/partner/login", { code: "rif", pin: "1111" });
  await call("d", "POST", "/api/driver/login", { code: "abu", pin: "2222" });
  r = await call("shop", "POST", "/api/partner/offer", { min: 5 }); assert.equal(r.status, 400);
  r = await call("shop", "POST", "/api/partner/offer", { min: "٥٠", text: "على حسابنا" }); assert.equal(r.data.offer.min, 50);
  r = await call("anon", "GET", "/api/shops"); assert.deepEqual(r.data.shops[0].offer, { min: 50, text: "على حسابنا" }); assert.equal(r.data.shops[0].featured, true);
  r = await call("shop", "GET", "/api/partner/me"); assert.equal(r.data.shop.offer.min, 50); assert.equal(r.data.shop.featured, true);

  // ٣) طلب من الملصق، فاتورته فوق حد العرض: التوصيل على المحل
  const t1 = "trk" + "a".repeat(20);
  await call("anon", "POST", "/api/orders", { key: "order-one-123", track: t1, order_no: "JL-1", dest: "home", phone: "0500000001", ref: shopId, parts: [{ shop_id: shopId, cat: "مطعم", items: "عشا" }] });
  assert.equal(raw("SELECT ref_shop FROM orders WHERE id = 1").get().ref_shop, shopId);
  // العرض ينحفظ لحظة الطلب: لو المحل غيّره بعدين ما يأثر على هالطلب
  await call("shop", "POST", "/api/partner/offer", { off: true });
  r = await call("shop", "GET", "/api/partner/orders"); const pid = r.data.orders[0].id;
  await call("shop", "POST", "/api/partner/parts/" + pid, { action: "accept", minutes: 10, bill: 60 });
  r = await call("anon", "GET", "/api/track/" + t1);
  assert.equal(r.data.fee_waived, true); assert.equal(r.data.collect, 60, "customer pays the food only");
  await call("anon", "POST", "/api/track/" + t1, { action: "approve", total: 60 });
  await call("d", "POST", "/api/driver/orders/1", { action: "take" });
  r = await call("d", "GET", "/api/driver/orders"); assert.equal(r.data.mine[0].collect, 60); assert.equal(r.data.mine[0].fee_waived, true);
  await call("shop", "POST", "/api/partner/parts/" + pid, { action: "ready" });
  await call("d", "POST", "/api/driver/orders/1", { action: "picked" });
  const code = raw("SELECT delivery_code FROM orders WHERE id = 1").get().delivery_code;
  r = await call("d", "POST", "/api/driver/orders/1", { action: "delivered", code }); assert.equal(r.status, 200);
  assert.equal(raw("SELECT offer_charge FROM parts WHERE id = " + pid).get().offer_charge, 8);
  // المندوب ما حصّل التوصيل، ونصيبه ٨ كامل → صاحب الخدمة عليه ٨ للمندوب
  r = await call("d", "GET", "/api/driver/wallet"); assert.equal(r.data.wallet.balance, -8);
  // على المحل: العمولة ٢ + التوصيل ٨
  r = await call("admin", "GET", "/api/admin/shops"); assert.equal(r.data.shops[0].month_commission, 10);
  r = await call("shop", "GET", "/api/partner/history?from=2026-01-01&to=2026-12-31"); assert.equal(r.data.totals.offer_charges, 8);

  // ٤) طلب ثاني بدون عرض: التوصيل على الزبون عادي
  const t2 = "trk" + "b".repeat(20);
  await call("anon", "POST", "/api/orders", { key: "order-two-456", track: t2, order_no: "JL-2", dest: "home", phone: "0500000001", parts: [{ shop_id: shopId, cat: "مطعم", items: "غدا" }] });
  r = await call("shop", "GET", "/api/partner/orders"); const pid2 = r.data.orders.find(o => o.order_no === "JL-2").id;
  await call("shop", "POST", "/api/partner/parts/" + pid2, { action: "accept", minutes: 10, bill: 70 });
  r = await call("anon", "GET", "/api/track/" + t2); assert.equal(r.data.fee_waived, false); assert.equal(r.data.collect, 78);
  await call("anon", "POST", "/api/track/" + t2, { action: "approve", total: 70 });
  await call("shop", "POST", "/api/partner/parts/" + pid2, { action: "ready" });

  // ٥) التقرير الشهري
  r = await call("shop", "GET", "/api/partner/report?month=" + month);
  const c = r.data.cur;
  assert.equal(c.orders, 2); assert.equal(c.sales, 130); assert.equal(c.avg_bill, 65);
  assert.equal(c.customers, 1); assert.equal(c.new_customers, 1); assert.equal(c.from_qr, 1);
  assert.equal(c.offer_orders, 1); assert.equal(c.offer_charges, 8); assert.equal(c.commission, 4); assert.equal(c.due, 12);
  assert.equal(r.data.prev.orders, 0); assert.equal(r.data.shop.featured, true);
  r = await call("shop", "GET", "/api/partner/report?month=2026-13"); assert.equal(r.status, 400, "no 13th month");
  r = await call("shop", "GET", "/api/partner/report"); assert.equal(r.status, 400);
});
