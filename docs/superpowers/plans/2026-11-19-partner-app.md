# Partner App Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Save customer orders to D1 and give partner shops (`/partner`) and the owner (`/admin`) mobile web apps to act on them.

**Architecture:** Static pages in `site/`; one Pages Function `functions/api/[[route]].js` that dispatches to handlers in `server/`; D1 bound as `DB`, schema created lazily on first call.

**Tech Stack:** Plain HTML/CSS/JS (no build step), Cloudflare Pages Functions, D1, WebCrypto. Tests: `node --test`, local run: `npx wrangler pages dev site --d1 DB`.

**Spec:** `docs/superpowers/specs/2026-11-19-partner-app-design.md`

## Global Constraints
- Free Cloudflare only (Pages, Functions, D1). No package.json at repo root (keeps Pages build unchanged).
- WhatsApp message text produced by `message()` in `site/index.html` must not change.
- Arabic RTL, mobile first, tokens/fonts copied from `site/index.html` `:root`.
- Times stored as epoch ms; reporting in Asia/Riyadh (UTC+3), week starts Saturday.
- Env: `DB` (D1 binding), `ADMIN_PASSWORD` (secret).

## Review Focus
- Shop A requesting / acting on shop B's part id → 404, no data leak.
- API down / DB not bound → customer form still shows free-text shop field and WhatsApp works.
- Same order tapped "send" twice → one order row (client_key upsert).
- Order arriving for a shop that's closed or deactivated → still saved, still shown to that shop.
- Customer text containing HTML → rendered as text in partner/admin (no innerHTML of user data).

---

### Task 1: Server core (`server/`)
**Files:** Create `server/util.js`, `server/schema.js`, `server/auth.js`, `server/orders.js`, `server/partner.js`, `server/admin.js`, `functions/api/[[route]].js`; Test `tests/server.test.mjs`.

**Interfaces (produces):**
- `util.js`: `json(data, status=200)`, `riyadhRanges(nowMs) -> {weekStart, monthStart}` (ms), `riyadhDate(ms) -> "YYYY-MM-DD"`, `commissionFor(shop, readyMs) -> number`.
- `auth.js`: `hashPin(pin) -> {hash, salt}`, `verifyPin(pin, hash, salt) -> bool`, `createSession(db, kind, shopId|null) -> token`, `getSession(db, request, kind) -> session|null`, lockout helpers.
- Routes: `POST /api/orders`, `GET /api/shops`; `POST /api/partner/login|logout|status`, `GET /api/partner/orders|summary`, `POST /api/partner/parts/:id`; `POST /api/admin/login|logout`, `GET/POST /api/admin/shops`, `PUT /api/admin/shops/:id`, `GET /api/admin/orders|summary`, `POST /api/admin/parts/:id`.

- [ ] Tests: `riyadhRanges` for a Friday 23:30 Riyadh gives the previous Saturday 00:00; `commissionFor` returns 0 on trial end date and the amount the day after; `verifyPin` round-trips and rejects a wrong PIN.
- [ ] Implement, run `node --test tests`, commit.

### Task 2: Customer site
**Files:** Modify `site/index.html`, `site/sw.js`.
- [ ] Partner chips per category from `GET /api/shops` + "محل ثاني"; closed shops disabled; block send if a chosen partner closed.
- [ ] Save on send with `fetch(keepalive)`; payload includes `client_key`, `order_no`, parts with `shop_id`.
- [ ] sw.js skips `/api/`, `/partner`, `/admin`; bump cache name. og links → pages.dev.
- [ ] Verify `message()` output identical for same inputs; commit.

### Task 3: Partner app
**Files:** Create `site/partner/index.html`, `site/partner/manifest.webmanifest`, `site/partner/sw.js`.
- [ ] Login, orders list (poll 15 s, chime, wake lock), actions, open toggle, summary tab. Commit.

### Task 4: Admin
**Files:** Create `site/admin/index.html`.
- [ ] Login, shops (add/edit), orders with filters + cancel, commission table. Commit.

### Task 5: End-to-end locally
- [ ] `npx wrangler pages dev site --d1 DB`; script `tests/e2e.mjs` covers: admin creates 2 shops, customer order with both shops + one non-partner, shop A sees only its part, A can't act on B's part, accept → ready, summary counts 1, admin sees all three parts.
