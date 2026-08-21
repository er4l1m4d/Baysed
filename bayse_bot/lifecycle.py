"""Small explicit order/settlement state machine used by paper and live reconciliation."""
from __future__ import annotations
from dataclasses import dataclass
from decimal import Decimal
from .models import OrderStatus, TERMINAL_ORDER_STATUSES

ALLOWED: dict[OrderStatus,set[OrderStatus]] = {
    OrderStatus.PENDING:{OrderStatus.OPEN,OrderStatus.PARTIAL_FILLED,OrderStatus.FILLED,OrderStatus.CANCELLED,OrderStatus.REJECTED,OrderStatus.UNKNOWN},
    OrderStatus.OPEN:{OrderStatus.PARTIAL_FILLED,OrderStatus.FILLED,OrderStatus.CANCELLED,OrderStatus.EXPIRED,OrderStatus.UNKNOWN},
    OrderStatus.PARTIAL_FILLED:{OrderStatus.FILLED,OrderStatus.CANCELLED,OrderStatus.EXPIRED,OrderStatus.UNKNOWN},
    OrderStatus.UNKNOWN:{OrderStatus.PENDING,OrderStatus.OPEN,OrderStatus.PARTIAL_FILLED,OrderStatus.FILLED,OrderStatus.CANCELLED,OrderStatus.REJECTED,OrderStatus.EXPIRED},
}

@dataclass
class FillAccounting:
    gross_shares: Decimal=Decimal("0")
    net_shares: Decimal=Decimal("0")
    gross_proceeds: Decimal=Decimal("0")
    net_proceeds: Decimal=Decimal("0")
    fee: Decimal=Decimal("0")
    settled: bool=False

    def buy(self, gross_shares:Decimal, fee_in_shares:Decimal) -> None:
        if gross_shares < fee_in_shares: raise ValueError("buy fee exceeds gross shares")
        self.gross_shares += gross_shares; self.net_shares += gross_shares-fee_in_shares; self.fee += fee_in_shares
    def sell(self, gross_proceeds:Decimal, fee:Decimal) -> None:
        if gross_proceeds < fee: raise ValueError("sell fee exceeds proceeds")
        self.gross_proceeds += gross_proceeds; self.net_proceeds += gross_proceeds-fee; self.fee += fee
    def settle_once(self, payout:Decimal) -> Decimal | None:
        if self.settled:return None
        self.settled=True; return payout

def transition(current:OrderStatus, target:OrderStatus) -> OrderStatus:
    if current in TERMINAL_ORDER_STATUSES:
        if current is target:return current
        raise ValueError(f"terminal order cannot transition: {current}->{target}")
    if target not in ALLOWED.get(current,set()): raise ValueError(f"invalid order transition: {current}->{target}")
    return target
