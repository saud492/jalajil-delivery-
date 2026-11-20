// أدوات مشتركة للسيرفر

export class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

export function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers },
  });
}

export async function readJson(request, maxBytes = 20000) {
  const ct = request.headers.get("content-type") || "";
  // نقبل text/plain عشان sendBeacon، وغيره لازم JSON
  if (!/application\/json|text\/plain/i.test(ct)) throw new HttpError(415, "صيغة الطلب غير مدعومة");
  const text = await request.text();
  if (text.length > maxBytes) throw new HttpError(413, "الطلب كبير مرة");
  try { return JSON.parse(text || "{}"); } catch { throw new HttpError(400, "بيانات غير صحيحة"); }
}

// نص بطول محدد، أو فاضي
export function str(v, max) {
  if (v === undefined || v === null) return "";
  return String(v).replace(/\u0000/g, "").trim().slice(0, max);
}

const H = 3600_000, D = 24 * H;
const RIYADH = 3 * H; // الرياض UTC+3 بدون توقيت صيفي

// تاريخ اليوم بتوقيت الرياض بصيغة YYYY-MM-DD
export function riyadhDate(ms) {
  return new Date(ms + RIYADH).toISOString().slice(0, 10);
}

// بداية الأسبوع (السبت) وبداية الشهر بتوقيت الرياض، بالملي ثانية
export function riyadhRanges(nowMs) {
  const local = new Date(nowMs + RIYADH);
  const dayStartLocal = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate());
  const sinceSaturday = (local.getUTCDay() + 1) % 7; // السبت = 6 في getUTCDay
  const weekStart = dayStartLocal - sinceSaturday * D - RIYADH;
  const monthStart = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), 1) - RIYADH;
  return { weekStart, monthStart, dayStart: dayStartLocal - RIYADH };
}

// من تاريخ لين تاريخ (YYYY-MM-DD بتوقيت الرياض، شامل) → [بداية، نهاية) بالملي ثانية. أقصى سنة
export function riyadhSpan(from, to) {
  const ok = v => /^\d{4}-\d{2}-\d{2}$/.test(String(v || ""));
  if (!ok(from) || !ok(to)) throw new HttpError(400, "اختر الفترة");
  const a = Date.parse(from + "T00:00:00Z") - RIYADH, b = Date.parse(to + "T00:00:00Z") - RIYADH + D;
  if (!Number.isFinite(a) || !Number.isFinite(b) || b <= a) throw new HttpError(400, "الفترة غير صحيحة");
  if (b - a > 367 * D) throw new HttpError(400, "الفترة أطول من سنة");
  return [a, b];
}

// المحل المسكّر مؤقتاً يرجع مفتوح لحاله لما يخلص الوقت
export const shopOpen = (s, now = Date.now()) => !!s.is_open || (s.closed_until != null && s.closed_until <= now);

// العمولة لطلب جاهز: صفر داخل فترة التجربة (لين تاريخ نهايتها ضمناً)
export function commissionFor(shop, readyMs) {
  const amount = Number(shop.commission) || 0;
  if (shop.trial_end && riyadhDate(readyMs) <= shop.trial_end) return 0;
  return Math.round(amount * 100) / 100;
}

export function randomToken(bytes = 32) {
  const a = new Uint8Array(bytes);
  crypto.getRandomValues(a);
  return b64url(a);
}

export function b64url(buf) {
  const a = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = "";
  for (const x of a) s += String.fromCharCode(x);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function fromB64url(s) {
  const b = atob(s.replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(b, c => c.charCodeAt(0));
}

export async function sha256(text) {
  return b64url(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)));
}

export function getCookie(request, name) {
  const c = request.headers.get("cookie") || "";
  for (const part of c.split(/;\s*/)) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i) === name) return decodeURIComponent(part.slice(i + 1));
  }
  return null;
}

// رمز الدخول للمحل أو المندوب: عربي أو إنجليزي أو أرقام، والأرقام العربية تتحول لإنجليزية
// يرجّع فاضي لو الرمز غير صالح
export function cleanCode(v) {
  const c = str(v, 30).replace(/[٠-٩]/g, d => "٠١٢٣٤٥٦٧٨٩".indexOf(d)).toLowerCase();
  return /^[\p{L}\p{N}_-]{2,30}$/u.test(c) ? c : "";
}

export const ACTIVE = ["new", "accepted"];
export const STATUSES = ["new", "accepted", "ready", "rejected", "cancelled"];
