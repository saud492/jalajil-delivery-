// تجربة كاملة على السيرفر المحلي:
//   npx wrangler@4 pages dev site --d1 DB --binding ADMIN_PASSWORD=test-pass-123 --port 8788
//   node tests/e2e.mjs
import assert from "node:assert/strict";

const BASE = process.env.BASE || "http://localhost:8788";
const ADMIN_PW = process.env.ADMIN_PW || "test-pass-123";
const run = Date.now().toString(36);

function client() {
  let cookie = "";
  return async (method, path, body, headers = {}) => {
    const r = await fetch(BASE + path, {
      method, headers: { ...(body ? { "content-type": "application/json" } : {}), ...(cookie ? { cookie } : {}), ...headers },
      body: body ? JSON.stringify(body) : undefined,
    });
    const sc = r.headers.get("set-cookie");
    if (sc) cookie = sc.split(";")[0];
    let data = null; try { data = await r.json(); } catch {}
    return { status: r.status, data };
  };
}

const admin = client(), shopA = client(), shopB = client(), anon = client();
let r;

// صفحات
for (const p of ["/", "/partner/", "/admin/", "/driver/"]) {
  const res = await fetch(BASE + p);
  assert.equal(res.status, 200, p);
}

// اللوحة
r = await admin("GET", "/api/admin/shops"); assert.equal(r.status, 401, "admin needs login");
r = await admin("POST", "/api/admin/login", { password: "wrong" }); assert.equal(r.status, 401);
r = await admin("POST", "/api/admin/login", { password: ADMIN_PW }); assert.equal(r.status, 200, JSON.stringify(r.data));
const codeA = "a" + run, codeB = "b" + run;
r = await admin("POST", "/api/admin/shops", { name: "مطعم أ " + run, category: "مطعم", code: codeA, pin: "1111", commission: 2, trial_end: "2000-01-01" });
assert.equal(r.status, 200, JSON.stringify(r.data)); const idA = r.data.id;
r = await admin("POST", "/api/admin/shops", { name: "كافيه ب " + run, category: "كافيه", code: codeB, pin: "2222", commission: 1.5, trial_end: "2999-01-01" });
assert.equal(r.status, 200); const idB = r.data.id;
r = await admin("POST", "/api/admin/shops", { name: "مكرر", category: "مطعم", code: codeA, pin: "1111" }); assert.equal(r.status, 409, "duplicate code");
r = await admin("POST", "/api/admin/shops", { name: "x", category: "مطعم", code: "c" + run, pin: "12" }); assert.equal(r.status, 400, "short pin");

// موقع الزباين: القائمة العامة ما فيها أرقام سرية
r = await anon("GET", "/api/shops");
const pubA = r.data.shops.find(s => s.id === idA);
assert.ok(pubA && pubA.open === true && !("pin_hash" in pubA) && !("code" in pubA));

// الزبون يرسل طلب فيه محلين شركاء ومحل ثاني
const key = "test" + run + "x0";
const order = { key, order_no: "JL-0000-" + run, dest: "home", name: "زبون تجربة", phone: "0500000000", map: "https://maps.google.com/?q=1,1",
  pay: "كاش عند الاستلام", fee: 3, pack: [], parts: [
    { shop_id: idA, cat: "مطعم", name: "اسم مزور", items: "برجر ×٢" },
    { shop_id: idB, cat: "كافيه", name: "", items: "قهوة ×١" },
    { shop_id: null, cat: "بقالة", name: "بقالة الحي", items: "حليب" },
  ] };
r = await anon("POST", "/api/orders", order); assert.equal(r.status, 200, JSON.stringify(r.data));
const orderId = r.data.id;
r = await anon("POST", "/api/orders", order); assert.equal(r.data.id, orderId, "same key = same order");
r = await anon("POST", "/api/orders", { key: "bad key!", parts: [] }); assert.equal(r.status, 400);

// المحل أ يدخل ويشوف جزءه بس
r = await shopA("POST", "/api/partner/login", { code: codeA, pin: "9999" }); assert.equal(r.status, 401);
r = await shopA("POST", "/api/partner/login", { code: codeA.toUpperCase(), pin: "1111" }); assert.equal(r.status, 200, "code is case-insensitive");
r = await shopB("POST", "/api/partner/login", { code: codeB, pin: "2222" }); assert.equal(r.status, 200);
r = await shopA("GET", "/api/partner/orders");
const mineA = r.data.orders.filter(o => o.order_no === order.order_no);
assert.equal(mineA.length, 1, "shop A sees exactly its part");
assert.equal(mineA[0].items, "برجر ×٢");
assert.equal(mineA[0].customer_phone, "0500000000");
assert.ok(!("map_url" in mineA[0]));
r = await shopB("GET", "/api/partner/orders");
const partB = r.data.orders.find(o => o.order_no === order.order_no);
assert.equal(partB.items, "قهوة ×١");

// المحل أ ما يقدر يلمس طلب المحل ب
r = await shopA("POST", `/api/partner/parts/${partB.id}`, { action: "accept", minutes: 10 }); assert.equal(r.status, 404, "cross-shop blocked");
r = await shopA("POST", `/api/partner/parts/${mineA[0].id}`, { action: "accept", minutes: 15 }); assert.equal(r.status, 400, "only 10/20/30");
r = await shopA("POST", `/api/partner/parts/${mineA[0].id}`, { action: "accept", minutes: 20 }); assert.equal(r.status, 200);
r = await shopA("POST", `/api/partner/parts/${mineA[0].id}`, { action: "accept", minutes: 20 }); assert.equal(r.status, 409, "can't accept twice");
r = await shopA("POST", `/api/partner/parts/${mineA[0].id}`, { action: "ready" }); assert.equal(r.status, 200);
r = await shopB("POST", `/api/partner/parts/${partB.id}`, { action: "reject" }); assert.equal(r.status, 400, "reason required");
r = await shopB("POST", `/api/partner/parts/${partB.id}`, { action: "ready" }); assert.equal(r.status, 200);

// الطلب ما يتغيّر بعد ما المحل تعامل معه
r = await anon("POST", "/api/orders", { ...order, parts: [{ shop_id: idA, cat: "مطعم", items: "تعديل" }] });
assert.equal(r.data.unchanged, true);

// الملخص والعمولة: أ خلصت تجربته (عمولة ٢)، ب في التجربة (صفر)
r = await shopA("GET", "/api/partner/summary");
assert.equal(r.data.week.count, 1); assert.equal(r.data.week.commission, 2); assert.equal(r.data.month.count, 1);
r = await shopB("GET", "/api/partner/summary");
assert.equal(r.data.week.count, 1); assert.equal(r.data.week.commission, 0);

// مفتوح/مسكّر يبيّن للزبون
r = await shopB("POST", "/api/partner/status", { open: false }); assert.equal(r.data.open, false);
r = await anon("GET", "/api/shops"); assert.equal(r.data.shops.find(s => s.id === idB).open, false);

// طلب من موقع ثاني مرفوض
r = await shopB("POST", "/api/partner/status", { open: true }, { origin: "https://evil.example" }); assert.equal(r.status, 403);

// اللوحة تشوف الكل، والإلغاء يشيل العمولة
r = await admin("GET", "/api/admin/orders?days=1");
const full = r.data.orders.find(o => o.id === orderId);
assert.equal(full.parts.length, 3);
assert.equal(full.parts.find(p => !p.shop_id).shop_name, "بقالة الحي");
assert.equal(full.parts.find(p => p.shop_id === idA).shop_name, "مطعم أ " + run, "partner name from DB, not customer text");
r = await admin("GET", `/api/admin/orders?days=1&shop=${idB}`);
assert.ok(r.data.orders.some(o => o.id === orderId));
r = await admin("GET", "/api/admin/shops");
assert.equal(r.data.shops.find(s => s.id === idA).month_commission, 2);
r = await admin("POST", `/api/admin/parts/${mineA[0].id}`, { action: "cancel" }); assert.equal(r.status, 200);
r = await shopA("GET", "/api/partner/summary"); assert.equal(r.data.week.count, 0);

// تغيير الرقم السري يطلّع المحل
r = await admin("PUT", `/api/admin/shops/${idA}`, { pin: "3333" }); assert.equal(r.status, 200);
r = await shopA("GET", "/api/partner/orders"); assert.equal(r.status, 401, "old session dropped");
// إيقاف المحل يخفيه من الموقع
r = await admin("PUT", `/api/admin/shops/${idB}`, { active: false }); assert.equal(r.status, 200);
r = await anon("GET", "/api/shops"); assert.ok(!r.data.shops.some(s => s.id === idB));
r = await shopB("GET", "/api/partner/orders"); assert.equal(r.status, 401);

// المحل ما يقدر يدخل اللوحة
r = await shopB("GET", "/api/admin/orders"); assert.equal(r.status, 401);

// رمز المحل بالعربي
r = await admin("POST", "/api/admin/shops", { name: "محل عربي " + run, category: "بقالة", code: "الريف" + run, pin: "5555" });
assert.equal(r.status, 200, JSON.stringify(r.data));
const arab = client();
r = await arab("POST", "/api/partner/login", { code: "الريف" + run, pin: "٥٥٥٥" }); assert.equal(r.status, 200, "arabic code + arabic digits");
r = await admin("POST", "/api/admin/shops", { name: "x", category: "مطعم", code: "فيه مسافة", pin: "1234" }); assert.equal(r.status, 400, "no spaces in code");

// المناديب
const d1 = client(), d2 = client();
r = await admin("POST", "/api/admin/drivers", { name: "مندوب ١", phone: "0511111111", code: "فهد" + run, pin: "7777" }); assert.equal(r.status, 200, JSON.stringify(r.data)); const drv1 = r.data.id;
r = await admin("POST", "/api/admin/drivers", { name: "مندوب ٢", code: "d2" + run, pin: "8888" }); assert.equal(r.status, 200); const drv2 = r.data.id;
r = await admin("POST", "/api/admin/drivers", { name: "مكرر", code: "فهد" + run, pin: "7777" }); assert.equal(r.status, 409);
r = await d1("GET", "/api/driver/orders"); assert.equal(r.status, 401, "driver needs login");
r = await d1("POST", "/api/driver/login", { code: "فهد" + run, pin: "7777" }); assert.equal(r.status, 200);
r = await d2("POST", "/api/driver/login", { code: "d2" + run, pin: "8888" }); assert.equal(r.status, 200);
r = await d1("GET", "/api/admin/orders"); assert.equal(r.status, 401, "driver can't open admin");

const dkey = "drv" + run + "x1";
r = await anon("POST", "/api/orders", { key: dkey, order_no: "JL-D-" + run, dest: "chalet", place: "شاليه النخيل", name: "زبون ٢", phone: "0522222222", fee: 5, pack: [], parts: [{ shop_id: idA, cat: "مطعم", items: "شاورما" }] });
assert.equal(r.status, 200); const dOrder = r.data.id;
r = await d1("GET", "/api/driver/orders");
const av = r.data.available.find(o => o.id === dOrder);
assert.ok(av, "new order is available to drivers");
assert.ok(!("customer_phone" in av) && !("customer_name" in av), "no customer data before taking");
assert.ok(!("items" in av.parts[0]), "no items before taking");
r = await d1("POST", `/api/driver/orders/${dOrder}`, { action: "picked" }); assert.equal(r.status, 409, "can't pick before taking");
r = await d1("POST", `/api/driver/orders/${dOrder}`, { action: "take" }); assert.equal(r.status, 200);
r = await d2("POST", `/api/driver/orders/${dOrder}`, { action: "take" }); assert.equal(r.status, 409, "second driver can't take");
r = await d2("GET", "/api/driver/orders"); assert.ok(!r.data.available.some(o => o.id === dOrder), "gone from available");
r = await d1("GET", "/api/driver/orders");
const mineD = r.data.mine.find(o => o.id === dOrder);
assert.equal(mineD.customer_phone, "0522222222"); assert.equal(mineD.parts[0].items, "شاورما");
r = await d2("POST", `/api/driver/orders/${dOrder}`, { action: "picked" }); assert.equal(r.status, 409, "other driver can't act");
r = await d1("POST", `/api/driver/orders/${dOrder}`, { action: "release" }); assert.equal(r.status, 200);
r = await d2("GET", "/api/driver/orders"); assert.ok(r.data.available.some(o => o.id === dOrder), "released back");
// صاحب الخدمة يعيّن المندوب ٢
r = await admin("POST", `/api/admin/orders/${dOrder}/driver`, { driver_id: drv2 }); assert.equal(r.status, 200);
r = await d2("GET", "/api/driver/orders"); assert.equal(r.data.mine.find(o => o.id === dOrder).driver_status, "assigned");
r = await d2("POST", `/api/driver/orders/${dOrder}`, { action: "picked" }); assert.equal(r.status, 200);
r = await d2("POST", `/api/driver/orders/${dOrder}`, { action: "delivered" }); assert.equal(r.status, 200);
r = await admin("POST", `/api/admin/orders/${dOrder}/driver`, { driver_id: drv1 }); assert.equal(r.status, 409, "can't reassign delivered");
r = await d2("GET", "/api/driver/summary"); assert.equal(r.data.today.count, 1); assert.equal(r.data.week.fees, 5);
r = await admin("GET", "/api/admin/drivers");
assert.equal(r.data.drivers.find(d => d.id === drv2).month_count, 1);
assert.equal(r.data.drivers.find(d => d.id === drv2).month_fees, 5);
r = await admin("GET", "/api/admin/orders?days=1");
assert.equal(r.data.orders.find(o => o.id === dOrder).driver_id, drv2);
// طلب ملغي ما يطلع للمناديب
r = await anon("POST", "/api/orders", { key: "drv" + run + "x2", order_no: "JL-D2-" + run, dest: "home", parts: [{ shop_id: null, cat: "بقالة", name: "بقالة", items: "خبز" }] });
const cOrder = r.data.id;
r = await admin("GET", "/api/admin/orders?days=1");
const cPart = r.data.orders.find(o => o.id === cOrder).parts[0].id;
r = await admin("POST", `/api/admin/parts/${cPart}`, { action: "cancel" }); assert.equal(r.status, 200, "cancel non-partner part");
r = await d1("GET", "/api/driver/orders"); assert.ok(!r.data.available.some(o => o.id === cOrder), "cancelled order hidden");
// إيقاف المندوب يطلّعه
r = await admin("PUT", `/api/admin/drivers/${drv1}`, { active: false }); assert.equal(r.status, 200);
r = await d1("GET", "/api/driver/orders"); assert.equal(r.status, 401);

// قفل بعد ٥ محاولات غلط
const lock = client();
for (let i = 0; i < 5; i++) await lock("POST", "/api/partner/login", { code: codeA, pin: "0000" });
r = await lock("POST", "/api/partner/login", { code: codeA, pin: "3333" }); assert.equal(r.status, 429, "locked after 5 fails");

console.log("✔ all end-to-end checks passed");
