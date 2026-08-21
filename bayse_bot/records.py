from __future__ import annotations
import json
from datetime import datetime
from pathlib import Path
from .models import RunMode, to_jsonable

class RunRecorder:
    """Append-only JSONL; one file per record type means interrupted runs remain auditable."""
    def __init__(self, root: Path, mode: RunMode):
        self.root=root / datetime.now().strftime("%Y-%m-%d") / mode.value
        for name in ("logs","data","output","reports"): (self.root/name).mkdir(parents=True,exist_ok=True)
    def append(self, kind:str, record:dict):
        path=self.root/"data"/f"{kind}.jsonl"
        item={"recorded_at":datetime.now().astimezone().isoformat(),**to_jsonable(record)}
        with path.open("a",encoding="utf-8") as f:f.write(json.dumps(item,sort_keys=True,ensure_ascii=False)+"\n")
    def log(self,event:str,**fields): self.append("operational",{"event":event,**fields})
