// الجزء العام: موقع الزباين يحفظ الطلب ويجيب قائمة المحلات الشريكة
import { HttpError, json, readJson, str } from "./util.js";

const DESTS = ["home", "chalet", "park"];

export async function listShops(db) {
  const { results } = await db.prepare(
    "SELECT id, name, category, is_open FROM shops WHERE active = 1 ORDER BY name"
  ).all();
  return json({ shops: results.map(s => ({ id: s.id, name: s.name, category: s.category, open: !!s.is_open })) });
}

export async function saveOrder(db, request) {
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

  const now = Date.now();
  const o = {
    order_no: str(b.order_no, 30) || "—",
    dest: DESTS.includes(b.dest) ? b.dest : "home",
    customer_name: str(b.name, 80), customer_phone: str(b.phone, 30), map_url: str(b.map, 500),
    place: str(b.place, 200), pay: str(b.pay, 60), note: str(b.note, 300),
    fee: Number.isFinite(+b.fee) ? Math.max(0, Math.min(1000, +b.fee)) : null,
    promo: str(b.promo, 30), pack: JSON.stringify(pack),
  };

  const existing = await db.prepare("SELECT id FROM orders WHERE client_key = ?").bind(key).first();
  let orderId;
  if (existing) {
    // الزبون ضغط إرسال مرة ثانية: نحدّث الطلب بس لو ما أحد تعامل معه للحين
    const touched = await db.prepare("SELECT COUNT(*) AS n FROM parts WHERE order_id = ? AND status != 'new'").bind(existing.id).first();
    if (touched.n > 0) return json({ ok: true, id: existing.id, unchanged: true });
    orderId = existing.id;
    await db.batch([
      db.prepare("DELETE FROM parts WHERE order_id = ?").bind(orderId),
      db.prepare(`UPDATE orders SET order_no=?, dest=?, customer_name=?, customer_phone=?, map_url=?, place=?, pay=?, note=?, fee=?, promo=?, pack=? WHERE id=?`)
        .bind(o.order_no, o.dest, o.customer_name, o.customer_phone, o.map_url, o.place, o.pay, o.note, o.fee, o.promo, o.pack, orderId),
    ]);
  } else {
    const r = await db.prepare(`INSERT INTO orders (client_key, order_no, created_at, dest, customer_name, customer_phone, map_url, place, pay, note, fee, promo, pack)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(client_key) DO NOTHING RETURNING id`)
      .bind(key, o.order_no, now, o.dest, o.customer_name, o.customer_phone, o.map_url, o.place, o.pay, o.note, o.fee, o.promo, o.pack).first();
    if (!r) return json({ ok: true, unchanged: true }); // وصل طلبين بنفس اللحظة
    orderId = r.id;
  }
  if (parts.length) {
    await db.batch(parts.map(p => db.prepare(
      "INSERT INTO parts (order_id, shop_id, shop_name, category, items, status, updated_at) VALUES (?, ?, ?, ?, ?, 'new', ?)"
    ).bind(orderId, p.shop_id, p.name, p.category, p.items, now)));
  }
  return json({ ok: true, id: orderId });
}
