"""Probe what the Schwab API actually exposes for the linked accounts.

Read-only. Masks account numbers (shows last 4). Tells us: how many accounts the
API sees, their types, whether positions/balances are readable per account
(the managed account may be restricted), so we can design account selection +
reconciliation correctly.

    python probe_accounts.py
"""
from __future__ import annotations

import json

from app.schwab.auth import load_client


def mask(num: str) -> str:
    s = str(num)
    return f"...{s[-4:]}" if len(s) > 4 else s


def main() -> None:
    client = load_client()
    if client is None:
        print("No token.json — run `python -m app.schwab.authorize` first.")
        return

    print("=== get_account_numbers() ===")
    try:
        nums = client.get_account_numbers().json()
    except Exception as e:
        print(f"FAILED: {e!r}")
        return
    print(f"{len(nums)} account(s) visible to the API:")
    for n in nums:
        print(f"  acct {mask(n.get('accountNumber'))}  hash={n.get('hashValue')}")

    for n in nums:
        h = n.get("hashValue")
        label = mask(n.get("accountNumber"))
        print(f"\n=== get_account({label}) with POSITIONS ===")
        try:
            resp = client.get_account(h, fields=client.Account.Fields.POSITIONS)
            print(f"  HTTP {resp.status_code}")
            if resp.status_code != 200:
                print(f"  body: {resp.text[:400]}")
                continue
            sa = resp.json().get("securitiesAccount", {})
            positions = sa.get("positions", []) or []
            bal = sa.get("currentBalances", {}) or {}
            print(f"  type={sa.get('type')}  acct={mask(sa.get('accountNumber'))}  "
                  f"daytrader={sa.get('isDayTrader')}")
            print(f"  positions: {len(positions)}")
            for p in positions[:15]:
                inst = p.get("instrument", {})
                print(f"    {inst.get('symbol'):<8} qty={p.get('longQuantity')}  "
                      f"avg={p.get('averagePrice')}  mktVal={p.get('marketValue')}")
            print("  balances keys:", list(bal.keys())[:12])
            for k in ("liquidationValue", "cashBalance", "equity", "buyingPower"):
                if k in bal:
                    print(f"    {k} = {bal[k]}")
        except Exception as e:
            print(f"  FAILED: {e!r}")


if __name__ == "__main__":
    main()
