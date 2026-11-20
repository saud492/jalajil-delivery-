// لوحة التشغيل: الطلبات الحية، اقتراح المندوب، التحليلات، الزبائن، والتصدير
import { HttpError, json, readJson, str, riyadhSpan, riyadhDate } from "./util.js";
import { requireSession } from "./auth.js";
import { getSettings, summarize } from "./flow.js";

const M = 60_000, H = 60 * M, D = 24 * H, RIYADH = 3 * H;
const r1 = v => Math.round(v * 10) / 10, r2 = v => Math.round(v * 100) / 100;
const avg = a => a.length ? a.reduce((s, x) => s + x, 0) / a.length : null;
const mins = a => { const v = avg(a); return v === null ? null : r1(v / M); };

// كم دقيقة مسموح لكل مرحلة قبل ما تصير «متأخرة»
export const SLA = { pricing: 10, approve: 5, prepay: 15, prepay_check: 5, buying: 25, onway: 30 };
const COLUMN = { pricing: "new", approve: "customer", prepay: "customer", prepay_check: "customer", buying: "buying", onway: "onway", delivered: "done" };

async function partsOf(db, ids) {
  const by = new Map(ids.map(id => [id, []]));
  for (let i = 0; i < ids.length; i += 90) {
    const chunk = ids.slice(i, i + 90);
    const { results } = await db.prepare(`SELECT p.*, s.phone AS shop_phone FROM parts p LEFT JOIN shops s ON s.id = p.shop_id
      WHERE p.order_id IN (${chunk.map(() => "?").join(",")}) ORDER BY p.id`).bind(...chunk).all();
    for (const p of results) by.get(p.order_id).push(p);
  }
  return by;
}

// من متى الطلب واقف في مرحلته الحالية
function stageSince(o, stage) {
  if (stage === "pricing") return o.created_at;
  if (stage === "approve") return o.billed_at || o.created_at;
  if (stage === "prepay" || stage === "prepay_check") return o.approved_at || o.billed_at || o.created_at;
  if (stage === "buying") return Math.max(o.approved_at || 0, o.billed_at || 0) || o.created_at;
  if (stage === "onway") return o.picked_at || o.created_at;
  if (stage === "delivered") return o.delivered_at;
  return o.created_at;
}

/* ===== الطلبات الحية + المناديب ===== */
export async function live(db, request) {
  await requireSession(db, request, "admin");
  const now = Date.now(), settings = await getSettings(db);
  const { results: os } = await db.prepare(`SELECT * FROM orders WHERE created_at > ? AND rejected_at IS NULL
    AND (driver_status IS NULL OR driver_status IN ('assigned','picked') OR (driver_status = 'delivered' AND delivered_at > ?))
    ORDER BY created_at LIMIT 300`).bind(now - D, now - 2 * H).all();
  const pm = await partsOf(db, os.map(o => o.id));
  const drv = new Map((await db.prepare("SELECT id, name, phone FROM drivers").all()).results.map(d => [d.id, d]));
  const { results: rep } = os.length ? await db.prepare(`SELECT order_id, COUNT(*) AS n FROM reports WHERE status = 'open' AND order_id IN (${os.map(() => "?").join(",")}) GROUP BY order_id`).bind(...os.map(o => o.id)).all() : { results: [] };
  const openRep = new Map(rep.map(r => [r.order_id, r.n]));
  const orders = [];
  for (const o of os) {
    const parts = pm.get(o.id), sum = summarize(o, parts, settings);
    if (sum.stage === "cancelled") continue;
    const since = stageSince(o, sum.stage), sla = SLA[sum.stage];
    const late = sla ? (now - since) / (sla * M) : 0;
    orders.push({
      id: o.id, order_no: o.order_no, created_at: o.created_at, dest: o.dest, place: o.place, map_url: o.map_url, pay: o.pay, note: o.note,
      customer_name: o.customer_name, customer_phone: o.customer_phone, track: o.track_token ? "/track/?k=" + o.track_token : null,
      fee: o.fee, promo: o.promo, blocked: !!o.blocked, reports: openRep.get(o.id) || 0,
      driver: o.driver_id ? drv.get(o.driver_id) || null : null, driver_status: o.driver_status,
      stage: sum.stage, column: COLUMN[sum.stage] || "new", since, sla, level: sum.stage === "delivered" ? "done" : late >= 1 ? "red" : late >= 0.7 ? "yellow" : "green",
      total: sum.total, billed: sum.billed, auto_approved: sum.auto_approved, prepay_status: o.prepay_status,
      parts: parts.map(p => ({ id: p.id, shop_name: p.shop_name, category: p.category, items: p.items, status: p.status, bill: p.bill, partner: !!p.shop_id, shop_phone: p.shop_phone, shop_note: p.shop_note, prep_minutes: p.prep_minutes, accepted_at: p.accepted_at })),
    });
  }
  return json({ now, orders, drivers: await driverBoard(db, now) });
}

// المناديب مرتبين للاقتراح: الشغّال أول، الأقل طلبات معه، الأعلى تقييم، واللي صار له أطول بدون توصيلة
export async function driverBoard(db, now = Date.now()) {
  const { results } = await db.prepare(`SELECT d.id, d.name, d.phone, d.on_duty,
      (SELECT COUNT(*) FROM orders o WHERE o.driver_id = d.id AND o.driver_status IN ('assigned','picked')) AS load,
      (SELECT MAX(delivered_at) FROM orders o WHERE o.driver_id = d.id AND o.driver_status = 'delivered') AS last_delivered,
      (SELECT AVG(driver_stars) FROM ratings r WHERE r.driver_id = d.id) AS rating,
      (SELECT COUNT(*) FROM ratings r WHERE r.driver_id = d.id) AS rating_count
    FROM drivers d WHERE d.active = 1`).all();
  const score = d => [d.on_duty ? 0 : 1, d.load, -(d.rating_count >= 3 ? d.rating : 4), d.last_delivered || 0];
  results.sort((a, b) => { const x = score(a), y = score(b); for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return x[i] - y[i]; return 0; });
  return results.map((d, i) => ({ id: d.id, name: d.name, phone: d.phone, on_duty: !!d.on_duty, load: d.load,
    last_delivered: d.last_delivered, rating: d.rating_count ? r1(d.rating) : null, suggested: i === 0 && !!d.on_duty }));
}

/* ===== التحليلات ===== */
function buildStats(os, partsBy, settings, a, b) {
  const live = os.filter(o => !o.blocked);
  const sums = new Map(live.map(o => [o.id, summarize(o, partsBy.get(o.id) || [], settings)]));
  const delivered = live.filter(o => o.driver_status === "delivered");
  const cancelled = live.filter(o => sums.get(o.id).stage === "cancelled");
  const allParts = live.flatMap(o => partsBy.get(o.id) || []);
  const fees = delivered.reduce((s, o) => s + (Number(o.fee) || 0), 0);
  const share = delivered.reduce((s, o) => s + (Number(o.driver_share ?? o.fee) || 0), 0);
  const discounts = delivered.reduce((s, o) => s + Math.max(0, (Number(o.fee_full ?? o.fee) || 0) - (Number(o.fee) || 0)), 0);
  const commissions = allParts.filter(p => p.status === "ready").reduce((s, p) => s + (Number(p.commission) || 0), 0);
  const sales = delivered.reduce((s, o) => s + sums.get(o.id).total, 0);
  return {
    orders: live.length, delivered: delivered.length, cancelled: cancelled.length,
    cancel_rate: live.length ? r1(cancelled.length / live.length * 100) : 0,
    avg_delivery: mins(delivered.map(o => o.delivered_at - o.created_at)),
    sales: r2(sales), fees: r2(fees), driver_share: r2(share), discounts: r2(discounts), commissions: r2(commissions),
    net: r2(fees - share + commissions),
    stages: {
      shop_accept: mins(allParts.filter(p => p.shop_id && p.accepted_at).map(p => p.accepted_at - live.find(o => o.id === p.order_id).created_at)),
      customer_approve: mins(live.filter(o => o.approved_at && o.billed_at).map(o => o.approved_at - o.billed_at)),
      buy: mins(live.filter(o => o.picked_at && (o.approved_at || o.billed_at)).map(o => o.picked_at - Math.max(o.approved_at || 0, o.billed_at || 0))),
      travel: mins(delivered.filter(o => o.picked_at).map(o => o.delivered_at - o.picked_at)),
    },
  };
}

async function ordersIn(db, a, b) {
  const { results } = await db.prepare("SELECT * FROM orders WHERE created_at >= ? AND created_at < ? ORDER BY created_at LIMIT 20000").bind(a, b).all();
  return { os: results, partsBy: await partsOf(db, results.map(o => o.id)) };
}

export async function analytics(db, request) {
  await requireSession(db, request, "admin");
  const u = new URL(request.url);
  const [a, b] = riyadhSpan(u.searchParams.get("from"), u.searchParams.get("to"));
  const settings = await getSettings(db);
  const cur = await ordersIn(db, a, b), prev = await ordersIn(db, a - (b - a), a);
  const stats = buildStats(cur.os, cur.partsBy, settings, a, b);
  const before = buildStats(prev.os, prev.partsBy, settings, a - (b - a), a);

  // يومياً
  const days = [];
  for (let t = a; t < b; t += D) days.push({ date: riyadhDate(t), orders: 0, delivered: 0, net: 0 });
  const dayIdx = t => Math.floor((t - a) / D);
  // أوقات الذروة: يوم الأسبوع × الساعة بتوقيت الرياض
  const heat = Array.from({ length: 7 }, () => Array(24).fill(0));
  for (const o of cur.os) {
    if (o.blocked) continue;
    const d = days[dayIdx(o.created_at)]; if (d) d.orders++;
    const l = new Date(o.created_at + RIYADH); heat[l.getUTCDay()][l.getUTCHours()]++;
    if (o.driver_status === "delivered") {
      const dd = days[dayIdx(o.created_at)];
      if (dd) { dd.delivered++; dd.net = r2(dd.net + (Number(o.fee) || 0) - (Number(o.driver_share ?? o.fee) || 0)); }
    }
  }
  for (const p of [...cur.partsBy.values()].flat()) if (p.status === "ready" && p.ready_at) { const d = days[dayIdx(p.ready_at)]; if (d) d.net = r2(d.net + (Number(p.commission) || 0)); }

  // أداء المحلات
  const shopRows = (await db.prepare("SELECT id, name FROM shops").all()).results;
  const created = new Map(cur.os.map(o => [o.id, o.created_at]));
  const shops = shopRows.map(s => {
    const ps = [...cur.partsBy.values()].flat().filter(p => p.shop_id === s.id && !cur.os.find(o => o.id === p.order_id).blocked);
    const accepted = ps.filter(p => p.accepted_at), ready = ps.filter(p => p.status === "ready");
    const timed = ready.filter(p => p.accepted_at && p.prep_minutes);
    const stars = ps.filter(p => p.shop_stars).map(p => p.shop_stars);
    return { id: s.id, name: s.name, orders: ps.length, accepted: accepted.length, rejected: ps.filter(p => p.status === "rejected").length,
      accept_rate: ps.length ? r1(accepted.length / ps.length * 100) : null,
      accept_minutes: mins(accepted.map(p => p.accepted_at - created.get(p.order_id))),
      on_time: timed.length ? r1(timed.filter(p => p.ready_at <= p.accepted_at + p.prep_minutes * M + M).length / timed.length * 100) : null,
      rating: stars.length ? r1(avg(stars)) : null, sales: r2(ready.reduce((t, p) => t + (Number(p.bill) || 0), 0)),
      commission: r2(ready.reduce((t, p) => t + (Number(p.commission) || 0), 0)) };
  }).filter(s => s.orders).sort((x, y) => y.orders - x.orders);

  // أداء المناديب
  const drvRows = (await db.prepare("SELECT id, name FROM drivers").all()).results;
  const ids = cur.os.map(o => o.id);
  const ratings = ids.length ? (await db.prepare(`SELECT order_id, driver_id, driver_stars FROM ratings WHERE order_id IN (SELECT id FROM orders WHERE created_at >= ? AND created_at < ?)`).bind(a, b).all()).results : [];
  const complaints = ids.length ? (await db.prepare(`SELECT driver_id, COUNT(*) AS n FROM reports WHERE (source IS NULL OR source != 'driver') AND created_at >= ? AND created_at < ? GROUP BY driver_id`).bind(a, b).all()).results : [];
  const drivers = drvRows.map(d => {
    const del = cur.os.filter(o => o.driver_id === d.id && o.driver_status === "delivered" && !o.blocked);
    const st = ratings.filter(r => r.driver_id === d.id).map(r => r.driver_stars);
    return { id: d.id, name: d.name, delivered: del.length, minutes: mins(del.filter(o => o.assigned_at).map(o => o.delivered_at - o.assigned_at)),
      rating: st.length ? r1(avg(st)) : null, complaints: (complaints.find(c => c.driver_id === d.id) || {}).n || 0,
      earned: r2(del.reduce((t, o) => t + (Number(o.driver_share ?? o.fee) || 0), 0)) };
  }).filter(d => d.delivered || d.complaints).sort((x, y) => y.delivered - x.delivered);

  return json({ from: riyadhDate(a), to: riyadhDate(b - D), stats, before, days, heat, shops, drivers });
}

/* ===== الزبائن ===== */
export async function customers(db, request) {
  await requireSession(db, request, "admin");
  const u = new URL(request.url), q = str(u.searchParams.get("q"), 40).toLowerCase(), seg = u.searchParams.get("segment") || "";
  const now = Date.now(), settings = await getSettings(db);
  const { results: os } = await db.prepare(`SELECT * FROM orders WHERE phone_key IS NOT NULL AND phone_key != '' ORDER BY created_at DESC LIMIT 20000`).all();
  const partsBy = await partsOf(db, os.map(o => o.id));
  const { results: rep } = await db.prepare("SELECT order_id FROM reports WHERE source IS NULL OR source != 'driver'").all();
  const complaints = new Set(rep.map(r => r.order_id));
  const meta = new Map((await db.prepare("SELECT * FROM customers").all()).results.map(c => [c.phone_key, c]));
  const by = new Map();
  for (const o of os) {
    let c = by.get(o.phone_key);
    if (!c) { c = { phone_key: o.phone_key, name: o.customer_name, phone: o.customer_phone, orders: 0, delivered: 0, spent: 0, first: o.created_at, last: o.created_at, complaints: 0, promos: 0 }; by.set(o.phone_key, c); }
    c.orders++; c.first = Math.min(c.first, o.created_at);
    if (o.promo) c.promos++;
    if (complaints.has(o.id)) c.complaints++;
    if (o.driver_status === "delivered") { c.delivered++; c.spent += summarize(o, partsBy.get(o.id) || [], settings).total + (Number(o.fee) || 0); }
  }
  let list = [...by.values()].map(c => {
    const m = meta.get(c.phone_key) || {};
    const segment = c.last < now - 30 * D ? "inactive" : c.orders >= 2 ? "returning" : "new";
    return { ...c, spent: r2(c.spent), segment, blocked: !!m.blocked, reason: m.reason || "", note: m.note || "" };
  });
  for (const [k, m] of meta) if (!by.has(k) && m.blocked) list.push({ phone_key: k, name: "", phone: k, orders: 0, delivered: 0, spent: 0, first: null, last: null, complaints: 0, promos: 0, segment: "new", blocked: true, reason: m.reason || "", note: m.note || "" });
  const counts = { all: list.length, new: 0, returning: 0, inactive: 0, blocked: 0 };
  for (const c of list) { counts[c.segment]++; if (c.blocked) counts.blocked++; }
  if (seg === "blocked") list = list.filter(c => c.blocked); else if (seg) list = list.filter(c => c.segment === seg);
  if (q) list = list.filter(c => (c.name || "").toLowerCase().includes(q) || (c.phone || "").includes(q) || c.phone_key.includes(q));
  list.sort((x, y) => (y.last || 0) - (x.last || 0));
  return json({ customers: list.slice(0, 300), counts, total: list.length });
}

export async function updateCustomer(db, request, key) {
  await requireSession(db, request, "admin");
  if (!/^\d{8,15}$/.test(key)) throw new HttpError(400, "رقم غير صحيح");
  const b = await readJson(request);
  const cur = await db.prepare("SELECT * FROM customers WHERE phone_key = ?").bind(key).first() || {};
  const v = {
    blocked: b.blocked === undefined ? (cur.blocked || 0) : (b.blocked ? 1 : 0),
    reason: b.reason === undefined ? (cur.reason || null) : str(b.reason, 120) || null,
    note: b.note === undefined ? (cur.note || null) : str(b.note, 500) || null,
  };
  await db.prepare(`INSERT INTO customers (phone_key, blocked, reason, note, updated_at) VALUES (?,?,?,?,?)
    ON CONFLICT(phone_key) DO UPDATE SET blocked = excluded.blocked, reason = excluded.reason, note = excluded.note, updated_at = excluded.updated_at`)
    .bind(key, v.blocked, v.reason, v.note, Date.now()).run();
  return json({ ok: true, ...v, blocked: !!v.blocked });
}

/* ===== تصدير Excel (CSV بترميز يفتحه Excel بالعربي) ===== */
const cell = v => { const s = v === null || v === undefined ? "" : String(v); return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
const csv = rows => "﻿" + rows.map(r => r.map(cell).join(",")).join("\r\n");
const when = ms => ms ? new Date(ms + RIYADH).toISOString().slice(0, 16).replace("T", " ") : "";
const DEST = { home: "بيت", chalet: "شاليه", park: "المنتزه" };
const STAGE = { pricing: "ينتظر الفاتورة", approve: "ينتظر موافقة الزبون", prepay: "ينتظر التحويل", prepay_check: "تأكيد التحويل", buying: "يشتري", onway: "في الطريق", delivered: "وصل", cancelled: "ملغي" };

export async function exportCsv(db, request) {
  await requireSession(db, request, "admin");
  const u = new URL(request.url), type = u.searchParams.get("type");
  const [a, b] = riyadhSpan(u.searchParams.get("from"), u.searchParams.get("to"));
  const settings = await getSettings(db);
  let rows;
  if (type === "orders") {
    const { os, partsBy } = await ordersIn(db, a, b);
    const drv = new Map((await db.prepare("SELECT id, name FROM drivers").all()).results.map(d => [d.id, d.name]));
    rows = [["رقم الطلب", "التاريخ", "الزبون", "الجوال", "الوجهة", "المكان", "المحلات", "الحالة", "المشتريات", "رسوم التوصيل", "الخصم", "الكود", "المندوب", "نصيب المندوب", "الدفع", "وقت التوصيل (دقيقة)"]];
    for (const o of os) {
      const ps = partsBy.get(o.id) || [], s = summarize(o, ps, settings);
      rows.push([o.order_no, when(o.created_at), o.customer_name, o.customer_phone, DEST[o.dest] || o.dest, o.place, ps.map(p => p.shop_name).filter(Boolean).join(" + "),
        (o.blocked ? "محظور · " : "") + (STAGE[s.stage] || s.stage), s.billed ? s.total : "", o.fee ?? "", r2(Math.max(0, (o.fee_full ?? o.fee ?? 0) - (o.fee ?? 0))) || "", o.promo,
        o.driver_id ? drv.get(o.driver_id) || "" : "", o.driver_status === "delivered" ? (o.driver_share ?? o.fee) : "", o.pay,
        o.delivered_at ? Math.round((o.delivered_at - o.created_at) / M) : ""]);
    }
  } else if (type === "shops") {
    const { results } = await db.prepare(`SELECT s.name, COUNT(p.id) AS n, COALESCE(SUM(p.bill),0) AS bills, COALESCE(SUM(p.commission),0) AS com
      FROM shops s LEFT JOIN parts p ON p.shop_id = s.id AND p.status = 'ready' AND p.ready_at >= ? AND p.ready_at < ? GROUP BY s.id ORDER BY n DESC`).bind(a, b).all();
    rows = [["المحل", "طلبات مكتملة", "مجموع الفواتير", "العمولة"], ...results.map(r => [r.name, r.n, r2(r.bills), r2(r.com)])];
  } else if (type === "drivers") {
    const { results } = await db.prepare(`SELECT d.name, d.phone, COUNT(o.id) AS n, COALESCE(SUM(o.fee),0) AS fees, COALESCE(SUM(COALESCE(o.driver_share, o.fee)),0) AS earned
      FROM drivers d LEFT JOIN orders o ON o.driver_id = d.id AND o.driver_status = 'delivered' AND o.delivered_at >= ? AND o.delivered_at < ? GROUP BY d.id ORDER BY n DESC`).bind(a, b).all();
    rows = [["المندوب", "الجوال", "توصيلات", "رسوم التوصيل", "نصيبه"], ...results.map(r => [r.name, r.phone, r.n, r2(r.fees), r2(r.earned)])];
  } else throw new HttpError(400, "نوع التصدير غير معروف");
  return new Response(csv(rows), { headers: { "content-type": "text/csv; charset=utf-8", "cache-control": "no-store",
    "content-disposition": `attachment; filename="jalajil-${type}-${riyadhDate(a)}_${riyadhDate(b - D)}.csv"` } });
}
