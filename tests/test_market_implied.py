"""Regression tests for canonical market-implied P(yes) semantics.

Run 001 found that bayse_implied stored the ask of the PREDICTED side
(yes_ask when predicting YES, no_ask when predicting NO). Comparing that
against the yes-won indicator made brier_market worse than random
(0.376 stored vs 0.1995 corrected). These tests pin the canonical
semantics: bayse_implied is ALWAYS market-implied P(yes).
"""
from decimal import Decimal

from bayse_bot.predictions import market_implied_p_yes


def test_p_yes_prefers_yes_ask():
    assert market_implied_p_yes(Decimal("0.62"), Decimal("0.41")) == Decimal("0.62")


def test_p_yes_falls_back_to_one_minus_no_ask():
    assert market_implied_p_yes(None, Decimal("0.35")) == Decimal("0.65")


def test_p_yes_none_when_book_empty():
    assert market_implied_p_yes(None, None) is None


def test_p_yes_is_outcome_independent():
    # The old bug: a NO prediction stored no_ask (~0.99) as "implied",
    # which then scored ~0.98 Brier on yes_won rows. The canonical value
    # must not depend on the prediction at all.
    yes_ask, no_ask = Decimal("0.03"), Decimal("0.97")
    assert market_implied_p_yes(yes_ask, no_ask) == Decimal("0.03")
    assert market_implied_p_yes(yes_ask, no_ask) == Decimal("1") - Decimal("0.97")
