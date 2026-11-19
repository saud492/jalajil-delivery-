// تشغيل الـ API محلياً بدون wrangler: قاعدة D1 مقلّدة على node:sqlite، والطلبات تنادي onRequest مباشرة
import { DatabaseSync } from "node:sqlite";
import { readFile } from "node:fs/promises";
import { onRequest } from "../functions/api/[[route]].js";

const READS = /^\s*(SELECT|PRAGMA|WITH)\b|\bRETURNING\b/i;

export function fakeD1() {
  const db = new DatabaseSync(":memory:");
  const stmt = (sql, args = []) => ({
    sql, args,
    bind: (...a) => stmt(sql, a),
    _exec() {
      const s = db.prepare(sql);
      if (READS.test(sql)) return { results: s.all(...args).map(r => ({ ...r })), meta: { changes: 0 } };
      const r = s.run(...args);
      return { results: [], meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } };
    },
    async first(col) { const r = this._exec().results[0]; return r === undefined ? null : col ? r[col] : r; },
    async all() { return this._exec(); },
    async run() { return this._exec(); },
  });
  return {
    raw: db,
    prepare: sql => stmt(sql),
    async batch(list) {
      db.exec("BEGIN");
      try { const out = list.map(s => s._exec()); db.exec("COMMIT"); return out; }
      catch (err) { db.exec("ROLLBACK"); throw err; }
    },
  };
}

// يرجّع fetch محلي: /api يروح لـ onRequest، والباقي ملفات من site/
export function localServer(env = {}) {
  const DB = fakeD1();
  const pending = [];
  const fullEnv = { DB, ADMIN_PASSWORD: "test-pass-123", ...env };
  async function fetchLocal(url, init = {}) {
    const u = new URL(url, "http://localhost:8788");
    if (!u.pathname.startsWith("/api/")) {
      let p = decodeURIComponent(u.pathname);
      if (p.endsWith("/")) p += "index.html";
      try { return new Response(await readFile(new URL("../site" + p, import.meta.url))); }
      catch { return new Response("not found", { status: 404 }); }
    }
    const headers = new Headers(init.headers || {});
    // ملفات تعريف الارتباط Secure ما تنرسل لـ http، فنحطها يدوي مثل المتصفح
    const request = new Request(u, { ...init, headers });
    return onRequest({ request, env: fullEnv, waitUntil: p => pending.push(p) });
  }
  // ينتظر الإشعارات اللي تنرسل بالخلفية
  fetchLocal.settle = async () => { while (pending.length) await pending.shift(); };
  fetchLocal.env = fullEnv;
  return fetchLocal;
}
