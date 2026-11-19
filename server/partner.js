// تطبيق الشريك: كل استعلام مربوط برقم المحل من الجلسة، فما يقدر محل يشوف طلبات غيره
import { HttpError, json, readJson, str, commissionFor, riyadhRanges } from "./util.js";
import { checkLock, recordFail, clearFails, createSession, sessionCookie, requireSession, endSession, verifyPin } from "./auth.js";

const ip = r => r.headers.get("cf-connecting-ip") || "local";

function shopInfo(s) {
  return { name: s.name, category: s.category, open: !!s.is_open, code: s.code, trial_end: s.trial_end, commission: s.commission };
}

export async function login(db, request) {
  const b = await readJson(request);
  const code = str(b.code, 40).toLowerCase();
  const pin = str(b.pin, 20);
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
    SELECT p.id, p.items, p.status, p.prep_minutes, p.reject_reason, p.accepted_at, p.ready_at, p.updated_at,
           o.order_no, o.created_at, o.dest, o.customer_name, o.customer_phone, o.map_url, o.place, o.pay, o.note
    FROM parts p JOIN orders o ON o.id = p.order_id
    WHERE p.shop_id = ? AND (p.status IN ('new','accepted') OR p.updated_at > ?)
    ORDER BY o.created_at DESC LIMIT 200`).bind(s.shop.id, since).all();
  return json({ shop: shopInfo(s.shop), orders: results, now: Date.now() });
}

const FROM = { accept: ["new"], ready: ["new", "accepted"], reject: ["new", "accepted"] };

export async function act(db, request, partId) {
  const s = await requireSession(db, request, "shop");
  const b = await readJson(request);
  const action = b.action;
  if (!FROM[action]) throw new HttpError(400, "إجراء غير معروف");
  const now = Date.now();
  const allowed = FROM[action].map(x => `'${x}'`).join(",");
  let stmt;
  if (action === "accept") {
    const m = Number(b.minutes);
    if (![10, 20, 30].includes(m)) throw new HttpError(400, "اختر وقت التجهيز");
    stmt = db.prepare(`UPDATE parts SET status='accepted', prep_minutes=?, accepted_at=?, updated_at=? WHERE id=? AND shop_id=? AND status IN (${allowed})`)
      .bind(m, now, now, partId, s.shop.id);
  } else if (action === "ready") {
    stmt = db.prepare(`UPDATE parts SET status='ready', ready_at=?, commission=?, updated_at=? WHERE id=? AND shop_id=? AND status IN (${allowed})`)
      .bind(now, commissionFor(s.shop, now), now, partId, s.shop.id);
  } else {
    const reason = str(b.reason, 120);
    if (!reason) throw new HttpError(400, "اختر سبب الرفض");
    stmt = db.prepare(`UPDATE parts SET status='rejected', reject_reason=?, updated_at=? WHERE id=? AND shop_id=? AND status IN (${allowed})`)
      .bind(reason, now, partId, s.shop.id);
  }
  const r = await stmt.run();
  if (!r.meta.changes) {
    const p = await db.prepare("SELECT status FROM parts WHERE id = ? AND shop_id = ?").bind(partId, s.shop.id).first();
    if (!p) throw new HttpError(404, "الطلب مو موجود");
    throw new HttpError(409, "حالة الطلب تغيّرت، حدّث الصفحة");
  }
  return json({ ok: true });
}

export async function setOpen(db, request) {
  const s = await requireSession(db, request, "shop");
  const b = await readJson(request);
  const open = b.open ? 1 : 0;
  await db.prepare("UPDATE shops SET is_open = ? WHERE id = ?").bind(open, s.shop.id).run();
  return json({ ok: true, open: !!open });
}

export async function summary(db, request) {
  const s = await requireSession(db, request, "shop");
  const { weekStart, monthStart } = riyadhRanges(Date.now());
  const q = start => db.prepare("SELECT COUNT(*) AS n, COALESCE(SUM(commission),0) AS c FROM parts WHERE shop_id = ? AND status = 'ready' AND ready_at >= ?").bind(s.shop.id, start);
  const [w, m] = await db.batch([q(weekStart), q(monthStart)]);
  return json({
    shop: shopInfo(s.shop),
    week: { count: w.results[0].n, commission: w.results[0].c },
    month: { count: m.results[0].n, commission: m.results[0].c },
  });
}
