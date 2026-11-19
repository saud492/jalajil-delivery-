// سيرفر تجربة محلي بدون wrangler: الموقع + الـ API + قاعدة في الذاكرة + مفاتيح إشعارات جديدة
//   node tests/serve.mjs   → http://localhost:8790  (كلمة سر اللوحة: test-pass-123)
import http from "node:http";
import { localServer } from "./local.mjs";

const b64 = a => Buffer.from(a).toString("base64url");
const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
const f = localServer({
  VAPID_PUBLIC: b64(await crypto.subtle.exportKey("raw", pair.publicKey)),
  VAPID_PRIVATE: (await crypto.subtle.exportKey("jwk", pair.privateKey)).d,
  CRON_SECRET: "local-cron",
});
const PORT = Number(process.env.PORT) || 8790;
const TYPES = { html: "text/html; charset=utf-8", js: "text/javascript; charset=utf-8", webmanifest: "application/manifest+json", png: "image/png", svg: "image/svg+xml", json: "application/json" };

http.createServer(async (req, res) => {
  const chunks = []; for await (const c of req) chunks.push(c);
  const url = "http://localhost:" + PORT + req.url;
  // ملفات تعريف الارتباط Secure: المتصفح يقبلها من localhost، فنمررها مثل ما هي
  const r = await f(url, { method: req.method, headers: req.headers, body: chunks.length && !["GET", "HEAD"].includes(req.method) ? Buffer.concat(chunks) : undefined, duplex: "half" });
  await f.settle();
  const headers = Object.fromEntries(r.headers);
  if (!url.includes("/api/")) {
    const ext = new URL(url).pathname.split(".").pop();
    headers["content-type"] = TYPES[ext] || (new URL(url).pathname.endsWith("/") ? TYPES.html : "application/octet-stream");
  }
  res.writeHead(r.status, headers);
  res.end(Buffer.from(await r.arrayBuffer()));
}).listen(PORT, () => console.log("http://localhost:" + PORT));
