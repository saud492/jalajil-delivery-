// تطبيق المندوب: يشوف الطلبات اللي ما لها مندوب ويأخذ منها، ويشوف تفاصيل الزبون بس للطلبات اللي معه
import { HttpError, json, readJson, str, riyadhRanges, cleanCode } from "./util.js";
import { checkLock, recordFail, clearFails, createSession, sessionCookie, requireSession, endSession, verifyPin } from "./auth.js";

const ip = r => r.headers.get("cf-connecting-ip") || "local";
const H = 3600_000;

// الطلب "حي" لو فيه جزء واحد على الأقل ما انلغى ولا انرفض، أو ما فيه أجزاء أصلاً (تجهيزات بس)
const LIVE = `(NOT EXISTS (SELECT 1 FROM parts x WHERE x.order_id = o.id)
  OR EXISTS (SELECT 1 FROM parts x WHERE x.order_id = o.id AND x.status NOT IN ('cancelled','rejected')))`;

function driverInfo(d) {
  return { name: d.name, code: d.code, phone: d.phone };
}

export async function login(db, request) {
  const b = await readJson(request);
  const code = cleanCode(b.code) || str(b.code, 40).toLowerCase();
  const pin = str(b.pin, 20).replace(/[٠-٩]/g, d => "٠١٢٣٤٥٦٧٨٩".indexOf(d));
  if (!code || !pin) throw new HttpError(400, "اكتب رمز المندوب والرقم السري");
  const keys = [`driver:${code}:${ip(request)}`, `driver:${code}`];
  await checkLock(db, keys);
  const d = await db.prepare("SELECT * FROM drivers WHERE code = ? AND active = 1").bind(code).first();
  if (!d || !(await verifyPin(pin, d.pin_hash, d.pin_salt))) {
    await recordFail(db, keys, [5, 20]);
    throw new HttpError(401, "رمز المندوب أو الرقم السري غلط");
  }
  await clearFails(db, keys);
  const token = await createSession(db, "driver", d.id);
  return json({ ok: true, driver: driverInfo(d) }, 200, { "set-cookie": sessionCookie("driver", token) });
}

export async function logout(db, request) {
  await endSession(db, request, "driver");
  return json({ ok: true }, 200, { "set-cookie": sessionCookie("driver", null) });
}

export async function me(db, request) {
  const s = await requireSession(db, request, "driver");
  return json({ driver: driverInfo(s.driver) });
}

async function partsFor(db, ids, full) {
  const by = new Map(ids.map(id => [id, []]));
  if (!ids.length) return by;
  const cols = full ? "order_id, shop_name, category, items, status, prep_minutes, accepted_at, ready_at"
                    : "order_id, shop_name, category, status, prep_minutes, accepted_at, ready_at";
  const { results } = await db.prepare(`SELECT ${cols} FROM parts WHERE order_id IN (${ids.map(() => "?").join(",")}) ORDER BY id`).bind(...ids).all();
  for (const p of results) by.get(p.order_id).push(p);
  return by;
}

const safeParse = s => { try { return JSON.parse(s || "[]"); } catch { return []; } };

// الطلبات المتاحة (بدون بيانات الزبون) + طلباتي (كاملة)
export async function orders(db, request) {
  const s = await requireSession(db, request, "driver");
  const now = Date.now();
  const { results: avail } = await db.prepare(`
    SELECT o.id, o.order_no, o.created_at, o.dest, o.place, o.fee FROM orders o
    WHERE o.driver_id IS NULL AND o.created_at > ? AND ${LIVE}
    ORDER BY o.created_at DESC LIMIT 50`).bind(now - 12 * H).all();
  const { results: mine } = await db.prepare(`
    SELECT o.id, o.order_no, o.created_at, o.dest, o.place, o.fee, o.customer_name, o.customer_phone, o.map_url, o.pay, o.note, o.pack,
           o.driver_status, o.assigned_at, o.picked_at, o.delivered_at
    FROM orders o
    WHERE o.driver_id = ? AND (o.driver_status != 'delivered' OR o.delivered_at > ?)
    ORDER BY o.created_at DESC LIMIT 100`).bind(s.driver.id, now - 24 * H).all();
  const pa = await partsFor(db, avail.map(o => o.id), false);
  const pm = await partsFor(db, mine.map(o => o.id), true);
  return json({
    driver: driverInfo(s.driver), now,
    available: avail.map(o => ({ ...o, parts: pa.get(o.id) })),
    mine: mine.map(o => ({ ...o, pack: safeParse(o.pack), parts: pm.get(o.id) })),
  });
}

export async function act(db, request, orderId) {
  const s = await requireSession(db, request, "driver");
  const b = await readJson(request);
  const now = Date.now(), me = s.driver.id;
  let stmt;
  if (b.action === "take") {
    stmt = db.prepare(`UPDATE orders AS o SET driver_id=?, driver_status='assigned', assigned_at=?, picked_at=NULL, delivered_at=NULL
      WHERE o.id=? AND o.driver_id IS NULL AND ${LIVE}`).bind(me, now, orderId);
  } else if (b.action === "release") {
    stmt = db.prepare("UPDATE orders SET driver_id=NULL, driver_status=NULL, assigned_at=NULL WHERE id=? AND driver_id=? AND driver_status='assigned'").bind(orderId, me);
  } else if (b.action === "picked") {
    stmt = db.prepare("UPDATE orders SET driver_status='picked', picked_at=? WHERE id=? AND driver_id=? AND driver_status='assigned'").bind(now, orderId, me);
  } else if (b.action === "delivered") {
    stmt = db.prepare("UPDATE orders SET driver_status='delivered', delivered_at=?, picked_at=COALESCE(picked_at, ?) WHERE id=? AND driver_id=? AND driver_status IN ('assigned','picked')").bind(now, now, orderId, me);
  } else throw new HttpError(400, "إجراء غير معروف");
  const r = await stmt.run();
  if (!r.meta.changes) {
    if (b.action === "take") throw new HttpError(409, "مندوب ثاني أخذ الطلب قبلك");
    throw new HttpError(409, "حالة الطلب تغيّرت، حدّث الصفحة");
  }
  return json({ ok: true });
}

export async function summary(db, request) {
  const s = await requireSession(db, request, "driver");
  const { weekStart, monthStart, dayStart } = riyadhRanges(Date.now());
  const q = start => db.prepare("SELECT COUNT(*) AS n, COALESCE(SUM(fee),0) AS f FROM orders WHERE driver_id = ? AND driver_status = 'delivered' AND delivered_at >= ?").bind(s.driver.id, start);
  const [d, w, m] = await db.batch([q(dayStart), q(weekStart), q(monthStart)]);
  const pick = x => ({ count: x.results[0].n, fees: x.results[0].f });
  return json({ driver: driverInfo(s.driver), today: pick(d), week: pick(w), month: pick(m) });
}
