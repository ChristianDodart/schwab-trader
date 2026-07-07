"""Guard rails on replace_order (modify a working limit order).

Same posture as the place_order rails: hard refusals for anything that isn't a
single-leg working LIMIT on the trading-enabled account, soft (needs_confirm)
rails on the new terms. Broker interaction is faked; only the rails run.
"""
import asyncio

from app import orders
from app.schwab import hub


def _run(coro):
    return asyncio.run(coro)


class FakeResp:
    def __init__(self, payload=None, status_code=200, text=""):
        self._payload = payload or {}
        self.status_code = status_code
        self.text = text
        self.headers = {}

    def json(self):
        return self._payload


class FakeClient:
    def __init__(self, order):
        self.order = order
        self.replaced_with = None

    def get_order(self, order_id, account_hash):
        return FakeResp(self.order)

    def replace_order(self, account_hash, order_id, spec):
        self.replaced_with = spec
        return FakeResp(status_code=201, text="")


def _order(**over):
    base = {
        "status": "WORKING", "orderType": "LIMIT", "duration": "GOOD_TILL_CANCEL",
        "session": "NORMAL", "quantity": 100, "filledQuantity": 0, "price": 10.0,
        "orderLegCollection": [{"instruction": "BUY", "instrument": {"symbol": "RCAT"}}],
    }
    base.update(over)
    return base


def _wire(monkeypatch, order, held=1000.0, quote=10.0):
    client = FakeClient(order)
    monkeypatch.setattr(orders, "get_client", lambda: client)
    monkeypatch.setattr(orders.accounts_svc, "get_trading_account", _async(lambda: "HASH1"))
    monkeypatch.setattr(orders.accounts_svc, "held_shares", _async(lambda h, s: held))
    hub.latest["RCAT"] = {"last": quote, "source": "schwab"} if quote else {}
    return client


def _async(fn):
    async def wrapper(*a, **k):
        return fn(*a, **k) if a or k else fn()
    return wrapper


def test_non_working_order_refused(monkeypatch):
    _wire(monkeypatch, _order(status="FILLED"))
    r = _run(orders.replace_order(1, new_limit_price=11.0))
    assert not r["ok"] and "FILLED" in r["error"]


def test_non_limit_refused(monkeypatch):
    _wire(monkeypatch, _order(orderType="STOP"))
    r = _run(orders.replace_order(1, new_limit_price=11.0))
    assert not r["ok"] and "LIMIT" in r["error"]


def test_multi_leg_refused(monkeypatch):
    legs = [{"instruction": "BUY", "instrument": {"symbol": "RCAT"}}] * 2
    _wire(monkeypatch, _order(orderLegCollection=legs))
    r = _run(orders.replace_order(1, new_limit_price=11.0))
    assert not r["ok"] and "single-leg" in r["error"]


def test_short_instruction_refused(monkeypatch):
    _wire(monkeypatch, _order(orderLegCollection=[
        {"instruction": "SELL_SHORT", "instrument": {"symbol": "RCAT"}}]))
    r = _run(orders.replace_order(1, new_limit_price=11.0))
    assert not r["ok"] and "SELL_SHORT" in r["error"]


def test_nothing_changed_refused(monkeypatch):
    _wire(monkeypatch, _order())
    r = _run(orders.replace_order(1, new_quantity=100, new_limit_price=10.0))
    assert not r["ok"] and "nothing changed" in r["error"]


def test_partial_fill_needs_confirm(monkeypatch):
    _wire(monkeypatch, _order(filledQuantity=40))
    r = _run(orders.replace_order(1, new_limit_price=10.5))
    assert not r["ok"] and r.get("needs_confirm") and "already filled" in r["warning"]


def test_fatfinger_needs_confirm(monkeypatch):
    _wire(monkeypatch, _order(), quote=10.0)
    r = _run(orders.replace_order(1, new_limit_price=14.0))  # 40% off
    assert not r["ok"] and r.get("needs_confirm") and "typo" in r["warning"]


def test_no_quote_needs_confirm(monkeypatch):
    _wire(monkeypatch, _order(), quote=None)
    r = _run(orders.replace_order(1, new_limit_price=10.5))
    assert not r["ok"] and r.get("needs_confirm") and "No live quote" in r["warning"]


def test_buy_notional_needs_confirm(monkeypatch):
    _wire(monkeypatch, _order(price=9.5), quote=10.0)
    r = _run(orders.replace_order(1, new_quantity=2000, new_limit_price=10.0))  # $20k
    assert not r["ok"] and r.get("needs_confirm") and "quantity" in r["warning"]


def test_sell_beyond_held_refused_even_confirmed(monkeypatch):
    _wire(monkeypatch, _order(orderLegCollection=[
        {"instruction": "SELL", "instrument": {"symbol": "RCAT"}}]), held=50.0)
    r = _run(orders.replace_order(1, new_quantity=60, confirm=True))
    assert not r["ok"] and "short" in r["error"]


def test_happy_path_replaces(monkeypatch):
    client = _wire(monkeypatch, _order(), quote=10.0)
    r = _run(orders.replace_order(1, new_quantity=120, new_limit_price=10.2))
    assert r["ok"] and r["http"] == 201
    assert client.replaced_with is not None
    built = client.replaced_with
    assert built["price"] == "10.20"
    assert built["duration"] == "GOOD_TILL_CANCEL"          # preserved from the original
    leg = built["orderLegCollection"][0]
    assert leg["quantity"] == 120 and leg["instrument"]["symbol"] == "RCAT"


def test_confirm_overrides_soft_rails(monkeypatch):
    _wire(monkeypatch, _order(), quote=None)  # no quote → would need confirm
    r = _run(orders.replace_order(1, new_limit_price=10.5, confirm=True))
    assert r["ok"]
