// مين يوصله إشعار ومتى. الإرسال يصير بالخلفية (waitUntil) فما يأخّر أي رد
import { HttpError, json, readJson, str } from "./util.js";
import { pushEnabled, sendOne } from "./push.js";
import { getSettings, summarize, loadOrder } from "./flow.js";

const KINDS = ["shop", "driver", "admin", "track"];
const M = 60_000;
const money = n => (Math.round(Number(n) * 100) / 100).toString();
const DEST = { home: "بيت", chalet: "شاليه", park: "المنتزه" };

/* ===== الاشتراكات ===== */
export function publicKey(env) {
  return json({ key: pushEnabled(env) ? env.VAPID_PUBLIC : null });
}

// يحفظ اشتراك الجهاز (أو يحذفه لو off)
export async function subscribe(db, request, kind, ref) {
  const b = await readJson(request, 5000);
  const s = b.sub || {};
  const endpoint = str(s.endpoint, 1000);
  if (b.off) {
    if (endpoint) await db.prepare("DELETE FROM push_subs WHERE endpoint = ?").bind(endpoint).run();
    return json({ ok: true, on: false });
  }
  const p256dh = str(s.keys && s.keys.p256dh, 200), auth = str(s.keys && s.keys.auth, 100);
  if (!/^https:\/\/\S+$/.test(endpoint) || !/^[A-Za-z0-9_-]{80,100}$/.test(p256dh) || !/^[A-Za-z0-9_-]{16,32}$/.test(auth))
    throw new HttpError(400, "الجهاز ما يدعم الإشعارات");
  // نفس الجهاز ممكن ينتقل من حساب لحساب: الاشتراك يتبع آخر واحد سجّل
  await db.prepare(`INSERT INTO push_subs (endpoint, p256dh, auth, kind, ref_id, created_at) VALUES (?,?,?,?,?,?)
    ON CONFLICT(endpoint) DO UPDATE SET p256dh=excluded.p256dh, auth=excluded.auth, kind=excluded.kind, ref_id=excluded.ref_id, fails=0`)
    .bind(endpoint, p256dh, auth, kind, ref ?? null, Date.now()).run();
  return json({ ok: true, on: true });
}

/* ===== الإرسال ===== */
// targets: [[kind, ref|null]] ؛ ref = null يعني الكل من هالنوع
export function notify(e, db, targets, msg) {
  if (!pushEnabled(e) || !targets.length) return;
  const job = (async () => {
    const seen = new Set(), subs = [];
    for (const [kind, ref] of targets) {
      if (!KINDS.includes(kind)) continue;
      const q = ref === null || ref === undefined
        ? (kind === "driver"
          ? db.prepare("SELECT ps.* FROM push_subs ps JOIN drivers d ON d.id = ps.ref_id WHERE ps.kind = 'driver' AND d.active = 1 AND d.on_duty = 1")
          : db.prepare("SELECT * FROM push_subs WHERE kind = ?").bind(kind))
        : db.prepare("SELECT * FROM push_subs WHERE kind = ? AND ref_id = ?").bind(kind, ref);
      for (const s of (await q.all()).results) if (!seen.has(s.endpoint)) { seen.add(s.endpoint); subs.push(s); }
    }
    const subject = e.origin || "https://jalajil-delivery.pages.dev";
    await Promise.all(subs.map(async s => {
      let r = "fail";
      try { r = await sendOne(e, s, msg, subject); } catch (err) { console.error("push", err); }
      if (r === "gone" || (r === "fail" && s.fails >= 9)) await db.prepare("DELETE FROM push_subs WHERE id = ?").bind(s.id).run();
      else if (r === "fail") await db.prepare("UPDATE push_subs SET fails = fails + 1 WHERE id = ?").bind(s.id).run();
      else if (s.fails) await db.prepare("UPDATE push_subs SET fails = 0 WHERE id = ?").bind(s.id).run();
    }));
  })().catch(err => console.error("notify", err));
  if (e.waitUntil) e.waitUntil(job); else return job;
}

/* ===== أحداث الطلب ===== */
// لقطة من الطلب قبل أي تغيير، عشان نقارن بعده ونعرف وش تغيّر
export async function snapshot(db, orderId) {
  const x = await loadOrder(db, "id", orderId);
  if (!x) return null;
  const sum = summarize(x.o, x.parts, await getSettings(db));
  return { o: x.o, parts: x.parts, sum };
}

const trackUrl = o => o.track_token ? "/track/?k=" + o.track_token : null;

// طلب جديد وصل من الزبون
export async function newOrder(e, db, orderId) {
  const s = await snapshot(db, orderId);
  if (!s) return;
  const { o, parts } = s;
  const where = (DEST[o.dest] || "بيت") + (o.place ? " · " + o.place : "");
  // رقم محظور: الطلب ما يوصل للمحلات ولا للمناديب، وصاحب الخدمة بس يدري
  if (o.blocked) {
    notify(e, db, [["admin", null]], { title: "🚫 طلب من رقم محظور " + o.order_no, body: (o.customer_phone || "") + " · ما وصل للمحلات ولا المناديب", url: "/admin/", tag: "o" + o.id });
    return;
  }
  for (const p of parts) if (p.shop_id)
    notify(e, db, [["shop", p.shop_id]], { title: "🔔 طلب جديد " + o.order_no, body: (p.items || "").slice(0, 120), url: "/partner/", tag: "p" + p.id });
  notify(e, db, [["driver", null]], { title: "🛵 طلب جديد متاح", body: `${where} · رسوم ${money(o.fee ?? 0)} ريال`, url: "/driver/", tag: "o" + o.id });
  notify(e, db, [["admin", null]], { title: "طلب جديد " + o.order_no, body: parts.map(p => p.shop_name).filter(Boolean).join("، ") + " · " + where, url: "/admin/", tag: "o" + o.id });
}

// بعد أي تغيير على الطلب: يقارن الحالة قبل وبعد ويبلّغ المعنيين
export async function changed(e, db, before) {
  if (!before) return;
  const after = await snapshot(db, before.o.id);
  if (!after) return;
  if (after.sum.billed && !after.o.billed_at)
    await db.prepare("UPDATE orders SET billed_at = ? WHERE id = ? AND billed_at IS NULL").bind(Date.now(), after.o.id).run();
  if (!pushEnabled(e)) return;
  const { o, parts, sum } = after, no = o.order_no, t = trackUrl(o);
  const st = sum.stage, was = before.sum.stage;
  const customer = (title, body) => notify(e, db, [["track", o.id]], { title, body, url: t || "/", tag: "c" + o.id });
  const driver = (title, body) => o.driver_id && notify(e, db, [["driver", o.driver_id]], { title, body, url: "/driver/", tag: "d" + o.id });
  const admin = (title, body) => notify(e, db, [["admin", null]], { title, body, url: "/admin/", tag: "a" + o.id });

  if (st !== was) {
    if (st === "approve") customer("💰 فاتورة طلبك جاهزة", `المبلغ ${money(sum.total)} ريال` + (parts.some(p => p.shop_note) ? "، وفيه ملاحظة من المحل" : "") + ". افتح ووافق عشان المندوب يشتري");
    if (st === "prepay") customer("💳 حوّل مبلغ طلبك", `المبلغ ${money(sum.total)} ريال يحتاج تحويل قبل الشراء`);
    if (st === "prepay_check") admin("🧾 إيصال تحويل ينتظر تأكيدك", `طلب ${no} · ${money(sum.total)} ريال`);
    if (st === "buying") driver("✅ تقدر تشتري الحين", `طلب ${no}: ${money(sum.total)} ريال` + (o.approved_at ? "، الزبون وافق" : "، تحت حد الموافقة التلقائية"));
    if (st === "onway") customer("🛵 طلبك في الطريق", "جهّز رمز الاستلام للمندوب");
    if (st === "cancelled") {
      driver("❌ الطلب انلغى", `طلب ${no}: لا تشتري شي`);
      for (const p of before.parts) if (p.shop_id && ["new", "accepted"].includes(p.status))
        notify(e, db, [["shop", p.shop_id]], { title: "❌ طلب " + no + " انلغى", body: "لا تجهّزه", url: "/partner/", tag: "p" + p.id });
    }
  }
  // تغييرات على مستوى المحل
  for (const p of parts) {
    const b = before.parts.find(x => x.id === p.id);
    if (!b || b.status === p.status) continue;
    if (p.status === "ready") driver("🍽️ " + (p.shop_name || "المحل") + " جهّز الطلب", `طلب ${no} جاهز للاستلام`);
    if (p.status === "rejected") {
      driver("⚠️ " + (p.shop_name || "المحل") + " رفض", `طلب ${no}: ${p.reject_reason || ""}`);
      admin("⚠️ " + (p.shop_name || "محل") + " رفض طلب " + no, p.reject_reason || "");
    }
  }
  // صاحب الخدمة عيّن مندوب
  if (o.driver_id && o.driver_id !== before.o.driver_id && o.driver_status === "assigned")
    notify(e, db, [["driver", o.driver_id]], { title: "🛵 عندك طلب جديد", body: `طلب ${no} صار معك`, url: "/driver/", tag: "d" + o.id });
}

export function reportAlert(e, db, o, kind) {
  notify(e, db, [["admin", null]], { title: "🚩 بلاغ جديد", body: `طلب ${o.order_no}: ${kind}`, url: "/admin/", tag: "r" + o.id });
}

/* ===== الحارس: طلبات واقفة ===== */
// يشتغل كل ٣٠ ثانية على الأكثر: من أي طلب للسيرفر، ومن cron كل دقيقة
export async function sweep(e, db, force = false) {
  const now = Date.now();
  if (!force) {
    const r = await db.prepare(`INSERT INTO settings (key, value) VALUES ('last_sweep', ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value WHERE CAST(settings.value AS INTEGER) < ?`).bind(String(now), now - 30_000).run();
    if (!r.meta.changes) return 0;
  }
  // المحلات المسكّرة مؤقتاً ترجع مفتوحة لما يخلص وقتها
  await db.prepare("UPDATE shops SET is_open = 1, closed_until = NULL WHERE is_open = 0 AND closed_until IS NOT NULL AND closed_until <= ?").bind(now).run();
  if (!pushEnabled(e)) return 0;
  const settings = await getSettings(db);
  let n = 0;
  // ١) محل ما رد على طلب جديد خلال دقيقتين
  const { results: silent } = await db.prepare(`SELECT p.id, p.shop_id, p.shop_name, o.order_no FROM parts p JOIN orders o ON o.id = p.order_id
    WHERE p.status = 'new' AND p.shop_id IS NOT NULL AND p.nudged_at IS NULL AND o.created_at < ? AND o.created_at > ? AND o.rejected_at IS NULL`)
    .bind(now - 2 * M, now - 6 * 3600_000).all();
  for (const p of silent) {
    const r = await db.prepare("UPDATE parts SET nudged_at = ? WHERE id = ? AND nudged_at IS NULL").bind(now, p.id).run();
    if (!r.meta.changes) continue;
    notify(e, db, [["admin", null]], { title: "⏰ " + (p.shop_name || "محل") + " ما رد", body: `طلب ${p.order_no} من دقيقتين بدون قبول. كلّمه`, url: "/admin/", tag: "n" + p.id });
    notify(e, db, [["shop", p.shop_id]], { title: "⏰ طلب ينتظرك " + p.order_no, body: "الزبون ينتظر، اقبله أو ارفضه", url: "/partner/", tag: "p" + p.id });
    n++;
  }
  // ٢) طلب بدون مندوب ٣ دقايق، و٣) زبون ما وافق على المبلغ ٥ دقايق
  const { results: open } = await db.prepare(`SELECT o.* FROM orders o WHERE o.created_at > ? AND o.rejected_at IS NULL
    AND (o.driver_status IS NULL OR o.driver_status = 'assigned') AND (o.nudge_driver_at IS NULL OR o.nudge_approve_at IS NULL)
    AND EXISTS (SELECT 1 FROM parts x WHERE x.order_id = o.id AND x.status NOT IN ('cancelled','rejected')) LIMIT 100`)
    .bind(now - 6 * 3600_000).all();
  for (const o of open) {
    if (!o.driver_id && !o.nudge_driver_at && o.created_at < now - 3 * M) {
      const r = await db.prepare("UPDATE orders SET nudge_driver_at = ? WHERE id = ? AND nudge_driver_at IS NULL").bind(now, o.id).run();
      if (r.meta.changes) {
        notify(e, db, [["admin", null]], { title: "⏰ طلب " + o.order_no + " بدون مندوب", body: "من ٣ دقايق ما أحد أخذه", url: "/admin/", tag: "nd" + o.id });
        notify(e, db, [["driver", null]], { title: "🛵 طلب ينتظر مندوب", body: (DEST[o.dest] || "بيت") + " · رسوم " + money(o.fee ?? 0) + " ريال", url: "/driver/", tag: "o" + o.id });
        n++;
      }
    }
    if (!o.nudge_approve_at) {
      const { results: parts } = await db.prepare("SELECT * FROM parts WHERE order_id = ?").bind(o.id).all();
      const sum = summarize(o, parts, settings);
      const billedAt = Math.max(0, ...parts.map(p => p.updated_at || 0));
      if (sum.stage === "approve" && billedAt < now - 5 * M) {
        const r = await db.prepare("UPDATE orders SET nudge_approve_at = ? WHERE id = ? AND nudge_approve_at IS NULL").bind(now, o.id).run();
        if (r.meta.changes) {
          notify(e, db, [["admin", null]], { title: "⏰ الزبون ما وافق على المبلغ", body: `طلب ${o.order_no} · ${money(sum.total)} ريال من ٥ دقايق. كلّمه`, url: "/admin/", tag: "na" + o.id });
          notify(e, db, [["track", o.id]], { title: "💰 طلبك ينتظر موافقتك", body: `المبلغ ${money(sum.total)} ريال`, url: trackUrl(o) || "/", tag: "c" + o.id });
          n++;
        }
      }
    }
  }
  return n;
}

// يناديه Worker صغير فيه cron كل دقيقة
export async function cron(e, db, request) {
  const k = request.headers.get("x-cron-secret") || "";
  if (!e.CRON_SECRET || k !== e.CRON_SECRET) throw new HttpError(403, "غير مسموح");
  return json({ ok: true, nudged: await sweep(e, db, true) });
}
