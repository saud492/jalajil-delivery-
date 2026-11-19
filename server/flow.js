// حماية الزبون والمندوب: مبلغ الفاتورة، موافقة الزبون، الدفع المسبق، ورمز الاستلام
import { HttpError, json, readJson, str } from "./util.js";

/* ===== الإعدادات ===== */
const DEFAULTS = { prepay_cap: "150", pay_info: "", support: "966582312869", driver_share: "100" };

export async function getSettings(db) {
  const { results } = await db.prepare("SELECT key, value FROM settings").all();
  const s = { ...DEFAULTS };
  for (const r of results) if (r.key in DEFAULTS) s[r.key] = r.value ?? "";
  const share = Number(s.driver_share);
  return { prepay_cap: Math.max(0, Number(s.prepay_cap) || 0), pay_info: s.pay_info, support: s.support,
    driver_share: Number.isFinite(share) ? Math.min(100, Math.max(0, share)) : 100 };
}

export async function saveSettings(db, b) {
  const rows = [];
  if (b.driver_share !== undefined) {
    const c = Number(String(b.driver_share).replace(/[٠-٩]/g, d => "٠١٢٣٤٥٦٧٨٩".indexOf(d)));
    if (!Number.isFinite(c) || c < 0 || c > 100) throw new HttpError(400, "نصيب المندوب نسبة من ٠ إلى ١٠٠");
    rows.push(["driver_share", String(c)]);
  }
  if (b.prepay_cap !== undefined) {
    const c = Number(String(b.prepay_cap).replace(/[٠-٩]/g, d => "٠١٢٣٤٥٦٧٨٩".indexOf(d)));
    if (!Number.isFinite(c) || c < 0 || c > 100000) throw new HttpError(400, "حد الدفع المسبق رقم بالريال (صفر = بدون دفع مسبق)");
    rows.push(["prepay_cap", String(Math.round(c * 100) / 100)]);
  }
  if (b.pay_info !== undefined) rows.push(["pay_info", str(b.pay_info, 500)]);
  if (b.support !== undefined) {
    const n = str(b.support, 20).replace(/[٠-٩]/g, d => "٠١٢٣٤٥٦٧٨٩".indexOf(d)).replace(/\D/g, "");
    if (n && !/^\d{8,15}$/.test(n)) throw new HttpError(400, "رقم الواتساب للشكاوى غير صحيح");
    rows.push(["support", n]);
  }
  if (rows.length) await db.batch(rows.map(([k, v]) => db.prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").bind(k, v)));
}

/* ===== حالة الطلب المالية ===== */
const DEAD = ["cancelled", "rejected"];
const close = (a, b) => Math.abs(a - b) < 0.005;

// يحسب كل شي يحتاجه الزبون والمندوب واللوحة من الطلب وأجزائه
export function summarize(o, parts, settings) {
  const live = parts.filter(p => !DEAD.includes(p.status));
  const billed = live.length > 0 && live.every(p => p.bill !== null && p.bill !== undefined);
  const total = Math.round(live.reduce((s, p) => s + (Number(p.bill) || 0), 0) * 100) / 100;
  const approved = billed && o.approved_total !== null && o.approved_total !== undefined && close(o.approved_total, total);
  const needsPrepay = settings.prepay_cap > 0 && total > settings.prepay_cap;
  const prepaid = o.prepay_status === "confirmed" && o.prepay_amount !== null && o.prepay_amount >= total - 0.005;
  const canBuy = billed && approved && (!needsPrepay || prepaid);
  let stage;
  if (o.rejected_at || (parts.length && !live.length)) stage = "cancelled";
  else if (o.driver_status === "delivered") stage = "delivered";
  else if (o.driver_status === "picked") stage = "onway";
  else if (!billed) stage = "pricing";
  else if (!approved) stage = "approve";
  else if (needsPrepay && !prepaid) stage = o.prepay_status === "sent" ? "prepay_check" : "prepay";
  else stage = "buying";
  const fee = Number(o.fee) || 0;
  return { billed, total, approved, needsPrepay, prepaid, canBuy, stage, collect: Math.round(((prepaid ? 0 : total) + fee) * 100) / 100 };
}

export async function loadOrder(db, where, val) {
  const o = await db.prepare(`SELECT * FROM orders WHERE ${where} = ?`).bind(val).first();
  if (!o) return null;
  const { results } = await db.prepare("SELECT * FROM parts WHERE order_id = ? ORDER BY id").bind(o.id).all();
  return { o, parts: results };
}

/* ===== الصور ===== */
// صورة مضغوطة من الجوال بصيغة data URL، حدها تقريباً ٦٠٠ كيلو
export function parseImage(v) {
  const m = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(String(v || ""));
  if (!m) throw new HttpError(400, "صوّر الفاتورة أو الإيصال");
  if (m[2].length > 900000) throw new HttpError(413, "الصورة كبيرة مرة، صوّرها مرة ثانية");
  return { mime: m[1], data: m[2] };
}

export async function saveImage(db, orderId, kind, img) {
  const r = await db.prepare("INSERT INTO receipts (order_id, kind, mime, data, created_at) VALUES (?,?,?,?,?) RETURNING id")
    .bind(orderId, kind, img.mime, img.data, Date.now()).first();
  return r.id;
}

export async function sendImage(db, orderId, id) {
  const r = await db.prepare("SELECT mime, data FROM receipts WHERE id = ? AND order_id = ?").bind(id, orderId).first();
  if (!r) throw new HttpError(404, "الصورة مو موجودة");
  const bin = Uint8Array.from(atob(r.data), c => c.charCodeAt(0));
  return new Response(bin, { headers: { "content-type": r.mime, "cache-control": "private, max-age=3600" } });
}

/* ===== صفحة متابعة الزبون (بالرابط السري بس) ===== */
async function byToken(db, token) {
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(token)) throw new HttpError(404, "الطلب مو موجود");
  const x = await loadOrder(db, "track_token", token);
  if (!x) throw new HttpError(404, "الطلب مو موجود، يمكن للحين ما وصل. جرّب بعد شوي");
  return x;
}

export async function track(db, request, token) {
  const { o, parts } = await byToken(db, token);
  const settings = await getSettings(db);
  const sum = summarize(o, parts, settings);
  const driver = o.driver_id ? await db.prepare("SELECT name, phone FROM drivers WHERE id = ?").bind(o.driver_id).first() : null;
  const rating = await db.prepare("SELECT driver_stars, tags, comment FROM ratings WHERE order_id = ?").bind(o.id).first();
  const { results: reports } = await db.prepare("SELECT kind, note, status, resolution, created_at FROM reports WHERE order_id = ? ORDER BY id").bind(o.id).all();
  return json({
    order: {
      order_no: o.order_no, created_at: o.created_at, dest: o.dest, place: o.place, pay: o.pay, fee: o.fee,
      driver_status: o.driver_status, picked_at: o.picked_at, delivered_at: o.delivered_at,
      prepay_status: o.prepay_status, leave_at_door: !!o.leave_at_door, delivery_photo: o.delivery_photo,
    },
    parts: parts.map(p => ({ id: p.id, shop_name: p.shop_name, category: p.category, items: p.items, status: p.status, bill: p.bill, receipt: p.bill_receipt, partner: !!p.shop_id, shop_stars: p.shop_stars })),
    driver: driver && { name: driver.name, phone: driver.phone },
    eta: eta(o, parts, sum.stage),
    rating: rating && { driver_stars: rating.driver_stars, tags: safeTags(rating.tags), comment: rating.comment },
    reports,
    report_kinds: REPORT_KINDS, rating_tags: RATING_TAGS,
    ...sum,
    prepay_cap: settings.prepay_cap,
    pay_info: sum.needsPrepay ? settings.pay_info : "",
    support: settings.support,
    now: Date.now(),
  });
}

const safeTags = s => { try { const a = JSON.parse(s || "[]"); return Array.isArray(a) ? a : []; } catch { return []; } };

// وقت الوصول المتوقع (تقريبي): وقت تجهيز المحل + ١٠ دقايق شراء واستلام + وقت الطريق
const TRAVEL = { home: 15, chalet: 25, park: 25 };
function eta(o, parts, stage) {
  const M = 60_000, now = Date.now(), travel = (TRAVEL[o.dest] || 20) * M;
  if (stage === "onway") return Math.max(now + 3 * M, (o.picked_at || now) + travel);
  if (stage !== "buying") return null;
  let ready = now;
  for (const p of parts) {
    if (!p.shop_id || ["cancelled", "rejected"].includes(p.status)) continue;
    const t = p.ready_at || (p.accepted_at && p.prep_minutes ? p.accepted_at + p.prep_minutes * M : now + 15 * M);
    ready = Math.max(ready, t);
  }
  return ready + 10 * M + travel;
}

export const REPORT_KINDS = ["ناقص غرض", "غلط في الطلب", "تأخير", "المندوب طلب مبلغ زيادة", "تعامل المندوب", "الطلب ما وصل", "شي ثاني"];
export const RATING_TAGS = ["وصل بسرعة", "تعامل ممتاز", "حافظ على الطلب", "تأخر", "تعامل سيء", "ما التزم بالمبلغ"];

export async function trackAct(db, request, token) {
  const b = await readJson(request, 1_000_000);
  const { o, parts } = await byToken(db, token);
  const settings = await getSettings(db);
  const sum = summarize(o, parts, settings);
  const now = Date.now();

  // البلاغ مسموح في أي وقت، وحده أقصى ٥ بلاغات لكل طلب
  if (b.action === "report") {
    const kind = str(b.kind, 40);
    if (!REPORT_KINDS.includes(kind)) throw new HttpError(400, "اختر نوع المشكلة");
    const n = await db.prepare("SELECT COUNT(*) AS n FROM reports WHERE order_id = ?").bind(o.id).first();
    if (n.n >= 5) throw new HttpError(429, "وصلنا بلاغاتك، بنتواصل معك");
    const image = b.image ? await saveImage(db, o.id, "report", parseImage(b.image)) : null;
    await db.prepare("INSERT INTO reports (order_id, driver_id, kind, note, image_id, created_at) VALUES (?,?,?,?,?,?)")
      .bind(o.id, o.driver_id, kind, str(b.note, 500), image, now).run();
    return json({ ok: true });
  }
  // التقييم بعد التوصيل، مرة وحدة
  if (b.action === "rate") {
    if (sum.stage !== "delivered") throw new HttpError(409, "تقدر تقيّم بعد ما يوصل طلبك");
    const stars = Number(b.driver_stars);
    if (!Number.isInteger(stars) || stars < 1 || stars > 5) throw new HttpError(400, "اختر عدد النجوم");
    const tags = (Array.isArray(b.tags) ? b.tags : []).filter(t => RATING_TAGS.includes(t)).slice(0, 6);
    const r = await db.prepare("INSERT INTO ratings (order_id, driver_id, driver_stars, tags, comment, created_at) VALUES (?,?,?,?,?,?) ON CONFLICT(order_id) DO NOTHING")
      .bind(o.id, o.driver_id, stars, JSON.stringify(tags), str(b.comment, 300), now).run();
    if (!r.meta.changes) throw new HttpError(409, "قيّمت هالطلب من قبل، شكراً لك");
    const shops = Array.isArray(b.shops) ? b.shops : [];
    const stmts = [];
    for (const s of shops) {
      const st = Number(s && s.stars), pid = Number(s && s.part);
      if (Number.isInteger(st) && st >= 1 && st <= 5 && parts.some(p => p.id === pid && p.shop_id))
        stmts.push(db.prepare("UPDATE parts SET shop_stars = ? WHERE id = ? AND order_id = ?").bind(st, pid, o.id));
    }
    if (stmts.length) await db.batch(stmts);
    return json({ ok: true });
  }
  if (["cancelled", "delivered"].includes(sum.stage)) throw new HttpError(409, "ما تقدر تغيّر الطلب الحين");
  // اتركه عند الباب: المندوب يسلّم بصورة بدل الرمز
  if (b.action === "door") {
    await db.prepare("UPDATE orders SET leave_at_door = ? WHERE id = ?").bind(b.on ? 1 : 0, o.id).run();
    return json({ ok: true });
  }
  if (sum.stage === "onway") throw new HttpError(409, "ما تقدر تغيّر الطلب الحين");

  if (b.action === "approve") {
    if (!sum.billed) throw new HttpError(409, "الفاتورة للحين ما اكتملت");
    if (b.total === undefined || !close(Number(b.total), sum.total)) throw new HttpError(409, "المبلغ تغيّر، حدّث الصفحة وشوفه");
    await db.prepare("UPDATE orders SET approved_total=?, approved_at=? WHERE id=?").bind(sum.total, now, o.id).run();
    return json({ ok: true });
  }
  if (b.action === "reject") {
    await db.batch([
      db.prepare("UPDATE orders SET rejected_at=?, driver_status=CASE WHEN driver_id IS NULL THEN NULL ELSE 'cancelled' END WHERE id=?").bind(now, o.id),
      db.prepare("UPDATE parts SET status='cancelled', commission=0, updated_at=? WHERE order_id=? AND status NOT IN ('cancelled','rejected')").bind(now, o.id),
    ]);
    return json({ ok: true });
  }
  if (b.action === "prepay") {
    if (!sum.approved || !sum.needsPrepay) throw new HttpError(409, "الطلب ما يحتاج دفع مسبق الحين");
    if (sum.prepaid) throw new HttpError(409, "التحويل مأكد من قبل");
    const id = await saveImage(db, o.id, "transfer", parseImage(b.image));
    await db.prepare("UPDATE orders SET prepay_status='sent', prepay_receipt=? WHERE id=?").bind(id, o.id).run();
    return json({ ok: true });
  }
  throw new HttpError(400, "إجراء غير معروف");
}

export async function trackImage(db, request, token, id) {
  const { o } = await byToken(db, token);
  return sendImage(db, o.id, id);
}
