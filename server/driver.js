// تطبيق المندوب: يشوف الطلبات اللي ما لها مندوب ويأخذ منها، ويشوف تفاصيل الزبون بس للطلبات اللي معه
// ما يقدر يشتري قبل موافقة الزبون على المبلغ (والدفع المسبق لو لازم)، وما يقدر يسكّر الطلب بدون رمز الاستلام
import { HttpError, json, readJson, str, riyadhRanges, cleanCode } from "./util.js";
import { checkLock, recordFail, clearFails, createSession, sessionCookie, requireSession, endSession, verifyPin } from "./auth.js";
import { getSettings, summarize, loadOrder, parseImage, saveImage, sendImage } from "./flow.js";

const ip = r => r.headers.get("cf-connecting-ip") || "local";
const H = 3600_000;
const toEn = s => String(s).replace(/[٠-٩]/g, d => "٠١٢٣٤٥٦٧٨٩".indexOf(d));

// الطلب "حي" لو فيه جزء واحد على الأقل ما انلغى ولا انرفض
const LIVE = `(o.rejected_at IS NULL AND EXISTS (SELECT 1 FROM parts x WHERE x.order_id = o.id AND x.status NOT IN ('cancelled','rejected')))`;

function driverInfo(d) {
  return { name: d.name, code: d.code, phone: d.phone };
}

export async function login(db, request) {
  const b = await readJson(request);
  const code = cleanCode(b.code) || str(b.code, 40).toLowerCase();
  const pin = toEn(str(b.pin, 20));
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

async function partsFor(db, ids) {
  const by = new Map(ids.map(id => [id, []]));
  if (!ids.length) return by;
  const { results } = await db.prepare(`SELECT id, order_id, shop_id, shop_name, category, items, status, prep_minutes, accepted_at, ready_at, bill, bill_receipt
    FROM parts WHERE order_id IN (${ids.map(() => "?").join(",")}) ORDER BY id`).bind(...ids).all();
  for (const p of results) by.get(p.order_id).push(p);
  return by;
}

const safeParse = s => { try { return JSON.parse(s || "[]"); } catch { return []; } };

// الطلبات المتاحة (بدون بيانات الزبون ولا تفاصيل الأغراض) + طلباتي (كاملة)
export async function orders(db, request) {
  const s = await requireSession(db, request, "driver");
  const now = Date.now();
  const settings = await getSettings(db);
  const { results: avail } = await db.prepare(`
    SELECT o.id, o.order_no, o.created_at, o.dest, o.place, o.fee FROM orders o
    WHERE o.driver_id IS NULL AND o.created_at > ? AND ${LIVE}
    ORDER BY o.created_at DESC LIMIT 50`).bind(now - 12 * H).all();
  const { results: mine } = await db.prepare(`
    SELECT o.* FROM orders o
    WHERE o.driver_id = ? AND (o.driver_status IN ('assigned','picked')
      OR (o.driver_status = 'delivered' AND o.delivered_at > ?) OR (o.driver_status = 'cancelled' AND o.rejected_at > ?))
    ORDER BY o.created_at DESC LIMIT 100`).bind(s.driver.id, now - 24 * H, now - 24 * H).all();
  const pa = await partsFor(db, avail.map(o => o.id));
  const pm = await partsFor(db, mine.map(o => o.id));
  const brief = p => ({ shop_name: p.shop_name, category: p.category, status: p.status, prep_minutes: p.prep_minutes, accepted_at: p.accepted_at, ready_at: p.ready_at, partner: !!p.shop_id });
  return json({
    driver: driverInfo(s.driver), now,
    available: avail.map(o => ({ ...o, parts: pa.get(o.id).map(brief) })),
    mine: mine.map(o => {
      const parts = pm.get(o.id);
      return {
        id: o.id, order_no: o.order_no, created_at: o.created_at, dest: o.dest, place: o.place, fee: o.fee,
        customer_name: o.customer_name, customer_phone: o.customer_phone, map_url: o.map_url, pay: o.pay, note: o.note,
        pack: safeParse(o.pack), driver_status: o.driver_status, assigned_at: o.assigned_at, picked_at: o.picked_at, delivered_at: o.delivered_at,
        prepay_status: o.prepay_status, leave_at_door: !!o.leave_at_door,
        parts: parts.map(p => ({ ...brief(p), id: p.id, items: p.items, bill: p.bill, receipt: p.bill_receipt })),
        ...summarize(o, parts, settings),
      };
    }),
  });
}

async function myOrder(db, s, orderId) {
  const x = await loadOrder(db, "id", orderId);
  if (!x || x.o.driver_id !== s.driver.id) throw new HttpError(404, "الطلب مو معك");
  return x;
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
    // "اشتريت واستلمت": بس بعد ما الزبون يوافق على المبلغ ويخلص الدفع المسبق لو لازم
    const { o, parts } = await myOrder(db, s, orderId);
    const sum = summarize(o, parts, await getSettings(db));
    if (o.driver_status === "assigned") {
      if (!sum.billed) throw new HttpError(409, "باقي مبلغ فاتورة لمحل، اكتبه أول");
      if (!sum.approved) throw new HttpError(409, "انتظر موافقة الزبون على المبلغ قبل لا تدفع");
      if (!sum.canBuy) throw new HttpError(409, "الطلب يحتاج دفع مسبق، انتظر تأكيد التحويل قبل لا تدفع");
    }
    stmt = db.prepare("UPDATE orders SET driver_status='picked', picked_at=? WHERE id=? AND driver_id=? AND driver_status='assigned'").bind(now, orderId, me);
  } else if (b.action === "delivered") {
    const { o } = await myOrder(db, s, orderId);
    if (o.driver_status !== "picked") throw new HttpError(409, "اضغط \"اشتريت واستلمت\" أول");
    let photo = null;
    if (b.image) {
      // التسليم بصورة عند الباب: بس لو الزبون نفسه طلب كذا من صفحة المتابعة
      if (!o.leave_at_door) throw new HttpError(403, "الزبون ما طلب يتركه عند الباب، اطلب منه رمز الاستلام");
      photo = await saveImage(db, o.id, "door", parseImage(b.image));
    } else {
      const keys = [`dcode:${orderId}`];
      await checkLock(db, keys);
      const code = toEn(str(b.code, 8));
      if (!o.delivery_code || code !== o.delivery_code) {
        await recordFail(db, keys, [5]);
        throw new HttpError(400, "رمز الاستلام غلط. اطلبه من الزبون");
      }
      await clearFails(db, keys);
    }
    // نصيب المندوب ينحفظ لحظة التسليم، عشان لو تغيّرت النسبة بعدين ما تتغيّر الحسابات القديمة
    const { driver_share } = await getSettings(db);
    const share = Math.round((Number(o.fee) || 0) * driver_share) / 100;
    stmt = db.prepare("UPDATE orders SET driver_status='delivered', delivered_at=?, delivery_photo=?, driver_share=? WHERE id=? AND driver_id=? AND driver_status='picked'")
      .bind(now, photo, share, orderId, me);
  } else throw new HttpError(400, "إجراء غير معروف");
  const r = await stmt.run();
  if (!r.meta.changes) {
    if (b.action === "take") throw new HttpError(409, "مندوب ثاني أخذ الطلب قبلك");
    throw new HttpError(409, "حالة الطلب تغيّرت، حدّث الصفحة");
  }
  return json({ ok: true });
}

// المندوب يكتب مبلغ فاتورة محل مو شريك (أو التجهيزات) ويرفع صورتها
export async function setBill(db, request, partId) {
  const s = await requireSession(db, request, "driver");
  const b = await readJson(request, 1_000_000);
  const p = await db.prepare("SELECT * FROM parts WHERE id = ?").bind(partId).first();
  if (!p) throw new HttpError(404, "الجزء مو موجود");
  const { o } = await myOrder(db, s, p.order_id);
  if (o.driver_status !== "assigned") throw new HttpError(409, "ما تقدر تغيّر الفاتورة بعد ما اشتريت");
  if (p.shop_id) throw new HttpError(403, "فاتورة المحل الشريك يكتبها المحل نفسه");
  if (["cancelled", "rejected"].includes(p.status)) throw new HttpError(409, "هالجزء ملغي");
  const amount = Number(toEn(b.amount));
  if (!Number.isFinite(amount) || amount <= 0 || amount > 100000) throw new HttpError(400, "اكتب مبلغ الفاتورة");
  const img = parseImage(b.image);
  const rid = await saveImage(db, o.id, "bill", img);
  await db.prepare("UPDATE parts SET bill=?, bill_receipt=?, updated_at=? WHERE id=?").bind(Math.round(amount * 100) / 100, rid, Date.now(), partId).run();
  return json({ ok: true });
}

export async function image(db, request, id) {
  const s = await requireSession(db, request, "driver");
  const r = await db.prepare("SELECT order_id FROM receipts WHERE id = ?").bind(id).first();
  if (!r) throw new HttpError(404, "الصورة مو موجودة");
  await myOrder(db, s, r.order_id);
  return sendImage(db, r.order_id, id);
}

export async function summary(db, request) {
  const s = await requireSession(db, request, "driver");
  const { weekStart, monthStart, dayStart } = riyadhRanges(Date.now());
  const q = start => db.prepare("SELECT COUNT(*) AS n, COALESCE(SUM(fee),0) AS f, COALESCE(SUM(COALESCE(driver_share, fee)),0) AS e FROM orders WHERE driver_id = ? AND driver_status = 'delivered' AND delivered_at >= ?").bind(s.driver.id, start);
  const [d, w, m] = await db.batch([q(dayStart), q(weekStart), q(monthStart)]);
  const pick = x => ({ count: x.results[0].n, fees: x.results[0].f, earned: x.results[0].e });
  const rating = await driverRating(db, s.driver.id);
  const wallet = await walletFor(db, s.driver.id);
  return json({ driver: driverInfo(s.driver), today: pick(d), week: pick(w), month: pick(m), rating, wallet });
}

export async function driverRating(db, id) {
  const r = await db.prepare("SELECT COUNT(*) AS n, AVG(driver_stars) AS avg FROM ratings WHERE driver_id = ?").bind(id).first();
  return { count: r.n, avg: r.avg ? Math.round(r.avg * 10) / 10 : null };
}

// المحفظة: لكل طلب وصّله، صاحب الخدمة له (رسوم التوصيل − نصيب المندوب)، وعليه المبلغ المحوّل مسبقاً
// (لأن الزبون حوّله لصاحب الخدمة والمندوب دفعه للمحل من جيبه). التسويات تنقص من الرصيد.
// الرصيد الموجب = المندوب عليه يسلّم صاحب الخدمة، السالب = صاحب الخدمة عليه يسلّم المندوب
export async function walletFor(db, id) {
  const o = await db.prepare(`SELECT COUNT(*) AS n,
      COALESCE(SUM(COALESCE(fee,0)),0) AS fees,
      COALESCE(SUM(COALESCE(driver_share, fee, 0)),0) AS earned,
      COALESCE(SUM(CASE WHEN prepay_status='confirmed' THEN COALESCE(prepay_amount,0) ELSE 0 END),0) AS prepaid
    FROM orders WHERE driver_id = ? AND driver_status = 'delivered'`).bind(id).first();
  const st = await db.prepare("SELECT COALESCE(SUM(amount),0) AS s FROM settlements WHERE driver_id = ?").bind(id).first();
  const owed = (o.fees - o.earned) - o.prepaid;
  const r2 = v => Math.round(v * 100) / 100;
  return { deliveries: o.n, fees: r2(o.fees), earned: r2(o.earned), prepaid: r2(o.prepaid), settled: r2(st.s), balance: r2(owed - st.s) };
}

export async function wallet(db, request) {
  const s = await requireSession(db, request, "driver");
  const w = await walletFor(db, s.driver.id);
  const { results: history } = await db.prepare("SELECT amount, note, created_at FROM settlements WHERE driver_id = ? ORDER BY id DESC LIMIT 30").bind(s.driver.id).all();
  return json({ wallet: w, history });
}
