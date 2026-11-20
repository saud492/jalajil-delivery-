// تجربة كاملة على السيرفر المحلي:
//   npx wrangler@4 pages dev site --d1 DB --binding ADMIN_PASSWORD=test-pass-123 --port 8788
//   node tests/e2e.mjs
// أو بدون wrangler:  LOCAL=1 node tests/e2e.mjs
import assert from "node:assert/strict";

const BASE = process.env.BASE || "http://localhost:8788";
const ADMIN_PW = process.env.ADMIN_PW || "test-pass-123";
const run = Date.now().toString(36);

// LOCAL=1 node tests/e2e.mjs  ← نفس التجربة بدون wrangler (قاعدة مقلّدة في الذاكرة)
if (process.env.LOCAL) {
  const { localServer } = await import("./local.mjs");
  const f = localServer({ ADMIN_PASSWORD: ADMIN_PW }), real = globalThis.fetch;
  globalThis.fetch = (u, i) => String(u).startsWith(BASE) ? f(u, i) : real(u, i);
}

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
for (const p of ["/", "/partner/", "/admin/", "/driver/", "/track/"]) {
  const res = await fetch(BASE + p);
  assert.equal(res.status, 200, p);
}

// اللوحة
r = await admin("GET", "/api/admin/shops"); assert.equal(r.status, 401, "admin needs login");
r = await admin("POST", "/api/admin/login", { password: "wrong" }); assert.equal(r.status, 401);
// كيبورد الجوال العربي: نفس كلمة السر بأرقام عربية ومسافة في الآخر تدخل
r = await client()("POST", "/api/admin/login", { password: ADMIN_PW.replace(/\d/g, d => "٠١٢٣٤٥٦٧٨٩"[d]) + " " }); assert.equal(r.status, 200, "arabic digits in the password");
r = await admin("POST", "/api/admin/login", { password: ADMIN_PW }); assert.equal(r.status, 200, JSON.stringify(r.data));
// الرسوم من الإعدادات (السيرفر ما يصدّق رقم الصفحة)
r = await admin("PUT", "/api/admin/settings", { delivery_fee: "٣", out_fee: 5 }); assert.equal(r.status, 200); assert.equal(r.data.settings.delivery_fee, 3);
r = await admin("PUT", "/api/admin/settings", { delivery_fee: "" }); assert.equal(r.status, 400, "fee can't be blank");
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
r = await shopA("POST", `/api/partner/parts/${partB.id}`, { action: "accept", minutes: 10, bill: 5 }); assert.equal(r.status, 404, "cross-shop blocked");
r = await shopA("POST", `/api/partner/parts/${mineA[0].id}`, { action: "accept", minutes: 15 }); assert.equal(r.status, 400, "only 10/20/30");
r = await shopA("POST", `/api/partner/parts/${mineA[0].id}`, { action: "accept", minutes: 20 }); assert.equal(r.status, 400, "bill required");
r = await shopA("POST", `/api/partner/parts/${mineA[0].id}`, { action: "accept", minutes: 20, bill: "٣٠" }); assert.equal(r.status, 200);
r = await shopA("POST", `/api/partner/parts/${mineA[0].id}`, { action: "accept", minutes: 20, bill: 30 }); assert.equal(r.status, 409, "can't accept twice");
r = await shopA("POST", `/api/partner/parts/${mineA[0].id}`, { action: "ready" }); assert.equal(r.status, 200);
r = await shopB("POST", `/api/partner/parts/${partB.id}`, { action: "reject" }); assert.equal(r.status, 400, "reason required");
r = await shopB("POST", `/api/partner/parts/${partB.id}`, { action: "ready" }); assert.equal(r.status, 400, "ready needs bill");
r = await shopB("POST", `/api/partner/parts/${partB.id}`, { action: "ready", bill: 12 }); assert.equal(r.status, 200);

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

const IMG = "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==";
const dkey = "drv" + run + "x1", dtrack = "trk" + run + "aaaaaaaaaaaa";
r = await anon("POST", "/api/orders", { key: dkey, track: dtrack, code: "4321", order_no: "JL-D-" + run, dest: "chalet", place: "شاليه النخيل", name: "زبون ٢", phone: "0522222222", fee: 5, pack: ["فحم ×١"], parts: [{ shop_id: null, cat: "مطعم", name: "مطعم برا", items: "شاورما" }] });
assert.equal(r.status, 200); const dOrder = r.data.id;
r = await anon("GET", "/api/track/" + dtrack); assert.equal(r.status, 200);
assert.equal(r.data.parts.length, 2, "pack becomes its own bill part"); assert.equal(r.data.stage, "pricing");
assert.ok(!JSON.stringify(r.data).includes("4321"), "tracking API never returns the code");
r = await anon("GET", "/api/track/nope" + run + "zzzzzzzzzz"); assert.equal(r.status, 404);
r = await d1("GET", "/api/driver/orders");
const av = r.data.available.find(o => o.id === dOrder);
assert.ok(av, "new order is available to drivers");
assert.ok(!("customer_phone" in av) && !("customer_name" in av), "no customer data before taking");
assert.ok(!("items" in av.parts[0]), "no items before taking");
r = await d1("POST", `/api/driver/orders/${dOrder}`, { action: "picked" }); assert.equal(r.status, 404, "can't pick before taking");
r = await d1("POST", `/api/driver/orders/${dOrder}`, { action: "take" }); assert.equal(r.status, 200);
r = await d2("POST", `/api/driver/orders/${dOrder}`, { action: "take" }); assert.equal(r.status, 409, "second driver can't take");
r = await d2("GET", "/api/driver/orders"); assert.ok(!r.data.available.some(o => o.id === dOrder), "gone from available");
r = await d1("GET", "/api/driver/orders");
let mineD = r.data.mine.find(o => o.id === dOrder);
assert.equal(mineD.customer_phone, "0522222222"); assert.equal(mineD.parts[0].items, "شاورما");
assert.ok(!("delivery_code" in mineD), "driver never sees the code");
r = await d2("POST", `/api/driver/orders/${dOrder}`, { action: "picked" }); assert.equal(r.status, 404, "other driver can't act");
r = await d1("POST", `/api/driver/orders/${dOrder}`, { action: "release" }); assert.equal(r.status, 200);
r = await d2("GET", "/api/driver/orders"); assert.ok(r.data.available.some(o => o.id === dOrder), "released back");
// صاحب الخدمة يعيّن المندوب ٢
r = await admin("POST", `/api/admin/orders/${dOrder}/driver`, { driver_id: drv2 }); assert.equal(r.status, 200);
r = await d2("GET", "/api/driver/orders"); mineD = r.data.mine.find(o => o.id === dOrder); assert.equal(mineD.driver_status, "assigned");
// ما يشتري قبل الفاتورة والموافقة
r = await d2("POST", `/api/driver/orders/${dOrder}`, { action: "picked" }); assert.equal(r.status, 409, "no buying before bill");
r = await d2("POST", `/api/driver/parts/${mineD.parts[0].id}/bill`, { amount: 40 }); assert.equal(r.status, 400, "photo required");
r = await d2("POST", `/api/driver/parts/${mineD.parts[0].id}/bill`, { amount: 40, image: IMG }); assert.equal(r.status, 200, JSON.stringify(r.data));
r = await d2("POST", `/api/driver/parts/${mineD.parts[1].id}/bill`, { amount: "٢٠", image: IMG }); assert.equal(r.status, 200);
r = await anon("GET", "/api/track/" + dtrack); assert.equal(r.data.stage, "approve"); assert.equal(r.data.total, 60); assert.equal(r.data.collect, 65);
const rid = r.data.parts[0].receipt;
let img = await fetch(BASE + "/api/track/" + dtrack + "/images/" + rid); assert.equal(img.status, 200); assert.match(img.headers.get("content-type"), /image/);
img = await fetch(BASE + "/api/track/" + dtrack + "/images/999999"); assert.equal(img.status, 404);
r = await d2("POST", `/api/driver/orders/${dOrder}`, { action: "picked" }); assert.equal(r.status, 409, "no buying before approval");
r = await anon("POST", "/api/track/" + dtrack, { action: "approve", total: 50 }); assert.equal(r.status, 409, "approve must match current total");
r = await anon("POST", "/api/track/" + dtrack, { action: "approve", total: 60 }); assert.equal(r.status, 200);
// المندوب يغيّر المبلغ بعد الموافقة = موافقة جديدة
r = await d2("POST", `/api/driver/parts/${mineD.parts[0].id}/bill`, { amount: 45, image: IMG }); assert.equal(r.status, 200);
r = await anon("GET", "/api/track/" + dtrack); assert.equal(r.data.stage, "approve", "changed amount needs re-approval");
r = await d2("POST", `/api/driver/orders/${dOrder}`, { action: "picked" }); assert.equal(r.status, 409);
r = await anon("POST", "/api/track/" + dtrack, { action: "approve", total: 65 }); assert.equal(r.status, 200);
r = await d2("POST", `/api/driver/orders/${dOrder}`, { action: "picked" }); assert.equal(r.status, 200);
r = await d2("POST", `/api/driver/parts/${mineD.parts[0].id}/bill`, { amount: 99, image: IMG }); assert.equal(r.status, 409, "no bill change after buying");
r = await anon("POST", "/api/track/" + dtrack, { action: "reject" }); assert.equal(r.status, 409, "can't cancel once bought");
r = await d2("POST", `/api/driver/orders/${dOrder}`, { action: "delivered", code: "0000" }); assert.equal(r.status, 400, "wrong code");
r = await d2("POST", `/api/driver/orders/${dOrder}`, { action: "delivered" }); assert.equal(r.status, 400, "code required");
r = await d2("POST", `/api/driver/orders/${dOrder}`, { action: "delivered", code: "٤٣٢١" }); assert.equal(r.status, 200, "right code (arabic digits)");
r = await anon("GET", "/api/track/" + dtrack); assert.equal(r.data.stage, "delivered");
r = await admin("POST", `/api/admin/orders/${dOrder}/driver`, { driver_id: drv1 }); assert.equal(r.status, 409, "can't reassign delivered");

// الدفع المسبق: فوق الحد لازم تحويل وتأكيد قبل الشراء
r = await admin("PUT", "/api/admin/settings", { prepay_cap: 100, pay_info: "الراجحي SA00", support: "966500000000" }); assert.equal(r.status, 200);
const ptrack = "pre" + run + "bbbbbbbbbbbb";
r = await anon("POST", "/api/orders", { key: "pre" + run + "x9", track: ptrack, code: "1111", order_no: "JL-P-" + run, dest: "home", fee: 3, parts: [{ shop_id: null, cat: "بقالة", name: "بقالة كبيرة", items: "مقاضي" }] });
const pOrder = r.data.id;
r = await d2("POST", `/api/driver/orders/${pOrder}`, { action: "take" }); assert.equal(r.status, 200);
r = await d2("GET", "/api/driver/orders"); const pPart = r.data.mine.find(o => o.id === pOrder).parts[0].id;
r = await d2("POST", `/api/driver/parts/${pPart}/bill`, { amount: 250, image: IMG }); assert.equal(r.status, 200);
r = await anon("POST", "/api/track/" + ptrack, { action: "approve", total: 250 }); assert.equal(r.status, 200);
r = await anon("GET", "/api/track/" + ptrack); assert.equal(r.data.stage, "prepay"); assert.equal(r.data.pay_info, "الراجحي SA00");
r = await d2("POST", `/api/driver/orders/${pOrder}`, { action: "picked" }); assert.equal(r.status, 409, "no buying before prepay");
r = await anon("POST", "/api/track/" + ptrack, { action: "prepay", image: IMG }); assert.equal(r.status, 200);
r = await anon("GET", "/api/track/" + ptrack); assert.equal(r.data.stage, "prepay_check");
r = await d2("POST", `/api/driver/orders/${pOrder}`, { action: "picked" }); assert.equal(r.status, 409, "no buying before owner confirms");
r = await admin("POST", `/api/admin/orders/${pOrder}/prepay`, { action: "confirm" }); assert.equal(r.status, 200);
r = await anon("GET", "/api/track/" + ptrack); assert.equal(r.data.stage, "buying"); assert.equal(r.data.collect, 3, "only delivery fee left");
r = await d2("POST", `/api/driver/orders/${pOrder}`, { action: "picked" }); assert.equal(r.status, 200);
// رمز غلط ٥ مرات يقفل
for (let i = 0; i < 5; i++) await d2("POST", `/api/driver/orders/${pOrder}`, { action: "delivered", code: "9999" });
r = await d2("POST", `/api/driver/orders/${pOrder}`, { action: "delivered", code: "1111" }); assert.equal(r.status, 429, "code guessing locked");
r = await admin("GET", "/api/admin/orders?days=1");
const pa = r.data.orders.find(o => o.id === pOrder); assert.equal(pa.delivery_code, "1111"); assert.equal(pa.stage, "onway");
r = await admin("PUT", "/api/admin/settings", { prepay_cap: 150 }); assert.equal(r.status, 200);

// الزبون يرفض المبلغ = الطلب ينلغي ويطلع من المندوب
const xtrack = "rej" + run + "cccccccccccc";
r = await anon("POST", "/api/orders", { key: "rej" + run + "x8", track: xtrack, order_no: "JL-R-" + run, dest: "home", fee: 3, parts: [{ shop_id: null, cat: "مطعم", name: "مطعم", items: "عشا" }] });
const xOrder = r.data.id;
r = await d1("POST", `/api/driver/orders/${xOrder}`, { action: "take" }); assert.equal(r.status, 200);
r = await d1("GET", "/api/driver/orders"); const xPart = r.data.mine.find(o => o.id === xOrder).parts[0].id;
r = await d1("POST", `/api/driver/parts/${xPart}/bill`, { amount: 80, image: IMG }); assert.equal(r.status, 200);
r = await anon("POST", "/api/track/" + xtrack, { action: "reject" }); assert.equal(r.status, 200);
r = await d1("GET", "/api/driver/orders"); assert.equal(r.data.mine.find(o => o.id === xOrder).driver_status, "cancelled");
r = await d1("POST", `/api/driver/orders/${xOrder}`, { action: "picked" }); assert.equal(r.status, 409, "can't buy a cancelled order");
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

// ===== التقييم، البلاغات، التسليم عند الباب، المحفظة =====
r = await anon("GET", "/api/track/" + dtrack);
assert.equal(r.data.rating, null);
r = await anon("POST", "/api/track/" + dtrack, { action: "rate", driver_stars: 7 }); assert.equal(r.status, 400, "stars 1-5");
r = await anon("POST", "/api/track/" + dtrack, { action: "rate", driver_stars: 4, tags: ["وصل بسرعة", "مزيف"], comment: "شكراً" }); assert.equal(r.status, 200);
r = await anon("POST", "/api/track/" + dtrack, { action: "rate", driver_stars: 1 }); assert.equal(r.status, 409, "rate once");
r = await anon("GET", "/api/track/" + dtrack); assert.equal(r.data.rating.driver_stars, 4); assert.deepEqual(r.data.rating.tags, ["وصل بسرعة"]);
r = await anon("POST", "/api/track/" + ptrack, { action: "rate", driver_stars: 5 }); assert.equal(r.status, 409, "can't rate before delivery");
r = await anon("POST", "/api/track/" + dtrack, { action: "report", kind: "مزيف" }); assert.equal(r.status, 400);
r = await anon("POST", "/api/track/" + dtrack, { action: "report", kind: "ناقص غرض", note: "ناقص فحم", image: IMG }); assert.equal(r.status, 200);
r = await anon("GET", "/api/track/" + dtrack); assert.equal(r.data.reports.length, 1); assert.equal(r.data.reports[0].status, "open");
r = await admin("GET", "/api/admin/reports?status=open");
const rep1 = r.data.reports.find(x => x.order_no === "JL-D-" + run); assert.ok(rep1 && r.data.open >= 1);
assert.equal(rep1.driver_name, "مندوب ٢");
r = await admin("POST", `/api/admin/reports/${rep1.id}`, { resolution: "رجّعنا لك قيمة الفحم" }); assert.equal(r.status, 200);
r = await admin("POST", `/api/admin/reports/${rep1.id}`, { resolution: "x" }); assert.equal(r.status, 404, "already resolved");
r = await anon("GET", "/api/track/" + dtrack); assert.equal(r.data.reports[0].resolution, "رجّعنا لك قيمة الفحم");
r = await admin("GET", "/api/admin/drivers");
let dd = r.data.drivers.find(d => d.id === drv2);
assert.equal(dd.rating.avg, 4); assert.equal(dd.reports.count, 1); assert.equal(dd.reports.open, 0);
// محفظة المندوب ٢: dOrder (توصيل ٥، نصيبه ١٠٠٪) = صافي. نصيبه ٥٠٪ للطلبات الجاية
assert.equal(dd.wallet.balance, 0);
r = await admin("PUT", "/api/admin/settings", { driver_share: 50 }); assert.equal(r.status, 200);
// طلب عند الباب
r = await admin("PUT", "/api/admin/settings", { delivery_fee: 4 }); assert.equal(r.status, 200);
const gtrack = "dor" + run + "dddddddddddd";
r = await anon("POST", "/api/orders", { key: "dor" + run + "x7", track: gtrack, code: "2468", order_no: "JL-G-" + run, dest: "home", fee: 4, parts: [{ shop_id: null, cat: "بقالة", name: "بقالة", items: "ماء" }] });
const gOrder = r.data.id;
r = await d2("POST", `/api/driver/orders/${gOrder}`, { action: "take" }); assert.equal(r.status, 200);
r = await d2("GET", "/api/driver/orders"); const gPart = r.data.mine.find(o => o.id === gOrder).parts[0].id;
r = await d2("POST", `/api/driver/parts/${gPart}/bill`, { amount: 10, image: IMG }); assert.equal(r.status, 200);
r = await anon("POST", "/api/track/" + gtrack, { action: "approve", total: 10 }); assert.equal(r.status, 200);
r = await anon("GET", "/api/track/" + gtrack); assert.ok(r.data.eta > Date.now(), "eta while buying");
r = await d2("POST", `/api/driver/orders/${gOrder}`, { action: "picked" }); assert.equal(r.status, 200);
r = await anon("GET", "/api/track/" + gtrack); assert.ok(r.data.eta > Date.now(), "eta while on the way");
r = await d2("POST", `/api/driver/orders/${gOrder}`, { action: "delivered", image: IMG }); assert.equal(r.status, 403, "no door photo unless customer asked");
r = await anon("POST", "/api/track/" + gtrack, { action: "door", on: true }); assert.equal(r.status, 200);
r = await d2("GET", "/api/driver/orders"); assert.equal(r.data.mine.find(o => o.id === gOrder).leave_at_door, true);
r = await d2("POST", `/api/driver/orders/${gOrder}`, { action: "delivered", image: IMG }); assert.equal(r.status, 200);
r = await anon("GET", "/api/track/" + gtrack); assert.equal(r.data.stage, "delivered"); assert.ok(r.data.order.delivery_photo, "customer sees the door photo");
// المندوب حصّل ٤ توصيل، نصيبه ٢ → عليه ٢ لصاحب الخدمة
r = await d2("GET", "/api/driver/wallet"); assert.equal(r.data.wallet.balance, 2);
r = await d2("GET", "/api/driver/summary"); assert.equal(r.data.today.earned, 7); assert.equal(r.data.rating.avg, 4);
r = await admin("POST", `/api/admin/drivers/${drv2}/settle`, { direction: "in", amount: "٢" }); assert.equal(r.status, 200); assert.equal(r.data.wallet.balance, 0);
r = await admin("POST", `/api/admin/drivers/${drv2}/settle`, { direction: "sideways", amount: 2 }); assert.equal(r.status, 400);
r = await d2("GET", "/api/driver/wallet"); assert.equal(r.data.history.length, 1); assert.equal(r.data.history[0].amount, 2);
r = await admin("PUT", "/api/admin/settings", { driver_share: 100 }); assert.equal(r.status, 200);
// كود خصم: الزبون دفع ٤ بدل ٨، والمندوب ياخذ نصيبه من الـ ٨ كاملة → صاحب الخدمة عليه ٤ للمندوب
r = await admin("PUT", "/api/admin/settings", { delivery_fee: 8 }); assert.equal(r.status, 200);
r = await admin("POST", "/api/admin/promos", { code: "half", discount: 50, per_phone: 1 }); assert.equal(r.status, 200, JSON.stringify(r.data));
r = await admin("POST", "/api/admin/promos", { code: "HALF", discount: 10 }); assert.equal(r.status, 409, "duplicate promo");
r = await anon("POST", "/api/promo", { code: "half", phone: "0599999999" }); assert.equal(r.data.ok, true); assert.equal(r.data.discount, 0.5);
r = await anon("POST", "/api/promo", { code: "nope", phone: "0599999999" }); assert.equal(r.data.ok, false);
const qtrack = "pro" + run + "qqqqqqqqqqqq";
r = await anon("POST", "/api/orders", { key: "pro" + run + "x6", track: qtrack, code: "1357", order_no: "JL-Q-" + run, dest: "home", fee: 0, fee_full: 0, promo: "HALF", phone: "+966 59 999 9999", parts: [{ shop_id: null, cat: "بقالة", name: "بقالة", items: "خبز" }] });
const qOrder = r.data.id; assert.equal(r.data.fee, 4, "server applies the promo, ignores the page's fee"); assert.equal(r.data.fee_full, 8);
// نفس الرقم بصيغة ثانية: الكود مستخدم
r = await anon("POST", "/api/promo", { code: "half", phone: "٠٥٩٩٩٩٩٩٩٩" }); assert.equal(r.data.ok, false, "once per phone");
r = await anon("POST", "/api/orders", { key: "pro" + run + "x5", order_no: "JL-Q2-" + run, dest: "home", promo: "HALF", phone: "0599999999", parts: [{ shop_id: null, cat: "بقالة", name: "بقالة", items: "خبز" }] });
assert.equal(r.data.fee, 8, "second use of the promo pays full"); assert.equal(r.data.promo, "");
r = await d2("POST", `/api/driver/orders/${qOrder}`, { action: "take" }); assert.equal(r.status, 200);
r = await d2("GET", "/api/driver/orders"); const qPart = r.data.mine.find(o => o.id === qOrder).parts[0].id;
r = await d2("POST", `/api/driver/parts/${qPart}/bill`, { amount: 10, image: IMG }); assert.equal(r.status, 200);
r = await anon("POST", "/api/track/" + qtrack, { action: "approve", total: 10 }); assert.equal(r.status, 200);
r = await d2("POST", `/api/driver/orders/${qOrder}`, { action: "picked" }); assert.equal(r.status, 200);
r = await d2("POST", `/api/driver/orders/${qOrder}`, { action: "delivered", code: "1357" }); assert.equal(r.status, 200);
r = await d2("GET", "/api/driver/wallet"); assert.equal(r.data.wallet.balance, -4, "promo discount is on the owner, not the driver");
r = await admin("POST", `/api/admin/drivers/${drv2}/settle`, { direction: "out", amount: 4 }); assert.equal(r.status, 200); assert.equal(r.data.wallet.balance, 0);
// موقع المحل
r = await admin("PUT", `/api/admin/shops/${idA}`, { map_url: "not a link" }); assert.equal(r.status, 400);
r = await admin("PUT", `/api/admin/shops/${idA}`, { map_url: "https://maps.google.com/?q=1,1" }); assert.equal(r.status, 200);
r = await admin("GET", "/api/admin/shops"); assert.equal(r.data.shops.find(s => s.id === idA).map_url, "https://maps.google.com/?q=1,1");

// إيقاف المندوب يطلّعه
r = await admin("PUT", `/api/admin/drivers/${drv1}`, { active: false }); assert.equal(r.status, 200);
r = await d1("GET", "/api/driver/orders"); assert.equal(r.status, 401);

// قفل بعد ٥ محاولات غلط
const lock = client();
for (let i = 0; i < 5; i++) await lock("POST", "/api/partner/login", { code: codeA, pin: "0000" });
r = await lock("POST", "/api/partner/login", { code: codeA, pin: "3333" }); assert.equal(r.status, 429, "locked after 5 fails");

console.log("✔ all end-to-end checks passed");
