// تطبيق الشريك: كل استعلام مربوط برقم المحل من الجلسة، فما يقدر محل يشوف طلبات غيره
import { HttpError, json, readJson, str, commissionFor, riyadhRanges, riyadhSpan, cleanCode, shopOpen } from "./util.js";
import { snapshot, changed, subscribe } from "./alerts.js";
import { checkLock, recordFail, clearFails, createSession, sessionCookie, requireSession, endSession, verifyPin } from "./auth.js";

const ip = r => r.headers.get("cf-connecting-ip") || "local";

function shopInfo(s) {
  const open = shopOpen(s);
  return { id: s.id, name: s.name, category: s.category, open, closed_until: !open && s.closed_until ? s.closed_until : null, code: s.code, trial_end: s.trial_end, commission: s.commission,
    offer: s.offer_min ? { min: s.offer_min, text: s.offer_text || "" } : null, featured: !!s.featured };
}

export async function login(db, request) {
  const b = await readJson(request);
  const code = cleanCode(b.code) || str(b.code, 40).toLowerCase();
  const pin = str(b.pin, 20).replace(/[٠-٩]/g, d => "٠١٢٣٤٥٦٧٨٩".indexOf(d));
  if (!code || !pin) throw new HttpError(400, "اكتب رمز المحل والرقم السري");
  const keys = [`shop:${code}:${ip(request)}`, `shop:${code}`];
  await checkLock(db, keys);
  const shop = await db.prepare("SELECT * FROM shops WHERE code = ? AND active = 1").bind(code).first();
  if (!shop || !(await verifyPin(pin, shop.pin_hash, shop.pin_salt))) {
    await recordFail(db, keys, [5, 20]);
    throw new HttpError(401, "رمز المحل أو الرقم السري غلط");
  }
  await clearFails(db, keys);
  const token = await createSession(db, "shop", shop.id);
  return json({ ok: true, shop: shopInfo(shop) }, 200, { "set-cookie": sessionCookie("shop", token) });
}

export async function logout(db, request) {
  await endSession(db, request, "shop");
  return json({ ok: true }, 200, { "set-cookie": sessionCookie("shop", null) });
}

export async function me(db, request) {
  const s = await requireSession(db, request, "shop");
  return json({ shop: shopInfo(s.shop) });
}

// الطلبات المفتوحة + اللي انتهت آخر ٢٤ ساعة
export async function orders(db, request) {
  const s = await requireSession(db, request, "shop");
  const since = Date.now() - 24 * 3600_000;
  const { results } = await db.prepare(`
    SELECT p.id, p.items, p.status, p.prep_minutes, p.reject_reason, p.accepted_at, p.ready_at, p.updated_at, p.bill, p.shop_note,
           o.order_no, o.created_at, o.dest, o.customer_name, o.customer_phone, o.place, o.pay, o.note
    FROM parts p JOIN orders o ON o.id = p.order_id
    WHERE p.shop_id = ? AND o.blocked IS NULL AND (p.status IN ('new','accepted') OR p.updated_at > ?)
    ORDER BY o.created_at DESC LIMIT 200`).bind(s.shop.id, since).all();
  return json({ shop: shopInfo(s.shop), orders: results, now: Date.now() });
}

const FROM = { accept: ["new"], ready: ["new", "accepted"], reject: ["new", "accepted"] };
export const PREP = [5, 10, 15, 20, 30, 45];

export async function push(db, request) {
  const s = await requireSession(db, request, "shop");
  return subscribe(db, request, "shop", s.shop.id);
}

export async function act(db, request, partId, e = {}) {
  const s = await requireSession(db, request, "shop");
  const own = await db.prepare("SELECT order_id FROM parts WHERE id = ? AND shop_id = ?").bind(partId, s.shop.id).first();
  const before = own && await snapshot(db, own.order_id);
  const b = await readJson(request);
  const action = b.action;
  if (!FROM[action]) throw new HttpError(400, "إجراء غير معروف");
  const now = Date.now();
  const allowed = FROM[action].map(x => `'${x}'`).join(",");
  // مبلغ الفاتورة يكتبه المحل نفسه، عشان المندوب ما يقدر يزوّده على الزبون
  const bill = b.bill === undefined || b.bill === "" ? null : Number(String(b.bill).replace(/[٠-٩]/g, d => "٠١٢٣٤٥٦٧٨٩".indexOf(d)));
  if (bill !== null && (!Number.isFinite(bill) || bill <= 0 || bill > 100000)) throw new HttpError(400, "مبلغ الفاتورة غير صحيح");
  let stmt;
  if (action === "accept") {
    const m = Number(b.minutes);
    if (!PREP.includes(m)) throw new HttpError(400, "اختر وقت التجهيز");
    if (bill === null) throw new HttpError(400, "اكتب مبلغ الفاتورة");
    // «خلص كذا، والبديل كذا»: تنكتب مع الفاتورة بس، وبعد القبول الفاتورة تنقفل
    const note = str(b.note, 200) || null;
    stmt = db.prepare(`UPDATE parts SET status='accepted', prep_minutes=?, accepted_at=?, bill=?, shop_note=?, updated_at=? WHERE id=? AND shop_id=? AND status IN (${allowed})`)
      .bind(m, now, Math.round(bill * 100) / 100, note, now, partId, s.shop.id);
  } else if (action === "ready") {
    // الفاتورة ما تتغيّر بعد القبول: «جاهز» يكتب الفاتورة بس لو المحل ما كتبها من قبل (طلب ضغط عليه جاهز على طول)
    stmt = db.prepare(`UPDATE parts SET status='ready', ready_at=?, commission=?, bill=COALESCE(bill, ?), updated_at=? WHERE id=? AND shop_id=? AND status IN (${allowed}) AND COALESCE(bill, ?) IS NOT NULL`)
      .bind(now, commissionFor(s.shop, now), bill, now, partId, s.shop.id, bill);
  } else {
    const reason = str(b.reason, 120);
    if (!reason) throw new HttpError(400, "اختر سبب الرفض");
    stmt = db.prepare(`UPDATE parts SET status='rejected', reject_reason=?, updated_at=? WHERE id=? AND shop_id=? AND status IN (${allowed})`)
      .bind(reason, now, partId, s.shop.id);
  }
  const r = await stmt.run();
  if (!r.meta.changes) {
    const p = await db.prepare("SELECT status, bill FROM parts WHERE id = ? AND shop_id = ?").bind(partId, s.shop.id).first();
    if (!p) throw new HttpError(404, "الطلب مو موجود");
    if (action === "ready" && p.bill === null && FROM.ready.includes(p.status)) throw new HttpError(400, "اكتب مبلغ الفاتورة");
    throw new HttpError(409, "حالة الطلب تغيّرت، حدّث الصفحة");
  }
  await changed(e, db, before);
  return json({ ok: true });
}

export async function setOpen(db, request) {
  const s = await requireSession(db, request, "shop");
  const b = await readJson(request);
  if (b.open) {
    await db.prepare("UPDATE shops SET is_open = 1, closed_until = NULL WHERE id = ?").bind(s.shop.id).run();
    return json({ ok: true, open: true, closed_until: null });
  }
  // زحمة: مسكّر نص ساعة أو ساعة أو ساعتين، ويفتح لحاله. بدون مدة = لين يفتحه بنفسه
  const m = b.minutes === undefined || b.minutes === null ? null : Number(b.minutes);
  if (m !== null && ![30, 60, 120].includes(m)) throw new HttpError(400, "اختر مدة الإغلاق");
  const until = m ? Date.now() + m * 60_000 : null;
  await db.prepare("UPDATE shops SET is_open = 0, closed_until = ? WHERE id = ?").bind(until, s.shop.id).run();
  return json({ ok: true, open: false, closed_until: until });
}

export async function summary(db, request) {
  const s = await requireSession(db, request, "shop");
  const { weekStart, monthStart } = riyadhRanges(Date.now());
  const q = start => db.prepare("SELECT COUNT(*) AS n, COALESCE(SUM(commission),0) AS c FROM parts WHERE shop_id = ? AND status = 'ready' AND ready_at >= ?").bind(s.shop.id, start);
  const [w, m] = await db.batch([q(weekStart), q(monthStart)]);
  return json({
    shop: shopInfo(s.shop),
    rating: await shopRating(db, s.shop.id),
    week: { count: w.results[0].n, commission: w.results[0].c },
    month: { count: m.results[0].n, commission: m.results[0].c },
  });
}

// السجل وكشف الحساب لأي فترة: الطلبات اللي جهّزها المحل، مع الفاتورة والعمولة
export async function history(db, request) {
  const s = await requireSession(db, request, "shop");
  const u = new URL(request.url);
  const [a, b] = riyadhSpan(u.searchParams.get("from"), u.searchParams.get("to"));
  const { results } = await db.prepare(`SELECT p.id, p.items, p.bill, p.commission, p.offer_charge, p.ready_at, p.shop_stars, p.shop_note, o.order_no
    FROM parts p JOIN orders o ON o.id = p.order_id
    WHERE p.shop_id = ? AND p.status = 'ready' AND p.ready_at >= ? AND p.ready_at < ? ORDER BY p.ready_at DESC LIMIT 500`).bind(s.shop.id, a, b).all();
  const rej = await db.prepare("SELECT COUNT(*) AS n FROM parts WHERE shop_id = ? AND status = 'rejected' AND updated_at >= ? AND updated_at < ?").bind(s.shop.id, a, b).first();
  const r2 = v => Math.round(v * 100) / 100;
  return json({
    orders: results,
    totals: { count: results.length, bills: r2(results.reduce((t, p) => t + (Number(p.bill) || 0), 0)), commission: r2(results.reduce((t, p) => t + (Number(p.commission) || 0), 0)), rejected: rej.n,
      offer_charges: r2(results.reduce((t, p) => t + (Number(p.offer_charge) || 0), 0)) },
  });
}

export async function shopRating(db, id) {
  const r = await db.prepare("SELECT COUNT(shop_stars) AS n, AVG(shop_stars) AS avg FROM parts WHERE shop_id = ? AND shop_stars IS NOT NULL").bind(id).first();
  return { count: r.n, avg: r.avg ? Math.round(r.avg * 10) / 10 : null };
}
