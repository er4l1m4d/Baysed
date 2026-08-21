from decimal import Decimal
import pytest
from bayse_bot.lifecycle import FillAccounting,transition
from bayse_bot.models import OrderStatus

def test_transitions_and_idempotent_settlement():
    assert transition(OrderStatus.PENDING,OrderStatus.OPEN) is OrderStatus.OPEN
    with pytest.raises(ValueError): transition(OrderStatus.FILLED,OrderStatus.OPEN)
    a=FillAccounting();a.buy(Decimal("10"),Decimal("1"));a.sell(Decimal("9"),Decimal("2"))
    assert a.net_shares==Decimal("9") and a.net_proceeds==Decimal("7")
    assert a.settle_once(Decimal("9"))==Decimal("9") and a.settle_once(Decimal("9")) is None
