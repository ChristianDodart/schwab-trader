// Pure order-eligibility helpers — the frontend mirror of the server's broker rules
// (backend/app/order_eligibility.py), kept beside the timing helpers so all the pure
// money-path order logic stays unit-testable off the React tickets.
//
// Two concerns live here:
//   1. combo validity — which (order type, session, duration) tuples Schwab accepts.
//      Time-INDEPENDENT broker law; the server enforces the same rule in _build_order,
//      this mirror keeps a ticket from ever OFFERING a combo the server would reject.
//   2. clock affordance — given the DETECTED market session (pre / regular / post /
//      closed / unknown), which order types a ticket should offer. This is a safety/UX
//      choice (don't fire an unknown-price order when the market isn't confirmed open),
//      shared by the single Order Ticket and the Bulk review so the two can't drift.

// Sessions that trade outside regular hours — a plain LIMIT / DAY only (mirror of the
// server's EXTENDED_SESSIONS).
const EXTENDED_SESSIONS = new Set(["AM", "PM", "SEAMLESS"]);

const pretty = (t: string) =>
  t.replace(/_/g, " ").toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());

// null if Schwab accepts this (orderType, session, duration) combination, else a
// plain-English reason it is invalid. Mirrors backend/app/order_eligibility.py::combo_error.
export function comboError(orderType: string, session: string, duration: string): string | null {
  const ot = (orderType || "").toUpperCase();
  const sess = (session || "NORMAL").toUpperCase();
  const dur = (duration || "DAY").toUpperCase();
  if (EXTENDED_SESSIONS.has(sess)) {
    if (ot !== "LIMIT")
      return `a ${pretty(ot)} order can't trade in an extended-hours session (${pretty(sess)}) — use a limit order, or the normal session`;
    if (dur === "GOOD_TILL_CANCEL")
      return `good-till-canceled can't be combined with an extended-hours session (${pretty(sess)}) — use a Day order`;
  }
  return null;
}

// Which order types to OFFER for the detected market clock, drawn from `all` (each ticket
// passes its own menu). Only confirmed regular hours offer the market-fill types; every
// other clock state (extended, closed, or an unconfirmed/failed read) restricts to a
// price-protected LIMIT — so an order never fills at an unknown gap/open price and can't
// build a combo the server rejects. A not-yet-known clock (null, still loading) keeps the
// full menu, exactly as both tickets did before, and re-restricts the moment it resolves.
export function offerableTypes(marketSession: string | null, all: readonly string[]): string[] {
  if (marketSession === null || marketSession === "regular") return [...all];
  return all.filter((t) => t === "LIMIT");
}
