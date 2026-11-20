"""yarnscope_auto.py - analyses new YarnScope TDMS files by itself and saves the results (Nutzerwunsch 2026-11-20).

Every TRIPPLET_AUTO_ANALYSE_MIN minutes (default 10) the DTY and ATY TDMS folders are listed (names + dates only,
~0.2 s for 5'000 files). A file counts when it
- is not older than TRIPPLET_AUTO_ANALYSE_DAYS (default 14) - old files of old series are never touched,
- has not changed for TRIPPLET_AUTO_ANALYSE_SETTLE_MIN minutes (default 5) - a measurement still being written waits,
- belongs to a trial of its series exactly as the YarnScope tab matches it (dty/aty_service.trial_files: series +
  trial number, reference samples never) and that trial has NO analysis yet (ANALYSED_SQL) - nothing is overwritten.
Then the same analysis + save as "Save to DB" / the batch (dty: analyse_trial + save_analysis, aty: analyse_core_file +
save_db_row), one at a time on the YarnScope batch executor (never two heavy analyses at once). The saving user is the
series' backlog owner (else the first superuser); the owner gets one bell message per series and run
(type "yarnscope_auto_dty" / "_aty", click opens that YarnScope tab). A file that fails is skipped until it changes.

Safety: the TDMS folders on H: belong to PRODUCTION. Runs only when TRIPPLET_WEB_AUTO_ANALYSE=1 and either the mode is
prod or the TDMS folders are set explicitly (TRIPPLET_YARNSCOPE_DTY_DIR / _ATY_DIR) - a test instance against the dev DB
would otherwise attach production measurements to dev trials with the same series number.
"""
from __future__ import annotations

import logging
import os
import threading
import time
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional, Tuple

from . import core  # noqa: F401
from .user_context import reset, set_user

from db import series_tables as stb  # noqa: E402
from db.connection import fetch_all  # noqa: E402
from ui import notifications as nt  # noqa: E402
from ui.yarnscope import aty_service, dty_service  # noqa: E402

log = logging.getLogger("uvicorn.error.yarnscope_auto")   # lands in the server log like "slow request"

ENV_ON = "TRIPPLET_WEB_AUTO_ANALYSE"
NOTIFICATION_TYPE = "yarnscope_auto_{kind}"   # yarnscope_auto_dty / _aty -> the bell opens that tab


def _env_num(name: str, default: float) -> float:
    try:
        return float(os.environ.get(name) or default)
    except ValueError:
        return default


def interval_s() -> float:
    return max(1.0, _env_num("TRIPPLET_AUTO_ANALYSE_MIN", 10)) * 60


def settle_s() -> float:
    return max(0.0, _env_num("TRIPPLET_AUTO_ANALYSE_SETTLE_MIN", 5)) * 60


def max_age_s() -> float:
    return max(0.1, _env_num("TRIPPLET_AUTO_ANALYSE_DAYS", 14)) * 86400


def allowed() -> Tuple[bool, str]:
    """(may run, reason) - see the module doc."""
    if os.environ.get(ENV_ON) != "1":
        return False, f"{ENV_ON} is not 1"
    mode = os.environ.get("TRIPPLET_MODE", "dev_local")
    if mode != "prod" and not (os.environ.get(dty_service.ENV_TDMS_DIR) and os.environ.get(aty_service.ENV_TDMS_DIR)):
        return False, f"mode {mode}: the TDMS folders are production's - set {dty_service.ENV_TDMS_DIR} and " \
                      f"{aty_service.ENV_TDMS_DIR} to test folders"
    return True, ""


def _analyse_dty(path: Path, trial_id: int, user: Dict[str, Any]) -> bool:
    res, vals = dty_service.analyse_trial(path, trial_id)
    try:                                          # opening the tab afterwards shows it at once (web cache)
        from . import yarnscope as ys
        with ys._lock:
            k = ys._key(trial_id, path)
            ys._cache[k] = (res, vals)
            ys._cache.move_to_end(k)
            while len(ys._cache) > ys.CACHE_SIZE:
                ys._cache.popitem(last=False)
    except Exception:
        pass
    return bool(dty_service.save_analysis(int(trial_id), vals, user))


def _analyse_aty(path: Path, trial_id: int, user: Dict[str, Any]) -> bool:
    vals = aty_service.analyse_core_file(path)
    return bool(aty_service.save_db_row(int(trial_id), vals, user))


KINDS: Dict[str, Tuple[Any, Callable[[Path, int, Dict[str, Any]], bool]]] = {
    "dty": (dty_service, _analyse_dty),
    "aty": (aty_service, _analyse_aty),
}

_state: Dict[str, Any] = {"last_run": None, "last_result": None, "running": False, "thread": None}
_failed: Dict[Tuple[str, float], str] = {}       # (path, mtime) -> error; retried only when the file changes
_run_lock = threading.Lock()


def _candidates(svc: Any, now: float) -> Dict[int, Dict[str, float]]:
    """{series id: {file path: mtime}} of the files old enough to be complete and young enough to count."""
    base = Path(svc.tdms_base())
    out: Dict[int, Dict[str, float]] = {}
    if not base.exists():
        return out
    lo, hi = now - max_age_s(), now - settle_s()
    with os.scandir(base) as it:
        for e in it:
            if not e.name.lower().endswith(".tdms"):
                continue
            try:
                mt = e.stat().st_mtime
            except OSError:
                continue
            if not (lo <= mt <= hi):
                continue
            head = e.name.split("_", 1)[0]
            if head.isdigit():
                out.setdefault(int(head), {})[os.path.normcase(e.path)] = mt
    return out


def _owner(series_id: int) -> Optional[int]:
    rows = fetch_all("SELECT BacklogOwner FROM tblTrialSeries WHERE ID = ?", [series_id])
    if rows and rows[0].get("BacklogOwner"):
        return int(rows[0]["BacklogOwner"])
    su = nt.get_superuser_ids()
    return int(su[0]) if su else None


def _run_on_executor(fn: Callable[[], bool]) -> bool:
    """One heavy analysis at a time: shares the executor of the YarnScope batch."""
    from . import yarnscope as ys
    return ys._executor.submit(fn).result()


def scan_once(now: Optional[float] = None, run: Callable[[Callable[[], bool]], bool] = _run_on_executor) -> Dict[str, Any]:
    """One pass over both folders. Returns {"analysed": [...], "failed": [...], "series": n}."""
    now = time.time() if now is None else now
    done: List[Dict[str, Any]] = []
    failed: List[Dict[str, Any]] = []
    series_seen = 0
    for kind, (svc, analyse) in KINDS.items():
        try:
            cands = _candidates(svc, now)
        except Exception as e:                       # share not reachable: try again next time
            log.warning("yarnscope auto: %s folder not readable: %s", kind, e)
            continue
        for sid, files in sorted(cands.items()):
            try:
                st = stb.load_trials(sid)
                refs = set(st.reference_names)
                # the analysed ones first (one query) - the file search (a folder listing on the share per trial,
                # as the tab does it) only for the rest: 21 s -> well under a second when all are analysed
                ids = [int(t.get("ID")) for t in st.trials if t.get("ID") is not None and int(t.get("ID")) not in refs]
                done_ids = svc.analysed_trial_ids(ids)
                rest = [t for t in st.trials if t.get("ID") is not None and int(t.get("ID")) not in done_ids]
                rows = svc.trial_files(sid, rest, refs, with_analysed=True) if rest else []
            except Exception as e:
                log.warning("yarnscope auto: series %s not loaded: %s", sid, e)
                continue
            todo = []
            for r in rows:
                p = r.get("tdms")
                if p is None or r.get("analysed") or r.get("trial_id") is None:
                    continue
                key = os.path.normcase(str(p))
                if key in files and (key, files[key]) not in _failed:
                    todo.append((int(r["trial_id"]), Path(p), files[key], r.get("vno")))
            if not todo:
                continue
            series_seen += 1
            owner = _owner(sid)
            if owner is None:
                log.warning("yarnscope auto: series %s has no owner and there is no superuser - skipped", sid)
                continue
            user = {"id": owner, "access_level": 2}
            ok_n = 0
            for tid, path, mt, vno in todo:
                token = set_user(user)
                try:
                    ok = run(lambda: analyse(path, tid, user))
                except Exception as e:
                    ok = False
                    _failed[(os.path.normcase(str(path)), mt)] = str(e)[:300]
                    failed.append({"kind": kind, "series": sid, "trial": tid, "file": path.name, "error": str(e)[:300]})
                    log.warning("yarnscope auto: %s %s failed: %s", kind, path.name, e)
                finally:
                    reset(token)
                if ok:
                    ok_n += 1
                    done.append({"kind": kind, "series": sid, "trial": tid, "vno": vno, "file": path.name})
                elif (os.path.normcase(str(path)), mt) not in _failed:
                    _failed[(os.path.normcase(str(path)), mt)] = "not saved"
                    failed.append({"kind": kind, "series": sid, "trial": tid, "file": path.name, "error": "not saved"})
            if ok_n:
                nt.create_series_message_notification(
                    owner, sid, f"YarnScope {kind.upper()}: {ok_n} trial(s) analysed and saved automatically",
                    NOTIFICATION_TYPE.format(kind=kind))
    return {"analysed": done, "failed": failed, "series": series_seen}


def _loop() -> None:
    time.sleep(30)                                   # let the server start first
    while True:
        if _run_lock.acquire(blocking=False):
            _state["running"] = True
            try:
                res = scan_once()
                _state["last_result"] = res
                if res["analysed"] or res["failed"]:
                    log.warning("yarnscope auto: %d analysed, %d failed", len(res["analysed"]), len(res["failed"]))
            except Exception as e:                   # never let the thread die
                _state["last_result"] = {"error": str(e)[:300]}
                log.exception("yarnscope auto: pass failed")
            finally:
                _state["last_run"] = time.time()
                _state["running"] = False
                _run_lock.release()
        time.sleep(interval_s())


def start() -> bool:
    """Starts the background thread once (app startup). False (and a log line) when not allowed."""
    ok, why = allowed()
    if not ok:
        log.info("yarnscope auto-analysis off: %s", why)
        return False
    if _state["thread"] is None:
        th = threading.Thread(target=_loop, name="yarnscope-auto", daemon=True)
        _state["thread"] = th
        th.start()
        log.warning("yarnscope auto-analysis on: every %.0f min, files of the last %.0f days",
                    interval_s() / 60, max_age_s() / 86400)
    return True


def status() -> Dict[str, Any]:
    ok, why = allowed()
    return {"enabled": ok and _state["thread"] is not None, "reason": why, "running": _state["running"],
            "last_run": _state["last_run"], "last_result": _state["last_result"],
            "interval_min": interval_s() / 60, "days": max_age_s() / 86400, "settle_min": settle_s() / 60}
