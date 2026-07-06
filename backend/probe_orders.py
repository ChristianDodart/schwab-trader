"""Probe Schwab ORDERS endpoint (distinct from transactions). The web UI shows
filled orders, so get_orders may work on the managed account even though
get_transactions returned empty. If so, it's the right source for fills.

    python probe_orders.py
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

from app.schwab.auth import load_client


def main() -> None:
    client = load_client()
    if client is None:
        print("No token.")
        return
    h = client.get_account_numbers().json()[0]["hashValue"]

    end = datetime(2026, 6, 29, 23, 59, tzinfo=timezone.utc)
    start = end - timedelta(days=10)
    try:
        resp = client.get_orders_for_account(
            h, from_entered_datetime=start, to_entered_datetime=end
        )
    except Exception as e:
        print(f"get_orders_for_account failed: {e!r}")
        return
    print("HTTP", resp.status_code)
    orders = resp.json()
    if not isinstance(orders, list):
        print("Non-list body:", str(orders)[:400])
        return
    print(f"{len(orders)} orders in last 10 days\n")
    for o in orders[:40]:
        legs = o.get("orderLegCollection", []) or []
        leg = legs[0] if legs else {}
        sym = leg.get("instrument", {}).get("symbol")
        inst = leg.get("instruction")
        qty = o.get("filledQuantity", o.get("quantity"))
        status = o.get("status")
        px = o.get("price")
        when = (o.get("closeTime") or o.get("enteredTime") or "")[:16]
        oid = o.get("orderId")
        print(f"  {when}  {str(sym):<6} {str(inst):<10} {qty:>5} @ {px}  [{status}] #{oid}")


if __name__ == "__main__":
    main()
