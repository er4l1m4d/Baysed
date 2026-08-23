from datetime import datetime,timedelta,timezone
from bayse_bot.config import Settings
from bayse_bot.market import adapt_market,validate_market

def valid():
    now=datetime.now(timezone.utc)
    return {"id":"e","title":"BTC 15m","status":"open","engine":"CLOB","currency":"USD","resolutionSource":"https://binance.com/en/trade/BTC_USDT","resolutionRules":"BTC price from Binance","createdAt":now.isoformat(),"closingDate":(now+timedelta(minutes=15)).isoformat(),"markets":[{"id":"m","question":"Will BTC go up?","outcome1Label":"Up","outcome2Label":"Down","outcome1Id":"o1","outcome2Id":"o2","rules":"BTC price from Binance","status":"open"}]}

def test_valid_market_and_rejections(monkeypatch):
    e=valid();m=adapt_market(e,e["markets"][0]);s=Settings()
    assert validate_market(m,s)==[]
    e["engine"]="AMM";assert "unsupported_engine:AMM" in validate_market(adapt_market(e,e["markets"][0]),s)
    e=valid();e["currency"]="NGN";assert any(x.startswith("currency_mismatch") for x in validate_market(adapt_market(e,e["markets"][0]),s))
    e=valid();e["closingDate"]=(datetime.now(timezone.utc)+timedelta(minutes=10)).isoformat();assert "not_15_minute_market" in validate_market(adapt_market(e,e["markets"][0]),s)
