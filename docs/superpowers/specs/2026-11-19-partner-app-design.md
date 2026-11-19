# Partner app for Jalajil Delivery — design

Approved by the owner on 2026-11-19 (chat).

## Why
Partner shops (restaurants, cafés, groceries) need to see the orders meant for
them, accept / reject them and mark them ready, so the owner stops relaying
every order by hand and can charge a per-order commission after a free trial.

## Goals
- Every order the customer sends is also saved in a database; the WhatsApp
  message and flow stay byte-for-byte the same.
- `/partner`: shop logs in with shop code + PIN, sees only its own orders,
  new ones on top with a sound while the app is open; accept with 10/20/30
  minutes, ready for pickup, reject with a reason; open/closed toggle; summary
  with completed orders this week / month and commission due. Installable PWA
  named "شركاء توصيل جلاجل".
- `/admin`: password login; add/edit shops (code, PIN, commission per order,
  trial end date); see all orders and statuses; commission totals per shop.

## Non-goals (v1)
Push notifications while the app is closed, payment tracking of commissions,
customer-facing order status, menus/prices, multiple users per shop.

## Anti-goals
Breaking the customer site, or the WhatsApp step depending on the database.
Customer phone numbers visible to anyone except the shop that has the order
(and the owner).

## Constraints
Free Cloudflare only: Pages + Pages Functions + D1. Arabic RTL, mobile first,
same palette and fonts as `site/index.html`. Work on branch `partner-app`;
merge to `main` only after the owner approves the preview.

## Approach (only sensible one)
Static pages in `site/` + one Pages Function router under `/api/*` + D1.
A separate backend or a framework would add cost or a build step the project
doesn't have.

## Decisions
- Customer form: under the shop type, partner shops of that type appear as
  chips plus "محل ثاني" which shows the old free-text name field. Non-partner
  orders are saved too and visible to the owner only. Closed partner shops are
  shown as "مسكّر" and can't be picked. If the API is down the form behaves
  exactly as before.
- One customer order with several shops is saved as one order with one "part"
  per shop; each shop sees only its part.
- Saving happens on the send tap with `fetch(..., {keepalive:true})`, never
  blocking or delaying the WhatsApp link. A per-page-load key de-duplicates
  repeated taps.
- A part counts as completed when the shop marks it ready. The owner can
  cancel a part from the dashboard, which removes it from counts.
- Commission is snapshotted when the part becomes ready: 0 if that Riyadh
  date is on/before the shop's trial end date, else the shop's per-order
  amount.
- Week starts Saturday, calendar months, Asia/Riyadh time (UTC+3).
- PINs: PBKDF2-SHA256 (100k iterations, random salt). Owner password is a
  Cloudflare secret `ADMIN_PASSWORD`. Sessions: random token in an HttpOnly
  SameSite=Strict cookie, only its SHA-256 stored. 5 wrong tries lock a login
  for 15 minutes.
- Tables are created automatically on first API call, so the owner only
  creates the D1 database and binds it as `DB`.
- Partner app polls every 15 s; a synthesized chime repeats while unanswered
  new orders exist; screen wake lock while open. iPhone needs one tap to
  enable sound.
- The root service worker skips `/api/`, `/partner`, `/admin` so it never
  caches orders; the partner app has its own manifest and worker under
  `/partner/`.
- og:url / og:image move from netlify.app to jalajil-delivery.pages.dev.

## Known limits
The public "save order" endpoint can't tell a real customer from a script;
fake orders are possible. Mitigated by size limits and validation; revisit if
abused.
