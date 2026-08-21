from datetime import datetime,timedelta,timezone
from bayse_bot.config import Settings
from bayse_bot.market import adapt_market,validate_market

def valid():
    now=datetime.now(timezone.utc)
    return {"id":"e","title":"BTC 15m","status":"open","engine":"CLOB","currency":"NGN","opensAt":now.isoformat(),"closesAt":(now+timedelta(minutes=15)).isoformat(),"resolutionRules":"BTC price from Bybit","resolutionSource":"Bybit","markets":[{"id":"m","question":"Will BTC go up?","outcomes":["YES","NO"]}]}

def test_valid_market_and_rejections(monkeypatch):
    e=valid();m=adapt_market(e,e["markets"][0]);s=Settings()
    assert validate_market(m,s)==[]
    e["engine"]="AMM";assert "unsupported_engine:AMM" in validate_market(adapt_market(e,e["markets"][0]),s)
    e=valid();e["currency"]="USD";assert any(x.startswith("currency_mismatch") for x in validate_market(adapt_market(e,e["markets"][0]),s))
    e=valid();e["closesAt"]=(datetime.now(timezone.utc)+timedelta(minutes=10)).isoformat();assert "not_15_minute_market" in validate_market(adapt_market(e,e["markets"][0]),s)
