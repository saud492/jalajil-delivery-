// تسجيل الدخول: الأرقام السرية تنحفظ مشفّرة (PBKDF2) والجلسات تنحفظ كبصمة فقط
import { HttpError, b64url, fromB64url, getCookie, randomToken, sha256 } from "./util.js";

const ITER = 100000; // أعلى رقم يسمح فيه Cloudflare
const DAY = 24 * 3600_000;
export const COOKIE = { shop: "jl_shop", admin: "jl_admin", driver: "jl_driver" };
const LIFE = { shop: 60 * DAY, admin: 7 * DAY, driver: 60 * DAY };
const PATH = { shop: "/api/partner", admin: "/api/admin", driver: "/api/driver" };

async function derive(pin, salt) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(pin), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations: ITER }, key, 256);
  return b64url(bits);
}

export async function hashPin(pin) {
  const salt = new Uint8Array(16);
  crypto.getRandomValues(salt);
  return { hash: await derive(String(pin), salt), salt: b64url(salt) };
}

export async function verifyPin(pin, hash, salt) {
  const h = await derive(String(pin), fromB64url(salt));
  return safeEqual(h, hash);
}

export function safeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

export async function createSession(db, kind, shopId = null) {
  const token = randomToken();
  const now = Date.now();
  await db.batch([
    db.prepare("DELETE FROM sessions WHERE expires_at < ?").bind(now),
    db.prepare("INSERT INTO sessions (token_hash, kind, shop_id, expires_at) VALUES (?, ?, ?, ?)")
      .bind(await sha256(token), kind, shopId, now + LIFE[kind]),
  ]);
  return token;
}

export function sessionCookie(kind, token) {
  const age = token ? Math.floor(LIFE[kind] / 1000) : 0;
  return `${COOKIE[kind]}=${token || ""}; Path=${PATH[kind]}; Max-Age=${age}; HttpOnly; Secure; SameSite=Strict`;
}

// يرجّع الجلسة، وللمحل يرجّع بيانات المحل بعد، ولو المحل موقوف ما تصلح
export async function getSession(db, request, kind) {
  const token = getCookie(request, COOKIE[kind]);
  if (!token) return null;
  const row = await db.prepare("SELECT * FROM sessions WHERE token_hash = ? AND kind = ? AND expires_at > ?")
    .bind(await sha256(token), kind, Date.now()).first();
  if (!row) return null;
  if (kind === "shop") {
    const shop = await db.prepare("SELECT * FROM shops WHERE id = ? AND active = 1").bind(row.shop_id).first();
    if (!shop) return null;
    return { ...row, shop, token };
  }
  if (kind === "driver") {
    // جلسة المندوب تحفظ رقمه في نفس عمود shop_id
    const driver = await db.prepare("SELECT * FROM drivers WHERE id = ? AND active = 1").bind(row.shop_id).first();
    if (!driver) return null;
    return { ...row, driver, token };
  }
  return { ...row, token };
}

export async function requireSession(db, request, kind) {
  const s = await getSession(db, request, kind);
  if (!s) throw new HttpError(401, "سجّل دخولك من جديد");
  return s;
}

export async function endSession(db, request, kind) {
  const token = getCookie(request, COOKIE[kind]);
  if (token) await db.prepare("DELETE FROM sessions WHERE token_hash = ?").bind(await sha256(token)).run();
}

/* ===== منع التخمين: ٥ محاولات غلط تقفل الدخول ربع ساعة ===== */
const MAX_FAILS = 5, LOCK_MS = 15 * 60_000;

export async function checkLock(db, keys) {
  const now = Date.now();
  for (const key of keys) {
    const r = await db.prepare("SELECT locked_until FROM login_attempts WHERE key = ?").bind(key).first();
    if (r && r.locked_until > now) {
      const min = Math.ceil((r.locked_until - now) / 60_000);
      throw new HttpError(429, `محاولات كثيرة. جرّب بعد ${min} دقيقة`);
    }
  }
}

export async function recordFail(db, keys, limits) {
  const now = Date.now();
  for (const [i, key] of keys.entries()) {
    const max = (limits && limits[i]) || MAX_FAILS;
    const r = await db.prepare("SELECT fails, locked_until FROM login_attempts WHERE key = ?").bind(key).first();
    let fails = r && r.locked_until <= now && r.locked_until > 0 ? 1 : (r ? r.fails + 1 : 1);
    const locked = fails >= max ? now + LOCK_MS : 0;
    if (locked) fails = 0;
    await db.prepare("INSERT INTO login_attempts (key, fails, locked_until) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET fails = excluded.fails, locked_until = excluded.locked_until")
      .bind(key, fails, locked).run();
  }
}

export async function clearFails(db, keys) {
  for (const key of keys) await db.prepare("DELETE FROM login_attempts WHERE key = ?").bind(key).run();
}
