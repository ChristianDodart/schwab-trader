// Pure order-timing helpers, isolated from the React ticket so this money-path logic is
// unit-testable on its own.

export type Timing = { orderType: string; session: string; duration: string };

// The order type / session / duration to default to for a given detected market session.
//
// - regular:  MARKET + NORMAL + the user's remembered duration (unchanged behavior).
// - pre/post: a price-protected LIMIT in the matching extended session (AM/PM), DAY.
// - closed / unknown / anything unexpected: the session was NOT positively confirmed. A
//   single bad market-hours read (Schwab hiccup, a missing session window, the 4:00pm
//   boundary) must not silently downgrade an after-hours LIMIT to a regular-hours-only
//   order that can't fill in extended hours. So default to SEAMLESS — Schwab's union of
//   pre + regular + post — which keeps a limit eligible in whatever session is actually
//   live. Returns null while the session is still unknown (marketSession == null).
//
// Extended/seamless orders are always DAY: good-till-canceled combined with an
// AM/PM/SEAMLESS (extended-hours) session is an invalid Schwab combo.
export function defaultTiming(marketSession: string | null, rememberedDuration: string): Timing | null {
  if (marketSession == null) return null;
  if (marketSession === "regular") return { orderType: "MARKET", session: "NORMAL", duration: rememberedDuration };
  if (marketSession === "pre") return { orderType: "LIMIT", session: "AM", duration: "DAY" };
  if (marketSession === "post") return { orderType: "LIMIT", session: "PM", duration: "DAY" };
  return { orderType: "LIMIT", session: "SEAMLESS", duration: "DAY" }; // closed / unknown / unexpected
}

// Plain-English consequence of the session + duration actually on the order. Pure of any
// detection input — it reflects exactly what will be sent to Schwab, so the user always
// reads the true behavior even if session detection was wrong.
export function describeTiming(session: string, duration: string): string {
  const gtc = duration === "GOOD_TILL_CANCEL";
  const extended = session === "AM" || session === "PM" || session === "SEAMLESS";
  if (extended && gtc) return "Good-til-canceled isn't allowed with an extended-hours session — switch duration to Day.";
  switch (session) {
    case "AM":
      return "Eligible for pre-market trading (from 7:00am ET) up to today's open.";
    case "PM":
      return "Eligible for after-hours (post-market) trading through 8:00pm ET today.";
    case "SEAMLESS":
      return "Trades in regular and extended hours today (pre-market, regular, and after-hours).";
    default: // NORMAL
      return gtc
        ? "Regular hours only (9:30am–4:00pm ET) — won't trade after hours; rests day-to-day until filled or canceled."
        : "Regular hours only (9:30am–4:00pm ET) — won't trade before or after, and expires at today's close.";
  }
}
