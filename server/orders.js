// الجزء العام: موقع الزباين يحفظ الطلب ويجيب قائمة المحلات الشريكة
import { HttpError, json, readJson, str, shopOpen } from "./util.js";
import { getSettings } from "./flow.js";
import { baseFee, priceOrder, promoToday, phoneKey } from "./fees.js";
import { newOrder } from "./alerts.js";

const DESTS = ["home", "chalet", "park"];

export async function listShops(db) {
  const { results } = await db.prepare(
    `SELECT s.id, s.name, s.category, s.is_open, s.closed_until, AVG(p.shop_stars) AS rating, COUNT(p.shop_stars) AS rating_count
     FROM shops s LEFT JOIN parts p ON p.shop_id = s.id WHERE s.active = 1 GROUP BY s.id ORDER BY s.name`
  ).all();
  const settings = await getSettings(db);
  const { prepay_cap } = settings;
  // التقييم يطلع للزبون بعد ٣ تقييمات على الأقل
  return json({ shops: results.map(s => ({ id: s.id, name: s.name, category: s.category, open: shopOpen(s),
    rating: s.rating_count >= 3 ? Math.round(s.rating * 10) / 10 : null })), prepay_cap,
    // الرسوم من الإعدادات، والعرض بدون الكود نفسه
    fees: { home: baseFee(settings, "home"), out: baseFee(settings, "chalet") }, promo: await promoToday(db) });
}

export async function saveOrder(db, request, e = {}) {
  const b = await readJson(request, 30000);
  const key = str(b.key, 64);
  if (!/^[A-Za-z0-9_-]{8,64}$/.test(key)) throw new HttpError(400, "مفتاح الطلب غير صحيح");

  const partsIn = Array.isArray(b.parts) ? b.parts.slice(0, 10) : [];
  const pack = Array.isArray(b.pack) ? b.pack.slice(0, 30).map(x => str(x, 120)).filter(Boolean) : [];
  const parts = partsIn
    .map(p => ({ shop_id: Number.isInteger(p && p.shop_id) ? p.shop_id : null, category: str(p && p.cat, 30), name: str(p && p.name, 80), items: str(p && p.items, 2000) }))
    .filter(p => p.name || p.items);
  if (!parts.length && !pack.length) throw new HttpError(400, "الطلب فاضي");

  // المحل لازم يكون شريك فعلي، وإلا ينحفظ كمحل ثاني بالاسم اللي كتبه الزبون
  const ids = [...new Set(parts.map(p => p.shop_id).filter(Boolean))];
  const shops = new Map();
  if (ids.length) {
    const { results } = await db.prepare(`SELECT id, name, category FROM shops WHERE active = 1 AND id IN (${ids.map(() => "?").join(",")})`).bind(...ids).all();
    for (const s of results) shops.set(s.id, s);
  }
  for (const p of parts) {
    const s = p.shop_id && shops.get(p.shop_id);
    if (s) { p.name = s.name; } else p.shop_id = null;
  }
  // تجهيزات الشاليه/الكشتة يشتريها المندوب، فلها فاتورة مثل أي محل
  if (pack.length) parts.push({ shop_id: null, category: "تجهيزات", name: "تجهيزات", items: pack.join("\n") });

  const now = Date.now();
  const o = {
    order_no: str(b.order_no, 30) || "—",
    dest: DESTS.includes(b.dest) ? b.dest : "home",
    customer_name: str(b.name, 80), customer_phone: str(b.phone, 30), map_url: str(b.map, 500),
    place: str(b.place, 200), pay: str(b.pay, 60), note: str(b.note, 300),
    pack: JSON.stringify(pack),
  };
  o.phone_key = phoneKey(o.customer_phone);
  // حد الموافقة التلقائية: الفاتورة لين هالمبلغ تنحسب موافق عليها
  const auto = Number(String(b.auto_approve ?? "").replace(/[٠-٩]/g, d => "٠١٢٣٤٥٦٧٨٩".indexOf(d)));
  o.auto_approve = String(b.auto_approve ?? "").trim() && Number.isFinite(auto) && auto > 0 ? Math.min(100000, Math.round(auto * 100) / 100) : null;

  // رابط المتابعة ورمز الاستلام يجون من جوال الزبون (عشان يطلعون له على طول بدون انتظار)
  const track = /^[A-Za-z0-9_-]{16,64}$/.test(str(b.track, 64)) ? str(b.track, 64) : null;
  const code = /^\d{4}$/.test(str(b.code, 4)) ? str(b.code, 4) : String(Math.floor(1000 + Math.random() * 9000));

  const existing = await db.prepare("SELECT id, driver_id FROM orders WHERE client_key = ?").bind(key).first();
  // الرسوم يحسبها السيرفر من الوجهة والإعدادات، وكود الخصم يتحقق منه هنا (ما نصدّق رقم الصفحة)
  Object.assign(o, await priceOrder(db, o.dest, str(b.promo, 30), o.customer_phone, existing && existing.id));
  let orderId;
  if (existing) {
    // الزبون ضغط إرسال مرة ثانية: نحدّث الطلب بس لو ما أحد تعامل معه للحين
    const touched = await db.prepare("SELECT COUNT(*) AS n FROM parts WHERE order_id = ? AND (status != 'new' OR bill IS NOT NULL)").bind(existing.id).first();
    if (touched.n > 0 || existing.driver_id) return json({ ok: true, id: existing.id, unchanged: true });
    orderId = existing.id;
    await db.batch([
      db.prepare("DELETE FROM parts WHERE order_id = ?").bind(orderId),
      db.prepare(`UPDATE orders SET order_no=?, dest=?, customer_name=?, customer_phone=?, map_url=?, place=?, pay=?, note=?, fee=?, fee_full=?, promo=?, pack=?, auto_approve=?, phone_key=? WHERE id=?`)
        .bind(o.order_no, o.dest, o.customer_name, o.customer_phone, o.map_url, o.place, o.pay, o.note, o.fee, o.fee_full, o.promo, o.pack, o.auto_approve, o.phone_key, orderId),
    ]);
  } else {
    // لو رابط المتابعة مستخدم لطلب ثاني (نادر)، نحفظ الطلب بدونه بدل ما نضيّعه
    const used = track && await db.prepare("SELECT id FROM orders WHERE track_token = ?").bind(track).first();
    const r = await db.prepare(`INSERT INTO orders (client_key, order_no, created_at, dest, customer_name, customer_phone, map_url, place, pay, note, fee, fee_full, promo, pack, track_token, delivery_code, auto_approve, phone_key)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(client_key) DO NOTHING RETURNING id`)
      .bind(key, o.order_no, now, o.dest, o.customer_name, o.customer_phone, o.map_url, o.place, o.pay, o.note, o.fee, o.fee_full, o.promo, o.pack, used ? null : track, code, o.auto_approve, o.phone_key).first();
    if (!r) return json({ ok: true, unchanged: true }); // وصل طلبين بنفس اللحظة
    orderId = r.id;
  }
  if (parts.length) {
    await db.batch(parts.map(p => db.prepare(
      "INSERT INTO parts (order_id, shop_id, shop_name, category, items, status, updated_at) VALUES (?, ?, ?, ?, ?, 'new', ?)"
    ).bind(orderId, p.shop_id, p.name, p.category, p.items, now)));
  }
  if (!existing) await newOrder(e, db, orderId);
  return json({ ok: true, id: orderId, fee: o.fee, fee_full: o.fee_full, promo: o.promo });
}
