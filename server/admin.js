// لوحة صاحب الخدمة
import { HttpError, json, readJson, str, riyadhRanges, STATUSES, sha256, cleanCode } from "./util.js";
import { checkLock, recordFail, clearFails, createSession, sessionCookie, requireSession, endSession, hashPin, safeEqual } from "./auth.js";
import { getSettings, saveSettings, summarize, loadOrder, sendImage } from "./flow.js";
import { driverRating, walletFor } from "./driver.js";

const ip = r => r.headers.get("cf-connecting-ip") || "local";
const CATS = ["بقالة", "مطعم", "كافيه", "صيدلية", "أخرى"];

export async function login(db, request, env) {
  if (!env.ADMIN_PASSWORD) throw new HttpError(503, "كلمة سر اللوحة ما انضافت في إعدادات Cloudflare (ADMIN_PASSWORD)");
  const b = await readJson(request);
  const keys = [`admin:${ip(request)}`, "admin"];
  await checkLock(db, keys);
  const ok = safeEqual(await sha256(str(b.password, 200)), await sha256(env.ADMIN_PASSWORD));
  if (!ok) { await recordFail(db, keys, [5, 30]); throw new HttpError(401, "كلمة السر غلط"); }
  await clearFails(db, keys);
  const token = await createSession(db, "admin");
  return json({ ok: true }, 200, { "set-cookie": sessionCookie("admin", token) });
}

export async function logout(db, request) {
  await endSession(db, request, "admin");
  return json({ ok: true }, 200, { "set-cookie": sessionCookie("admin", null) });
}

export async function me(db, request) {
  await requireSession(db, request, "admin");
  return json({ ok: true });
}

function cleanShop(b, creating) {
  const out = {};
  if (creating || b.code !== undefined) {
    out.code = cleanCode(b.code);
    if (!out.code) throw new HttpError(400, "رمز المحل: حروف (عربي أو إنجليزي) أو أرقام بدون مسافات، من ٢ إلى ٣٠ حرف");
  }
  if (creating || b.name !== undefined) {
    out.name = str(b.name, 60);
    if (!out.name) throw new HttpError(400, "اكتب اسم المحل");
  }
  if (creating || b.category !== undefined) {
    out.category = str(b.category, 20);
    if (!CATS.includes(out.category)) throw new HttpError(400, "اختر نوع المحل");
  }
  if (creating || (b.pin !== undefined && b.pin !== "")) {
    out.pin = str(b.pin, 20);
    if (!/^\d{4,8}$/.test(out.pin)) throw new HttpError(400, "الرقم السري من ٤ إلى ٨ أرقام");
  }
  if (creating || b.commission !== undefined) {
    const c = Number(b.commission ?? 0);
    if (!Number.isFinite(c) || c < 0 || c > 1000) throw new HttpError(400, "العمولة رقم بالريال");
    out.commission = Math.round(c * 100) / 100;
  }
  if (creating || b.trial_end !== undefined) {
    const t = str(b.trial_end, 10);
    if (t && !/^\d{4}-\d{2}-\d{2}$/.test(t)) throw new HttpError(400, "تاريخ نهاية التجربة غير صحيح");
    out.trial_end = t || null;
  }
  if (b.map_url !== undefined) {
    out.map_url = str(b.map_url, 500);
    if (out.map_url && !/^https?:\/\/\S+$/i.test(out.map_url)) throw new HttpError(400, "رابط موقع المحل لازم يبدأ بـ https://");
  }
  if (b.active !== undefined) out.active = b.active ? 1 : 0;
  if (b.is_open !== undefined) out.is_open = b.is_open ? 1 : 0;
  return out;
}

export async function createShop(db, request) {
  await requireSession(db, request, "admin");
  const s = cleanShop(await readJson(request), true);
  const dup = await db.prepare("SELECT id FROM shops WHERE code = ?").bind(s.code).first();
  if (dup) throw new HttpError(409, "رمز المحل مستخدم، اختر رمز ثاني");
  const { hash, salt } = await hashPin(s.pin);
  const r = await db.prepare(`INSERT INTO shops (code, name, category, pin_hash, pin_salt, commission, trial_end, map_url, created_at)
    VALUES (?,?,?,?,?,?,?,?,?) RETURNING id`).bind(s.code, s.name, s.category, hash, salt, s.commission, s.trial_end, s.map_url || null, Date.now()).first();
  return json({ ok: true, id: r.id });
}

export async function updateShop(db, request, id) {
  await requireSession(db, request, "admin");
  const s = cleanShop(await readJson(request), false);
  const shop = await db.prepare("SELECT id FROM shops WHERE id = ?").bind(id).first();
  if (!shop) throw new HttpError(404, "المحل مو موجود");
  if (s.code) {
    const dup = await db.prepare("SELECT id FROM shops WHERE code = ? AND id != ?").bind(s.code, id).first();
    if (dup) throw new HttpError(409, "رمز المحل مستخدم، اختر رمز ثاني");
  }
  const sets = [], vals = [];
  for (const k of ["code", "name", "category", "commission", "trial_end", "active", "is_open", "map_url"]) {
    if (k in s) { sets.push(`${k} = ?`); vals.push(s[k]); }
  }
  const stmts = [];
  if (s.pin) {
    const { hash, salt } = await hashPin(s.pin);
    sets.push("pin_hash = ?", "pin_salt = ?"); vals.push(hash, salt);
    // رقم سري جديد: نطلّع المحل من كل الأجهزة
    stmts.push(db.prepare("DELETE FROM sessions WHERE kind = 'shop' AND shop_id = ?").bind(id));
  }
  if (s.active === 0) stmts.push(db.prepare("DELETE FROM sessions WHERE kind = 'shop' AND shop_id = ?").bind(id));
  if (sets.length) stmts.unshift(db.prepare(`UPDATE shops SET ${sets.join(", ")} WHERE id = ?`).bind(...vals, id));
  if (stmts.length) await db.batch(stmts);
  return json({ ok: true });
}

// المحلات مع أرقامها: الطلبات المكتملة والعمولة (أسبوع، شهر، الكل)
export async function shops(db, request) {
  await requireSession(db, request, "admin");
  const { weekStart, monthStart } = riyadhRanges(Date.now());
  const { results } = await db.prepare(`
    SELECT s.id, s.code, s.name, s.category, s.commission, s.trial_end, s.is_open, s.active, s.created_at, s.map_url,
      AVG(p.shop_stars) AS rating, COUNT(p.shop_stars) AS rating_count,
      SUM(CASE WHEN p.status='ready' AND p.ready_at >= ?1 THEN 1 ELSE 0 END) AS week_count,
      SUM(CASE WHEN p.status='ready' AND p.ready_at >= ?1 THEN p.commission ELSE 0 END) AS week_commission,
      SUM(CASE WHEN p.status='ready' AND p.ready_at >= ?2 THEN 1 ELSE 0 END) AS month_count,
      SUM(CASE WHEN p.status='ready' AND p.ready_at >= ?2 THEN p.commission ELSE 0 END) AS month_commission,
      SUM(CASE WHEN p.status='ready' THEN 1 ELSE 0 END) AS all_count,
      SUM(CASE WHEN p.status='ready' THEN p.commission ELSE 0 END) AS all_commission,
      SUM(CASE WHEN p.status IN ('new','accepted') THEN 1 ELSE 0 END) AS open_count
    FROM shops s LEFT JOIN parts p ON p.shop_id = s.id
    GROUP BY s.id ORDER BY s.active DESC, s.name`).bind(weekStart, monthStart).all();
  const n = v => v || 0;
  return json({
    shops: results.map(r => ({ ...r, is_open: !!r.is_open, active: !!r.active,
      week_count: n(r.week_count), week_commission: n(r.week_commission), month_count: n(r.month_count),
      month_commission: n(r.month_commission), all_count: n(r.all_count), all_commission: n(r.all_commission), open_count: n(r.open_count) })),
  });
}

export async function orders(db, request) {
  await requireSession(db, request, "admin");
  const u = new URL(request.url);
  const days = Math.min(90, Math.max(1, Number(u.searchParams.get("days")) || 7));
  const status = u.searchParams.get("status");
  const shop = u.searchParams.get("shop");
  const since = Date.now() - days * 24 * 3600_000;
  const where = ["o.created_at >= ?"], vals = [since];
  if (status && STATUSES.includes(status)) { where.push("p.status = ?"); vals.push(status); }
  if (shop === "none") where.push("p.shop_id IS NULL");
  else if (shop && /^\d+$/.test(shop)) { where.push("p.shop_id = ?"); vals.push(Number(shop)); }
  const filtered = (status || shop) ? `AND o.id IN (SELECT p.order_id FROM parts p JOIN orders o ON o.id = p.order_id WHERE ${where.join(" AND ")})` : "";
  const { results: os } = await db.prepare(`SELECT * FROM orders o WHERE o.created_at >= ? ${filtered} ORDER BY o.created_at DESC LIMIT 300`)
    .bind(since, ...(filtered ? vals : [])).all();
  if (!os.length) return json({ orders: [] });
  const ids = os.map(o => o.id);
  const { results: ps } = await db.prepare(`SELECT * FROM parts WHERE order_id IN (${ids.map(() => "?").join(",")}) ORDER BY id`).bind(...ids).all();
  const by = new Map(os.map(o => [o.id, { ...o, client_key: undefined, pack: safeParse(o.pack), parts: [] }]));
  for (const p of ps) by.get(p.order_id).parts.push(p);
  const st = await getSettings(db);
  const { results: rt } = await db.prepare(`SELECT order_id, driver_stars, tags, comment FROM ratings WHERE order_id IN (${ids.map(() => "?").join(",")})`).bind(...ids).all();
  const { results: rp } = await db.prepare(`SELECT order_id, COUNT(*) AS n, SUM(CASE WHEN status='open' THEN 1 ELSE 0 END) AS open FROM reports WHERE order_id IN (${ids.map(() => "?").join(",")}) GROUP BY order_id`).bind(...ids).all();
  for (const r of rt) { const o = by.get(r.order_id); if (o) o.rating = { stars: r.driver_stars, tags: safeParse(r.tags), comment: r.comment }; }
  for (const r of rp) { const o = by.get(r.order_id); if (o) o.reports = { count: r.n, open: r.open || 0 }; }
  return json({ orders: [...by.values()].map(o => ({ ...o, ...summarize(o, o.parts, st) })) });
}

function safeParse(s) { try { return JSON.parse(s || "[]"); } catch { return []; } }

export async function actPart(db, request, partId) {
  await requireSession(db, request, "admin");
  const b = await readJson(request);
  if (b.action !== "cancel") throw new HttpError(400, "إجراء غير معروف");
  const r = await db.prepare("UPDATE parts SET status='cancelled', commission=0, updated_at=? WHERE id=? AND status != 'cancelled'")
    .bind(Date.now(), partId).run();
  if (!r.meta.changes) throw new HttpError(404, "الطلب مو موجود أو ملغي");
  return json({ ok: true });
}

/* ===== المناديب ===== */
function cleanDriver(b, creating) {
  const out = {};
  if (creating || b.code !== undefined) {
    out.code = cleanCode(b.code);
    if (!out.code) throw new HttpError(400, "رمز المندوب: حروف (عربي أو إنجليزي) أو أرقام بدون مسافات، من ٢ إلى ٣٠ حرف");
  }
  if (creating || b.name !== undefined) {
    out.name = str(b.name, 60);
    if (!out.name) throw new HttpError(400, "اكتب اسم المندوب");
  }
  if (creating || b.phone !== undefined) out.phone = str(b.phone, 30).replace(/[٠-٩]/g, d => "٠١٢٣٤٥٦٧٨٩".indexOf(d));
  if (creating || (b.pin !== undefined && b.pin !== "")) {
    out.pin = str(b.pin, 20);
    if (!/^\d{4,8}$/.test(out.pin)) throw new HttpError(400, "الرقم السري من ٤ إلى ٨ أرقام");
  }
  if (b.active !== undefined) out.active = b.active ? 1 : 0;
  return out;
}

export async function drivers(db, request) {
  await requireSession(db, request, "admin");
  const { weekStart, monthStart } = riyadhRanges(Date.now());
  const { results } = await db.prepare(`
    SELECT d.id, d.code, d.name, d.phone, d.active, d.created_at,
      SUM(CASE WHEN o.driver_status='delivered' AND o.delivered_at >= ?1 THEN 1 ELSE 0 END) AS week_count,
      SUM(CASE WHEN o.driver_status='delivered' AND o.delivered_at >= ?1 THEN COALESCE(o.fee,0) ELSE 0 END) AS week_fees,
      SUM(CASE WHEN o.driver_status='delivered' AND o.delivered_at >= ?2 THEN 1 ELSE 0 END) AS month_count,
      SUM(CASE WHEN o.driver_status='delivered' AND o.delivered_at >= ?2 THEN COALESCE(o.fee,0) ELSE 0 END) AS month_fees,
      SUM(CASE WHEN o.driver_status='delivered' THEN 1 ELSE 0 END) AS all_count,
      SUM(CASE WHEN o.driver_status IN ('assigned','picked') THEN 1 ELSE 0 END) AS open_count
    FROM drivers d LEFT JOIN orders o ON o.driver_id = d.id
    GROUP BY d.id ORDER BY d.active DESC, d.name`).bind(weekStart, monthStart).all();
  const n = v => v || 0;
  for (const r of results) {
    r.rating = await driverRating(db, r.id);
    r.wallet = await walletFor(db, r.id);
    const rp = await db.prepare("SELECT COUNT(*) AS n, SUM(CASE WHEN status='open' THEN 1 ELSE 0 END) AS open FROM reports WHERE driver_id = ?").bind(r.id).first();
    r.reports = { count: rp.n || 0, open: rp.open || 0 };
  }
  return json({ drivers: results.map(r => ({ ...r, active: !!r.active,
    week_count: n(r.week_count), week_fees: n(r.week_fees), month_count: n(r.month_count), month_fees: n(r.month_fees),
    all_count: n(r.all_count), open_count: n(r.open_count) })) });
}

export async function createDriver(db, request) {
  await requireSession(db, request, "admin");
  const d = cleanDriver(await readJson(request), true);
  const dup = await db.prepare("SELECT id FROM drivers WHERE code = ?").bind(d.code).first();
  if (dup) throw new HttpError(409, "رمز المندوب مستخدم، اختر رمز ثاني");
  const { hash, salt } = await hashPin(d.pin);
  const r = await db.prepare("INSERT INTO drivers (code, name, phone, pin_hash, pin_salt, created_at) VALUES (?,?,?,?,?,?) RETURNING id")
    .bind(d.code, d.name, d.phone, hash, salt, Date.now()).first();
  return json({ ok: true, id: r.id });
}

export async function updateDriver(db, request, id) {
  await requireSession(db, request, "admin");
  const d = cleanDriver(await readJson(request), false);
  const row = await db.prepare("SELECT id FROM drivers WHERE id = ?").bind(id).first();
  if (!row) throw new HttpError(404, "المندوب مو موجود");
  if (d.code) {
    const dup = await db.prepare("SELECT id FROM drivers WHERE code = ? AND id != ?").bind(d.code, id).first();
    if (dup) throw new HttpError(409, "رمز المندوب مستخدم، اختر رمز ثاني");
  }
  const sets = [], vals = [], stmts = [];
  for (const k of ["code", "name", "phone", "active"]) if (k in d) { sets.push(`${k} = ?`); vals.push(d[k]); }
  if (d.pin) {
    const { hash, salt } = await hashPin(d.pin);
    sets.push("pin_hash = ?", "pin_salt = ?"); vals.push(hash, salt);
  }
  // رقم سري جديد أو إيقاف: نطلّعه من كل الأجهزة
  if (d.pin || d.active === 0) stmts.push(db.prepare("DELETE FROM sessions WHERE kind = 'driver' AND shop_id = ?").bind(id));
  if (sets.length) stmts.unshift(db.prepare(`UPDATE drivers SET ${sets.join(", ")} WHERE id = ?`).bind(...vals, id));
  if (stmts.length) await db.batch(stmts);
  return json({ ok: true });
}

// تعيين مندوب لطلب، أو شيله (driver_id = null)
export async function assignDriver(db, request, orderId) {
  await requireSession(db, request, "admin");
  const b = await readJson(request);
  const o = await db.prepare("SELECT id, driver_status FROM orders WHERE id = ?").bind(orderId).first();
  if (!o) throw new HttpError(404, "الطلب مو موجود");
  if (o.driver_status === "delivered") throw new HttpError(409, "الطلب توصّل، ما تقدر تغيّر المندوب");
  if (b.driver_id === null || b.driver_id === "" || b.driver_id === undefined) {
    await db.prepare("UPDATE orders SET driver_id=NULL, driver_status=NULL, assigned_at=NULL, picked_at=NULL WHERE id=?").bind(orderId).run();
    return json({ ok: true });
  }
  const id = Number(b.driver_id);
  const d = Number.isInteger(id) && await db.prepare("SELECT id FROM drivers WHERE id = ? AND active = 1").bind(id).first();
  if (!d) throw new HttpError(400, "اختر مندوب فعّال");
  await db.prepare("UPDATE orders SET driver_id=?, driver_status='assigned', assigned_at=?, picked_at=NULL WHERE id=?").bind(id, Date.now(), orderId).run();
  return json({ ok: true });
}

/* ===== الإعدادات، الدفع المسبق، والصور ===== */
export async function settings(db, request) {
  await requireSession(db, request, "admin");
  return json({ settings: await getSettings(db) });
}

export async function updateSettings(db, request) {
  await requireSession(db, request, "admin");
  await saveSettings(db, await readJson(request));
  return json({ ok: true, settings: await getSettings(db) });
}

// صاحب الخدمة يأكّد إن تحويل الزبون وصل (أو يرفضه عشان الزبون يرفع إيصال صحيح)
export async function prepay(db, request, orderId) {
  await requireSession(db, request, "admin");
  const b = await readJson(request);
  const x = await loadOrder(db, "id", orderId);
  if (!x) throw new HttpError(404, "الطلب مو موجود");
  const sum = summarize(x.o, x.parts, await getSettings(db));
  if (b.action === "confirm") {
    if (!sum.approved) throw new HttpError(409, "الزبون للحين ما وافق على المبلغ");
    await db.prepare("UPDATE orders SET prepay_status='confirmed', prepay_amount=? WHERE id=?").bind(sum.total, orderId).run();
  } else if (b.action === "reject") {
    await db.prepare("UPDATE orders SET prepay_status=NULL, prepay_amount=NULL WHERE id=?").bind(orderId).run();
  } else throw new HttpError(400, "إجراء غير معروف");
  return json({ ok: true });
}

/* ===== البلاغات ===== */
export async function reports(db, request) {
  await requireSession(db, request, "admin");
  const status = new URL(request.url).searchParams.get("status");
  const where = status === "open" ? "WHERE r.status = 'open'" : "";
  const { results } = await db.prepare(`
    SELECT r.id, r.order_id, r.kind, r.note, r.image_id, r.status, r.resolution, r.created_at, r.resolved_at,
           o.order_no, o.customer_name, o.customer_phone, o.track_token, d.name AS driver_name
    FROM reports r JOIN orders o ON o.id = r.order_id LEFT JOIN drivers d ON d.id = r.driver_id
    ${where} ORDER BY (r.status = 'open') DESC, r.id DESC LIMIT 200`).all();
  const open = await db.prepare("SELECT COUNT(*) AS n FROM reports WHERE status = 'open'").first();
  return json({ reports: results, open: open.n });
}

export async function resolveReport(db, request, id) {
  await requireSession(db, request, "admin");
  const b = await readJson(request);
  const r = await db.prepare("UPDATE reports SET status='resolved', resolution=?, resolved_at=? WHERE id=? AND status='open'").bind(str(b.resolution, 300), Date.now(), id).run();
  if (!r.meta.changes) throw new HttpError(404, "البلاغ مو موجود أو محلول");
  return json({ ok: true });
}

/* ===== تسوية محفظة المندوب ===== */
export async function settle(db, request, driverId) {
  await requireSession(db, request, "admin");
  const b = await readJson(request);
  const d = await db.prepare("SELECT id FROM drivers WHERE id = ?").bind(driverId).first();
  if (!d) throw new HttpError(404, "المندوب مو موجود");
  const amount = Number(String(b.amount ?? "").replace(/[٠-٩]/g, x => "٠١٢٣٤٥٦٧٨٩".indexOf(x)));
  if (!Number.isFinite(amount) || amount <= 0 || amount > 100000) throw new HttpError(400, "اكتب المبلغ");
  if (!["in", "out"].includes(b.direction)) throw new HttpError(400, "مين سلّم مين؟");
  const signed = Math.round((b.direction === "in" ? amount : -amount) * 100) / 100;
  await db.prepare("INSERT INTO settlements (driver_id, amount, note, created_at) VALUES (?,?,?,?)").bind(driverId, signed, str(b.note, 200), Date.now()).run();
  return json({ ok: true, wallet: await walletFor(db, driverId) });
}

export async function image(db, request, id) {
  await requireSession(db, request, "admin");
  const r = await db.prepare("SELECT order_id FROM receipts WHERE id = ?").bind(id).first();
  if (!r) throw new HttpError(404, "الصورة مو موجودة");
  return sendImage(db, r.order_id, id);
}
