from datetime import datetime,timezone
from decimal import Decimal
from bayse_bot.bayse import parse_book
from bayse_bot.models import Outcome,RunMode
from bayse_bot.records import RunRecorder
from bayse_bot.reporting import report

def test_book_sort_depth_and_report(tmp_path):
    b=parse_book({"bids":[[".4","100"],[".5","50"]],"asks":[[".6","100"],[".55","50"]]},"m",Outcome.YES)
    assert b.best_bid==Decimal(".5") and b.best_ask==Decimal(".55") and b.depth_at_or_better("BUY",Decimal(".6"))==Decimal("87.50")
    rec=RunRecorder(tmp_path,RunMode.PAPER);rec.append("trades",{"record_type":"trade","pnl":"10","reasons":[]})
    result=report(rec.root);assert result["win_rate"]==1 and (rec.root/"reports"/"dashboard.html").exists()
