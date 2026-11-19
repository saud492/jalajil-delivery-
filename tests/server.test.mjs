import test from "node:test";
import assert from "node:assert/strict";
import { riyadhRanges, riyadhDate, commissionFor } from "../server/util.js";
import { hashPin, verifyPin } from "../server/auth.js";

const riyadh = s => Date.parse(s + "+03:00");

test("week starts Saturday 00:00 Riyadh", () => {
  // الجمعة ٢٠ نوفمبر ٢٠٢٦ الساعة ١١:٣٠ الليل
  const { weekStart, monthStart, dayStart } = riyadhRanges(riyadh("2026-11-20T23:30:00"));
  assert.equal(weekStart, riyadh("2026-11-14T00:00:00"));
  assert.equal(monthStart, riyadh("2026-11-01T00:00:00"));
  assert.equal(dayStart, riyadh("2026-11-20T00:00:00"));
});

test("Saturday just after midnight is the new week", () => {
  const { weekStart } = riyadhRanges(riyadh("2026-11-21T00:05:00"));
  assert.equal(weekStart, riyadh("2026-11-21T00:00:00"));
});

test("Riyadh date crosses midnight before UTC does", () => {
  assert.equal(riyadhDate(Date.parse("2026-11-19T22:30:00Z")), "2026-11-20");
});

test("no commission on or before trial end, full amount after", () => {
  const shop = { commission: 2.5, trial_end: "2026-11-30" };
  assert.equal(commissionFor(shop, riyadh("2026-11-30T23:59:00")), 0);
  assert.equal(commissionFor(shop, riyadh("2026-12-01T00:01:00")), 2.5);
  assert.equal(commissionFor({ commission: 3, trial_end: null }, Date.now()), 3);
});

test("PIN hash round-trips and rejects wrong PIN", async () => {
  const { hash, salt } = await hashPin("4821");
  assert.notEqual(hash, "4821");
  assert.equal(await verifyPin("4821", hash, salt), true);
  assert.equal(await verifyPin("4822", hash, salt), false);
});
