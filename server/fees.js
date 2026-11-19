// رسوم التوصيل وأكواد الخصم: السيرفر يحسبها بنفسه، وصفحة الزبون تعرضها بس
import { HttpError, json, readJson, str, riyadhDate } from "./util.js";
import { getSettings } from "./flow.js";

const toEn = v => String(v ?? "").replace(/[٠-٩]/g, d => "٠١٢٣٤٥٦٧٨٩".indexOf(d));

// الجوال بصيغة وحدة (9665XXXXXXXX) عشان «مرة لكل رقم» ما تنلعب بالمسافات أو الصفر
export function phoneKey(v) {
  let d = toEn(v).replace(/\D/g, "");
  if (d.startsWith("00")) d = d.slice(2);
  if (/^05\d{8}$/.test(d)) d = "966" + d.slice(1);
  else if (/^5\d{8}$/.test(d)) d = "966" + d;
  return d.length >= 8 ? d : "";
}

export const baseFee = (settings, dest) => (dest === "home" ? settings.delivery_fee : settings.out_fee);
const r2 = n => Math.round(n * 100) / 100;

// يتحقق من الكود لهالرقم. يرجّع { promo } أو { error }
export async function checkPromo(db, code, phone, now = Date.now(), exclude = 0) {
  const c = str(code, 30);
  if (!c) return { error: "اكتب الكود" };
  const p = await db.prepare("SELECT * FROM promos WHERE code = ? AND active = 1").bind(c).first();
  if (!p) return { error: "الكود غير صحيح" };
  const today = riyadhDate(now);
  if (p.date_from && today < p.date_from) return { error: p.date_from === p.date_to ? "الكود يشتغل فقط يوم " + p.date_from : "الكود يبدأ يوم " + p.date_from, date: p.date_from };
  if (p.date_to && today > p.date_to) return { error: "الكود انتهى" };
  // الطلبات الملغية ما تنحسب، والطلب نفسه لو انرسل مرة ثانية ما ينحسب
  const live = `rejected_at IS NULL AND (driver_status IS NULL OR driver_status != 'cancelled') AND id != ${Number(exclude) || 0}`;
  if (p.max_uses) {
    const n = await db.prepare(`SELECT COUNT(*) AS n FROM orders WHERE promo = ? COLLATE NOCASE AND ${live}`).bind(p.code).first();
    if (n.n >= p.max_uses) return { error: "الكود خلص" };
  }
  const key = phoneKey(phone);
  if (p.per_phone) {
    if (!key) return { error: "اكتب رقم جوالك أول عشان نطبّق الكود" };
    const n = await db.prepare(`SELECT COUNT(*) AS n FROM orders WHERE promo = ? COLLATE NOCASE AND phone_key = ? AND ${live}`).bind(p.code, key).first();
    if (n.n >= p.per_phone) return { error: p.per_phone === 1 ? "استخدمت هالكود من قبل" : "وصلت حد استخدام الكود" };
  }
  return { promo: p };
}

// الرسوم النهائية للطلب: fee_full قبل الخصم، fee بعده
export async function priceOrder(db, dest, promoCode, phone, exclude = 0) {
  const settings = await getSettings(db);
  const full = baseFee(settings, dest);
  if (!promoCode) return { fee: full, fee_full: full, promo: "" };
  const { promo } = await checkPromo(db, promoCode, phone, Date.now(), exclude);
  if (!promo) return { fee: full, fee_full: full, promo: "" };
  return { fee: r2(full * (1 - promo.discount)), fee_full: full, promo: promo.code };
}

// صفحة الزبون تسأل عن الكود قبل الإرسال
export async function promoCheck(db, request) {
  const b = await readJson(request);
  const { promo, error, date } = await checkPromo(db, b.code, b.phone);
  if (!promo) return json({ ok: false, error, date });
  return json({ ok: true, code: promo.code, discount: promo.discount, per_phone: promo.per_phone });
}

// هل فيه عرض شغال اليوم (بدون ما نكشف الكود)
export async function promoToday(db) {
  const t = riyadhDate(Date.now());
  const p = await db.prepare(`SELECT discount FROM promos WHERE active = 1 AND (date_from IS NULL OR date_from <= ?) AND (date_to IS NULL OR date_to >= ?)
    ORDER BY discount DESC LIMIT 1`).bind(t, t).first();
  return p ? { discount: p.discount } : null;
}

/* ===== اللوحة ===== */
export async function listPromos(db) {
  const { results } = await db.prepare(`SELECT p.*, (SELECT COUNT(*) FROM orders o WHERE o.promo = p.code COLLATE NOCASE AND o.rejected_at IS NULL) AS uses
    FROM promos p ORDER BY p.active DESC, p.id DESC`).all();
  return results;
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;
export async function savePromo(db, b, id = null) {
  const v = {};
  if (!id || b.code !== undefined) {
    v.code = toEn(str(b.code, 30)).toUpperCase();
    if (!/^[\p{L}\p{N}_-]{3,30}$/u.test(v.code)) throw new HttpError(400, "الكود من ٣ حروف أو أرقام على الأقل، بدون مسافات");
  }
  if (!id || b.discount !== undefined) {
    const pct = Number(toEn(b.discount));
    if (!Number.isFinite(pct) || pct <= 0 || pct > 100) throw new HttpError(400, "نسبة الخصم من ١ إلى ١٠٠");
    v.discount = Math.round(pct) / 100;
  }
  for (const k of ["date_from", "date_to"]) if (!id || b[k] !== undefined) {
    const d = str(b[k], 10);
    if (d && !DATE.test(d)) throw new HttpError(400, "التاريخ غير صحيح");
    v[k] = d || null;
  }
  if (v.date_from && v.date_to && v.date_to < v.date_from) throw new HttpError(400, "تاريخ النهاية قبل البداية");
  if (!id || b.per_phone !== undefined) {
    const n = Number(toEn(b.per_phone ?? 1));
    if (!Number.isInteger(n) || n < 0 || n > 100) throw new HttpError(400, "عدد مرات الاستخدام لكل رقم غير صحيح (صفر = بدون حد)");
    v.per_phone = n;
  }
  if (!id || b.max_uses !== undefined) {
    const s = str(b.max_uses, 6);
    const n = s ? Number(toEn(s)) : null;
    if (n !== null && (!Number.isInteger(n) || n < 1)) throw new HttpError(400, "الحد الكلي رقم، أو اتركه فاضي");
    v.max_uses = n;
  }
  if (b.active !== undefined) v.active = b.active ? 1 : 0;
  if (v.code) {
    const dup = await db.prepare("SELECT id FROM promos WHERE code = ? AND id != ?").bind(v.code, id ?? 0).first();
    if (dup) throw new HttpError(409, "هالكود موجود");
  }
  if (!id) {
    const r = await db.prepare("INSERT INTO promos (code, discount, date_from, date_to, per_phone, max_uses, active, created_at) VALUES (?,?,?,?,?,?,?,?) RETURNING id")
      .bind(v.code, v.discount, v.date_from, v.date_to, v.per_phone, v.max_uses, v.active ?? 1, Date.now()).first();
    return r.id;
  }
  const keys = Object.keys(v);
  if (!keys.length) return id;
  const r = await db.prepare(`UPDATE promos SET ${keys.map(k => k + " = ?").join(", ")} WHERE id = ?`).bind(...keys.map(k => v[k]), id).run();
  if (!r.meta.changes) throw new HttpError(404, "الكود مو موجود");
  return id;
}
