// كل طلبات /api/* تمر من هنا
import { HttpError, json } from "../../server/util.js";
import { ensureSchema } from "../../server/schema.js";
import * as pub from "../../server/orders.js";
import * as partner from "../../server/partner.js";
import * as admin from "../../server/admin.js";
import * as driver from "../../server/driver.js";
import * as flow from "../../server/flow.js";
import * as alerts from "../../server/alerts.js";
import * as fees from "../../server/fees.js";

const routes = [
  ["GET", /^\/api\/shops$/, (db, r) => pub.listShops(db, r)],
  ["POST", /^\/api\/orders$/, (db, r, e) => pub.saveOrder(db, r, e)],
  ["POST", /^\/api\/promo$/, (db, r) => fees.promoCheck(db, r)],
  ["GET", /^\/api\/push\/key$/, (db, r, e) => alerts.publicKey(e)],
  ["POST", /^\/api\/cron$/, (db, r, e) => alerts.cron(e, db, r)],
  ["POST", /^\/api\/partner\/push$/, (db, r) => partner.push(db, r)],
  ["POST", /^\/api\/driver\/push$/, (db, r) => driver.push(db, r)],
  ["POST", /^\/api\/admin\/push$/, (db, r) => admin.push(db, r)],
  ["GET", /^\/api\/admin\/promos$/, (db, r) => admin.promos(db, r)],
  ["POST", /^\/api\/admin\/promos$/, (db, r) => admin.createPromo(db, r)],
  ["PUT", /^\/api\/admin\/promos\/(\d+)$/, (db, r, e, m) => admin.updatePromo(db, r, Number(m[1]))],

  ["POST", /^\/api\/partner\/login$/, (db, r) => partner.login(db, r)],
  ["POST", /^\/api\/partner\/logout$/, (db, r) => partner.logout(db, r)],
  ["GET", /^\/api\/partner\/me$/, (db, r) => partner.me(db, r)],
  ["GET", /^\/api\/partner\/orders$/, (db, r) => partner.orders(db, r)],
  ["POST", /^\/api\/partner\/parts\/(\d+)$/, (db, r, e, m) => partner.act(db, r, Number(m[1]), e)],
  ["POST", /^\/api\/partner\/status$/, (db, r) => partner.setOpen(db, r)],
  ["GET", /^\/api\/partner\/summary$/, (db, r) => partner.summary(db, r)],

  ["POST", /^\/api\/admin\/login$/, (db, r, e) => admin.login(db, r, e)],
  ["POST", /^\/api\/admin\/logout$/, (db, r) => admin.logout(db, r)],
  ["GET", /^\/api\/admin\/me$/, (db, r) => admin.me(db, r)],
  ["GET", /^\/api\/admin\/shops$/, (db, r) => admin.shops(db, r)],
  ["POST", /^\/api\/admin\/shops$/, (db, r) => admin.createShop(db, r)],
  ["PUT", /^\/api\/admin\/shops\/(\d+)$/, (db, r, e, m) => admin.updateShop(db, r, Number(m[1]))],
  ["GET", /^\/api\/admin\/orders$/, (db, r) => admin.orders(db, r)],
  ["POST", /^\/api\/admin\/parts\/(\d+)$/, (db, r, e, m) => admin.actPart(db, r, Number(m[1]), e)],
  ["GET", /^\/api\/admin\/drivers$/, (db, r) => admin.drivers(db, r)],
  ["POST", /^\/api\/admin\/drivers$/, (db, r) => admin.createDriver(db, r)],
  ["PUT", /^\/api\/admin\/drivers\/(\d+)$/, (db, r, e, m) => admin.updateDriver(db, r, Number(m[1]))],
  ["POST", /^\/api\/admin\/orders\/(\d+)\/driver$/, (db, r, e, m) => admin.assignDriver(db, r, Number(m[1]), e)],

  ["GET", /^\/api\/admin\/settings$/, (db, r) => admin.settings(db, r)],
  ["GET", /^\/api\/admin\/reports$/, (db, r) => admin.reports(db, r)],
  ["POST", /^\/api\/admin\/reports\/(\d+)$/, (db, r, e, m) => admin.resolveReport(db, r, Number(m[1]))],
  ["POST", /^\/api\/admin\/drivers\/(\d+)\/settle$/, (db, r, e, m) => admin.settle(db, r, Number(m[1]))],
  ["GET", /^\/api\/driver\/wallet$/, (db, r) => driver.wallet(db, r)],
  ["PUT", /^\/api\/admin\/settings$/, (db, r) => admin.updateSettings(db, r)],
  ["POST", /^\/api\/admin\/orders\/(\d+)\/prepay$/, (db, r, e, m) => admin.prepay(db, r, Number(m[1]), e)],
  ["GET", /^\/api\/admin\/images\/(\d+)$/, (db, r, e, m) => admin.image(db, r, Number(m[1]))],

  ["GET", /^\/api\/track\/([A-Za-z0-9_-]+)$/, (db, r, e, m) => flow.track(db, r, m[1])],
  ["POST", /^\/api\/track\/([A-Za-z0-9_-]+)$/, (db, r, e, m) => flow.trackAct(db, r, m[1], e)],
  ["GET", /^\/api\/track\/([A-Za-z0-9_-]+)\/images\/(\d+)$/, (db, r, e, m) => flow.trackImage(db, r, m[1], Number(m[2]))],

  ["POST", /^\/api\/driver\/parts\/(\d+)\/bill$/, (db, r, e, m) => driver.setBill(db, r, Number(m[1]), e)],
  ["GET", /^\/api\/driver\/images\/(\d+)$/, (db, r, e, m) => driver.image(db, r, Number(m[1]))],
  ["POST", /^\/api\/driver\/login$/, (db, r) => driver.login(db, r)],
  ["POST", /^\/api\/driver\/logout$/, (db, r) => driver.logout(db, r)],
  ["GET", /^\/api\/driver\/me$/, (db, r) => driver.me(db, r)],
  ["GET", /^\/api\/driver\/orders$/, (db, r) => driver.orders(db, r)],
  ["POST", /^\/api\/driver\/orders\/(\d+)$/, (db, r, e, m) => driver.act(db, r, Number(m[1]), e)],
  ["GET", /^\/api\/driver\/summary$/, (db, r) => driver.summary(db, r)],
];

export async function onRequest({ request, env, waitUntil }) {
  const path = new URL(request.url).pathname.replace(/\/+$/, "");
  try {
    // الطلبات اللي تغيّر شي لازم تجي من نفس الموقع
    if (request.method !== "GET") {
      const origin = request.headers.get("origin");
      if (origin && origin !== new URL(request.url).origin) throw new HttpError(403, "مصدر غير مسموح");
    }
    const match = routes.find(([m, re]) => re.test(path));
    if (!match) throw new HttpError(404, "غير موجود");
    const [method, re, handler] = routes.find(([m, re]) => m === request.method && re.test(path)) || [];
    if (!handler) throw new HttpError(405, "طريقة غير مسموحة");
    if (!env.DB) throw new HttpError(503, "قاعدة البيانات ما انربطت للحين (DB)");
    await ensureSchema(env.DB);
    // e = المتغيّرات + waitUntil عشان الإشعارات تنرسل بالخلفية بعد الرد
    const wait = typeof waitUntil === "function" ? p => waitUntil(p) : null;
    const e = { ...env, waitUntil: wait, origin: new URL(request.url).origin };
    // الحارس: يفحص الطلبات الواقفة بالخلفية (مرة كل ٣٠ ثانية على الأكثر)
    if (wait) wait(alerts.sweep(e, env.DB).catch(err => console.error("sweep", err)));
    return await handler(env.DB, request, e, path.match(re));
  } catch (err) {
    if (err instanceof HttpError) return json({ error: err.message }, err.status);
    console.error(err);
    return json({ error: "صار خطأ في السيرفر، جرّب مرة ثانية" }, 500);
  }
}
