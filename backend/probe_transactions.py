"""Probe Schwab transaction history (read-only) to see if we can reconstruct
real lots from actual fills instead of a stale spreadsheet snapshot.

    python probe_transactions.py [SYMBOL]
"""
from __future__ import annotations

import sys
from datetime import datetime, timezone

from app.schwab.auth import load_client

SYMBOL = (sys.argv[1] if len(sys.argv) > 1 else "HOOD").upper()


def main() -> None:
    client = load_client()
    if client is None:
        print("No token.")
        return
    nums = client.get_account_numbers().json()
    h = nums[0]["hashValue"]

    start = datetime(2026, 1, 1, tzinfo=timezone.utc)
    end = datetime(2026, 6, 29, 23, 59, tzinfo=timezone.utc)
    all_types = list(client.Transactions.TransactionType)
    print("transaction types requested:", [t.value for t in all_types])
    try:
        resp = client.get_transactions(
            h, start_date=start, end_date=end, transaction_types=all_types
        )
    except Exception as e:
        print(f"get_transactions failed: {e!r}")
        return
    print("HTTP", resp.status_code)
    txns = resp.json()
    if not isinstance(txns, list):
        print("Non-list body:", str(txns)[:500])
        return
    print(f"{len(txns)} transactions total")
    from collections import Counter
    types = Counter(t.get("type") for t in txns)
    print("types:", dict(types), "\n")
    if txns:
        import json
        print("--- sample transaction (first) ---")
        print(json.dumps(txns[0], indent=2)[:1200], "\n")

    net = 0.0
    buys = []
    for t in txns:
        for it in t.get("transferItems", []):
            inst = it.get("instrument", {}) or {}
            if inst.get("symbol") != SYMBOL:
                continue
            amt = it.get("amount")          # signed share qty (+buy / -sell)
            price = it.get("price")
            eff = it.get("positionEffect")
            when = t.get("tradeDate") or t.get("time")
            if amt is not None:
                net += amt
                side = "BUY " if amt > 0 else "SELL"
                print(f"  {str(when)[:10]}  {side} {abs(amt):>7} @ {price}   effect={eff}")
                if amt > 0:
                    buys.append((str(when)[:10], amt, price))
    print(f"\nNet open {SYMBOL} shares from transactions: {net}")
    print(f"(Schwab positions endpoint should report the same.)")


if __name__ == "__main__":
    main()
