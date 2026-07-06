"""Full read-capability probe across ALL authorized accounts.

Shows, per account: type, positions, balances, and whether transactions/orders
are exposed via the API (the LLC hides both; the personal account should not).
Read-only. Run: python probe_capabilities.py
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

from app.schwab.auth import load_client


def mask(n) -> str:
    s = str(n)
    return f"...{s[-4:]}" if len(s) > 4 else s


def main() -> None:
    client = load_client()
    if client is None:
        print("No token.")
        return
    nums = client.get_account_numbers().json()
    print(f"{len(nums)} account(s) authorized:\n")
    end = datetime.now(timezone.utc)
    start = end - timedelta(days=30)
    all_types = list(client.Transactions.TransactionType)

    for n in nums:
        h = n["hashValue"]
        label = mask(n["accountNumber"])
        print(f"=== Account {label} ===")
        # positions + balances
        try:
            r = client.get_account(h, fields=client.Account.Fields.POSITIONS)
            sa = r.json().get("securitiesAccount", {})
            bal = sa.get("currentBalances", {}) or {}
            print(f"  get_account: HTTP {r.status_code}  type={sa.get('type')}  "
                  f"positions={len(sa.get('positions', []) or [])}")
            for k in ("liquidationValue", "cashBalance", "buyingPower",
                      "cashAvailableForTrading", "availableFunds"):
                if k in bal:
                    print(f"      {k}={bal[k]}")
        except Exception as e:
            print(f"  get_account FAILED: {e!r}")
        # transactions
        try:
            r = client.get_transactions(h, start_date=start, end_date=end,
                                        transaction_types=all_types)
            txns = r.json()
            n_txn = len(txns) if isinstance(txns, list) else f"non-list:{str(txns)[:60]}"
            print(f"  get_transactions (30d): HTTP {r.status_code}  count={n_txn}")
        except Exception as e:
            print(f"  get_transactions FAILED: {e!r}")
        # orders
        try:
            r = client.get_orders_for_account(h, from_entered_datetime=start,
                                              to_entered_datetime=end)
            orders = r.json()
            n_ord = len(orders) if isinstance(orders, list) else f"non-list:{str(orders)[:60]}"
            print(f"  get_orders (30d): HTTP {r.status_code}  count={n_ord}")
        except Exception as e:
            print(f"  get_orders FAILED: {e!r}")
        print()


if __name__ == "__main__":
    main()
