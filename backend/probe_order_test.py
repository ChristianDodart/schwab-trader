"""SAFE trading-capability test on the personal (…719) margin account.

Places a LIMIT BUY of 1 share at $1.00 (far below market, $0 account -> cannot
fill), reads its status, then CANCELS it. Validates the place / status / cancel
write-path without any real risk. Read+write, but un-fillable by construction.

    python probe_order_test.py [SYMBOL]
"""
from __future__ import annotations

import sys
import time

from app.schwab.auth import load_client

SYMBOL = (sys.argv[1] if len(sys.argv) > 1 else "SOFI").upper()
QTY = 1
LIMIT_PRICE = 1.00  # far below any real price -> never fills


def find_personal_hash(client) -> str | None:
    for n in client.get_account_numbers().json():
        if str(n["accountNumber"]).endswith("719"):
            return n["hashValue"]
    return None


def main() -> None:
    client = load_client()
    if client is None:
        print("No token.")
        return
    h = find_personal_hash(client)
    if not h:
        print("Could not find account ending 719.")
        return

    from schwab.orders.equities import equity_buy_limit
    from schwab.utils import Utils

    print(f"Placing TEST order: BUY {QTY} {SYMBOL} LIMIT ${LIMIT_PRICE:.2f} on …719")
    builder = equity_buy_limit(SYMBOL, QTY, f"{LIMIT_PRICE:.2f}")
    resp = client.place_order(h, builder.build())
    print(f"  place_order -> HTTP {resp.status_code}")
    if resp.status_code not in (200, 201):
        print(f"  body: {resp.text[:500]}")
        print("  (A rejection here still confirms the trading endpoint is reachable.)")
        return

    try:
        order_id = Utils(client, h).extract_order_id(resp)
    except Exception as e:
        print(f"  could not extract order id: {e!r}")
        order_id = None
    print(f"  order id: {order_id}")

    if order_id:
        time.sleep(1.5)
        st = client.get_order(order_id, h).json()
        print(f"  status: {st.get('status')}  filled={st.get('filledQuantity')}")
        c = client.cancel_order(order_id, h)
        print(f"  cancel_order -> HTTP {c.status_code}")
        time.sleep(1.0)
        st2 = client.get_order(order_id, h).json()
        print(f"  status after cancel: {st2.get('status')}")
    print("Done.")


if __name__ == "__main__":
    main()
