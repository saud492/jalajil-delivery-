// مزايا المحلات الشريكة: صفحة الانضمام، عرض المحل، التقرير الشهري، والمحلات المميزة
import { HttpError, json, readJson, str } from "./util.js";
import { requireSession } from "./auth.js";
import { getSettings } from "./flow.js";
import { notify } from "./alerts.js";

const M = 60_000, H = 60 * M, D = 24 * H, RIYADH = 3 * H;
const CATS = ["بقالة", "مطعم", "كافيه", "خضار وفواكه", "صيدلية", "أخرى"];
const r1 = v => Math.round(v * 10) / 10, r2 = v => Math.round(v * 100) / 100;
const toEn = v => String(v ?? "").replace(/[٠-٩]/g, d => "٠١٢٣٤٥٦٧٨٩".indexOf(d)).replace(/[٫,]/g, ".");

/* ===== صفحة «انضم كشريك» ===== */
export async function joinInfo(db) {
  const s = await getSettings(db);
  const shops = await db.prepare("SELECT COUNT(*) AS n FROM shops WHERE active = 1").first();
  const done = await db.prepare("SELECT COUNT(*) AS n FROM orders WHERE driver_status = 'delivered'").first();
  return json({ trial_days: s.partner_trial_days, commission: s.partner_commission, shops: shops.n, delivered: done.n, support: s.support });
}

export async function join(db, request, e = {}) {
  const b = await readJson(request, 5000);
  const v = {
    name: str(b.name, 60), category: str(b.category, 20), owner: str(b.owner, 60),
    phone: toEn(str(b.phone, 20)).replace(/[^\d+]/g, ""), map_url: str(b.map_url, 500), note: str(b.note, 500),
  };
  if (!v.name) throw new HttpError(400, "اكتب اسم المحل");
  if (!CATS.includes(v.category)) throw new HttpError(400, "اختر نوع المحل");
  if (!v.owner) throw new HttpError(400, "اكتب اسمك");
  if (!/^\+?\d{9,15}$/.test(v.phone)) throw new HttpError(400, "اكتب رقم جوال صحيح");
  if (v.map_url && !/^https?:\/\/\S+$/i.test(v.map_url)) throw new HttpError(400, "رابط الموقع لازم يبدأ بـ https://");
  const now = Date.now();
  // حماية من الإزعاج: نفس الرقم مرتين باليوم، وأقصى ٢٠ طلب بالساعة
  const same = await db.prepare("SELECT COUNT(*) AS n FROM shop_requests WHERE phone = ? AND created_at > ?").bind(v.phone, now - D).first();
  if (same.n >= 2) throw new HttpError(429, "وصلنا طلبك، بنتواصل معك قريب");
  const hour = await db.prepare("SELECT COUNT(*) AS n FROM shop_requests WHERE created_at > ?").bind(now - H).first();
  if (hour.n >= 20) throw new HttpError(429, "جرّب بعد شوي");
  await db.prepare("INSERT INTO shop_requests (name, category, owner, phone, map_url, note, status, created_at) VALUES (?,?,?,?,?,?, 'new', ?)")
    .bind(v.name, v.category, v.owner, v.phone, v.map_url || null, v.note || null, now).run();
  notify(e, db, [["admin", null]], { title: "🏪 طلب انضمام: " + v.name, body: `${v.category} · ${v.owner} · ${v.phone}`, url: "/admin/", tag: "join" });
  return json({ ok: true });
}

export async function requests(db, request) {
  await requireSession(db, request, "admin");
  const { results } = await db.prepare("SELECT * FROM shop_requests ORDER BY (status = 'new') DESC, id DESC LIMIT 100").all();
  const open = results.filter(r => r.status === "new").length;
  return json({ requests: results, open });
}

export async function setRequest(db, request, id) {
  await requireSession(db, request, "admin");
  const b = await readJson(request);
  if (!["done", "rejected", "new"].includes(b.status)) throw new HttpError(400, "حالة غير معروفة");
  const r = await db.prepare("UPDATE shop_requests SET status = ? WHERE id = ?").bind(b.status, id).run();
  if (!r.meta.changes) throw new HttpError(404, "الطلب مو موجود");
  return json({ ok: true });
}

/* ===== عرض المحل: توصيل مجاني فوق مبلغ، على حساب المحل ===== */
export async function setOffer(db, request) {
  const s = await requireSession(db, request, "shop");
  const b = await readJson(request);
  if (b.off) {
    await db.prepare("UPDATE shops SET offer_min = NULL, offer_text = NULL WHERE id = ?").bind(s.shop.id).run();
    return json({ ok: true, offer: null });
  }
  const min = Number(toEn(b.min));
  if (!Number.isFinite(min) || min < 10 || min > 2000) throw new HttpError(400, "الحد الأدنى للعرض من ١٠ إلى ٢٠٠٠ ريال");
  const text = str(b.text, 60) || null;
  await db.prepare("UPDATE shops SET offer_min = ?, offer_text = ? WHERE id = ?").bind(r2(min), text, s.shop.id).run();
  return json({ ok: true, offer: { min: r2(min), text } });
}

/* ===== التقرير الشهري للمحل ===== */
function monthSpan(m) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(m || "")) throw new HttpError(400, "اختر الشهر");
  const [y, mo] = m.split("-").map(Number);
  const a = Date.UTC(y, mo - 1, 1) - RIYADH, b = Date.UTC(y, mo, 1) - RIYADH;
  return [a, b];
}

async function shopMonth(db, shopId, a, b) {
  const { results: ps } = await db.prepare(`SELECT p.*, o.phone_key, o.created_at AS o_created, o.ref_shop FROM parts p JOIN orders o ON o.id = p.order_id
    WHERE p.shop_id = ? AND o.created_at >= ? AND o.created_at < ? AND o.blocked IS NULL`).bind(shopId, a, b).all();
  const ready = ps.filter(p => p.status === "ready");
  // زبون جديد = أول طلب له من هالمحل كان في هالفترة
  const keys = [...new Set(ready.map(p => p.phone_key).filter(Boolean))];
  let fresh = 0;
  for (const k of keys) {
    const f = await db.prepare(`SELECT MIN(o.created_at) AS t FROM parts p JOIN orders o ON o.id = p.order_id WHERE p.shop_id = ? AND p.status = 'ready' AND o.phone_key = ?`).bind(shopId, k).first();
    if (f.t >= a) fresh++;
  }
  const days = Array(7).fill(0), hours = Array(24).fill(0);
  for (const p of ready) { const l = new Date(p.o_created + RIYADH); days[l.getUTCDay()]++; hours[l.getUTCHours()]++; }
  const timed = ready.filter(p => p.accepted_at && p.prep_minutes);
  const stars = ps.filter(p => p.shop_stars).map(p => p.shop_stars);
  const acc = ps.filter(p => p.accepted_at);
  return {
    orders: ready.length, received: ps.length, rejected: ps.filter(p => p.status === "rejected").length,
    sales: r2(ready.reduce((t, p) => t + (Number(p.bill) || 0), 0)),
    avg_bill: ready.length ? r2(ready.reduce((t, p) => t + (Number(p.bill) || 0), 0) / ready.length) : 0,
    customers: keys.length, new_customers: fresh, returning: keys.length - fresh,
    accept_minutes: acc.length ? r1(acc.reduce((t, p) => t + (p.accepted_at - p.o_created), 0) / acc.length / M) : null,
    on_time: timed.length ? r1(timed.filter(p => p.ready_at <= p.accepted_at + p.prep_minutes * M + M).length / timed.length * 100) : null,
    rating: stars.length ? r1(stars.reduce((t, x) => t + x, 0) / stars.length) : null, rating_count: stars.length,
    from_qr: ps.filter(p => p.ref_shop === shopId).length,
    offer_orders: ready.filter(p => p.offer_charge).length, offer_charges: r2(ready.reduce((t, p) => t + (Number(p.offer_charge) || 0), 0)),
    commission: r2(ready.reduce((t, p) => t + (Number(p.commission) || 0), 0)),
    best_day: days.indexOf(Math.max(...days)), best_hour: hours.indexOf(Math.max(...hours)), has_peak: ready.length > 0,
  };
}

export async function report(db, request) {
  const s = await requireSession(db, request, "shop");
  const m = new URL(request.url).searchParams.get("month");
  const [a, b] = monthSpan(m);
  const prevMonth = new Date(a + RIYADH - D).toISOString().slice(0, 7);
  const [pa, pb] = monthSpan(prevMonth);
  const cur = await shopMonth(db, s.shop.id, a, b), prev = await shopMonth(db, s.shop.id, pa, pb);
  cur.due = r2(cur.commission + cur.offer_charges);
  return json({ month: m, prev_month: prevMonth, shop: { name: s.shop.name, featured: !!s.shop.featured }, cur, prev });
}
