# Error Log — Baysed Development

Log of every error encountered while editing, its root cause, and its solution.
Check this file FIRST when hitting a new error — similar errors often share solutions.

Format:

## YYYY-MM-DD — short error title
- **Error:** exact message / symptom
- **Context:** what task triggered it
- **Root cause:** why it happened
- **Solution:** what fixed it
- **Prevention:** how to avoid it next time (if applicable)

---

## 2026-09-10 — PowerShell `>` writes UTF-16, breaking JSON
- **Error:** `node -e "JSON.parse(fs.readFileSync(...))"` → `SyntaxError: Unexpected token '�'` after redirecting command output with `>`
- **Context:** exporting opencode session, reading `critique.js` output
- **Root cause:** PowerShell 5.1 `>` redirection encodes as UTF-16 LE with BOM; Node reads UTF-8
- **Solution:** use `cmd /c "command > file"` for UTF-8 output, or have scripts write files themselves (preferred)
- **Prevention:** never parse PowerShell-redirected output as UTF-8 JSON; let Node scripts write their own files

## 2026-09-10 — Bad erf() approximation poisoned statistical results
- **Error:** Gaussian recompute matched only 1.7% of rows (expected ~100%); p-values printed as `1.000e+0`
- **Context:** `analysis/critique.js` — recomputing model probability as Φ(z)
- **Root cause:** hand-written erf approximation had constants in wrong positions (not the actual A&S formula); also `p_value` display used `1 - erf(...)` producing nonsense for large |t|
- **Solution:** replaced with correct Abramowitz-Stegun 7.1.26 (max error 1.5e-7); re-ran everything, discarded prior numbers
- **Prevention:** never hand-roll numeric special functions from memory; copy a cited formula verbatim and test against known values (erf(1)≈0.8427) before trusting output

## 2026-09-10 — WS test harness hung: unbounded recv() can't observe a wall-clock deadline
- **Error:** A/B keepalive test produced no output and the shell killed it at timeout; neither task printed its DONE line
- **Context:** Phase A3 — testing candidate WS keepalive config against live Bayse server
- **Root cause:** two compounding flaws: (1) conn B used `await ws.recv()` with no timeout, so the `while time < DURATION` check between recvs never fired — recv blocks forever on silence; (2) all events were buffered and printed only after `asyncio.gather`, so partial results were invisible
- **Solution:** poll pattern — `wait_for(ws.recv(), timeout=30)` with `except TimeoutError: continue` (timeout = clock check, NOT connection failure), plus `flush=True` live printing
- **Prevention:** any loop bounded by wall-clock time needs a periodic wake-up; never buffer test output until the end. The poll pattern is now also the production fix in `bayse_market_ws.py`

## 2026-09-10 — urlunparse mangles SQLite URLs (drops a slash)
- **Error:** `sqlalchemy.exc.ArgumentError: Could not parse SQLAlchemy URL from given URL string` when importing `api.server` locally
- **Context:** Phase A5 — verifying server imports before deploy
- **Root cause:** `urlunparse(urlparse(u)._replace(query=""))` turns `sqlite+aiosqlite:///./bayse_bot.db` into `sqlite+aiosqlite:/./bayse_bot.db` — with an EMPTY netloc, urlunparse collapses `scheme:///path` to `scheme:/path`, which SQLAlchemy rejects. Production never hit it because Postgres URLs have a netloc and round-trip cleanly
- **Solution:** only round-trip through urlunparse when `parsed.query` is non-empty (the query-strip is only needed for Neon's sslmode extras) — in both `api/database.py` and `api/init_db.py`
- **Prevention:** round-tripping through urlparse/urlunparse is NOT identity for all URL shapes; test with every scheme the code will see. Query-strip helpers should be no-ops when there's no query

## 2026-09-10 — Passing connect_args=None explicitly crashes SQLAlchemy
- **Error:** `TypeError: 'NoneType' object is not iterable` in `sqlalchemy/engine/create.py` at import of `api.database`
- **Context:** Phase A5 — surfaced only AFTER the urlunparse fix above let the SQLite path reach create_async_engine
- **Root cause:** `connect_args=connect_args if connect_args else None` passes None explicitly when no SSL is needed; SQLAlchemy's `pop_kwarg("connect_args", {})` returns None (explicit kwarg overrides the default), then `cparams.update(None)` explodes. Production masked it: Neon URLs always set sslmode=require → non-empty dict
- **Solution:** always pass `connect_args=connect_args` (empty dict is the effective default)
- **Prevention:** never pass `x if x else None` for a parameter whose library default is a mutable like `{}` — passing None is NOT the same as omitting the kwarg. Check: two latent "local SQLite startup broken" bugs hid behind one working production config
