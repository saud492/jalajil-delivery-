// إشعارات الجوال (Web Push) بدون أي مكتبة: تشفير RFC 8291 (aes128gcm) وتوقيع VAPID (RFC 8292)
// المفاتيح سر في Cloudflare: VAPID_PUBLIC (المفتاح العام الخام) و VAPID_PRIVATE (رقم d)، تتولّد بـ tools/vapid-keys.mjs
import { b64url, fromB64url } from "./util.js";

const enc = new TextEncoder();
const cat = (...a) => { const n = a.reduce((s, x) => s + x.length, 0), out = new Uint8Array(n); let o = 0; for (const x of a) { out.set(x, o); o += x.length; } return out; };

async function hmac(key, data) {
  const k = await crypto.subtle.importKey("raw", key, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", k, data));
}

export function pushEnabled(env) {
  return !!(env && env.VAPID_PUBLIC && env.VAPID_PRIVATE);
}

// توقيع VAPID: JWT بـ ES256، الجمهور هو أصل رابط خدمة الإشعارات
async function vapidHeader(env, endpoint, subject) {
  const pub = fromB64url(env.VAPID_PUBLIC);
  const jwk = { kty: "EC", crv: "P-256", d: env.VAPID_PRIVATE, x: b64url(pub.slice(1, 33)), y: b64url(pub.slice(33, 65)), ext: true };
  const key = await crypto.subtle.importKey("jwk", jwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const head = b64url(enc.encode(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const body = b64url(enc.encode(JSON.stringify({ aud: new URL(endpoint).origin, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: subject })));
  const sig = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, enc.encode(head + "." + body));
  return `vapid t=${head}.${body}.${b64url(sig)}, k=${env.VAPID_PUBLIC}`;
}

// يشفّر الرسالة لجهاز واحد
export async function encrypt(p256dh, auth, payload) {
  const uaPub = fromB64url(p256dh), secret = fromB64url(auth);
  const pair = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  const asPub = new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey));
  const uaKey = await crypto.subtle.importKey("raw", uaPub, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: uaKey }, pair.privateKey, 256));
  const prkKey = await hmac(secret, shared);
  const ikm = await hmac(prkKey, cat(enc.encode("WebPush: info\0"), uaPub, asPub, new Uint8Array([1])));
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const prk = await hmac(salt, ikm);
  const cek = (await hmac(prk, cat(enc.encode("Content-Encoding: aes128gcm\0"), new Uint8Array([1])))).slice(0, 16);
  const nonce = (await hmac(prk, cat(enc.encode("Content-Encoding: nonce\0"), new Uint8Array([1])))).slice(0, 12);
  const key = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["encrypt"]);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, key, cat(enc.encode(payload), new Uint8Array([2]))));
  const head = new Uint8Array(21); head.set(salt); new DataView(head.buffer).setUint32(16, 4096); head[20] = 65;
  return cat(head, asPub, ct);
}

// يرسل لجهاز واحد. يرجّع "gone" لو الاشتراك انتهى (المتصفح حذفه)
export async function sendOne(env, sub, msg, subject) {
  const body = await encrypt(sub.p256dh, sub.auth, JSON.stringify(msg));
  const r = await fetch(sub.endpoint, {
    method: "POST",
    headers: {
      authorization: await vapidHeader(env, sub.endpoint, subject),
      "content-encoding": "aes128gcm", "content-type": "application/octet-stream",
      ttl: "3600", urgency: "high", ...(msg.tag ? { topic: String(msg.tag).replace(/[^A-Za-z0-9_-]/g, "").slice(0, 32) } : {}),
    },
    body,
  });
  if (r.status === 404 || r.status === 410) return "gone";
  return r.ok ? "ok" : "fail";
}
