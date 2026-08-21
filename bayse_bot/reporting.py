from __future__ import annotations
import csv,json
from collections import Counter
from pathlib import Path

def report(run_root:Path)->dict:
    data_dir=run_root/"data"; records=[]
    for path in data_dir.glob("*.jsonl"):
        records.extend(json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip())
    trades=[r for r in records if r.get("record_type")=="trade" or "pnl" in r]
    pnls=[float(r["pnl"]) for r in trades if r.get("pnl") is not None]
    wins=sum(x>0 for x in pnls); n=len(pnls)
    hourly={str(h): {"count":sum(1 for r in trades if r.get("wat_hour")==h), "pnl":sum(float(r.get("pnl",0) or 0) for r in trades if r.get("wat_hour")==h)} for h in sorted({r.get("wat_hour") for r in trades if r.get("wat_hour") is not None})}
    summary={"run":str(run_root),"record_count":len(records),"closed_trade_count":n,"win_rate":wins/n if n else None,"pnl":sum(pnls) if pnls else None,"expectancy":sum(pnls)/n if n else None,"paper_performance_by_wat_hour":hourly,"rejections":dict(Counter(reason for r in records for reason in r.get("reasons",[]))),"data_quality":dict(Counter(r.get("data_quality","unspecified") for r in records))}
    out=run_root/"reports";out.mkdir(exist_ok=True)
    (out/"summary.json").write_text(json.dumps(summary,indent=2,sort_keys=True))
    keys=sorted({k for r in records for k in r if not isinstance(r.get(k),(dict,list))})
    with (out/"records.csv").open("w",newline="",encoding="utf-8") as f:
        w=csv.DictWriter(f,fieldnames=keys);w.writeheader();w.writerows({k:r.get(k) for k in keys} for r in records)
    (out/"dashboard.html").write_text("<html><body><h1>Bayse BTC Bot Report</h1><p>Mode-separated research output. Paper P&amp;L is not live performance.</p><pre>"+json.dumps(summary,indent=2)+"</pre></body></html>")
    return summary
