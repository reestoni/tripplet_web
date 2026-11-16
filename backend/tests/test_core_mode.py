"""Mode lock in app/core.py: prod only with TRIPPLET_WEB_ALLOW_PROD=1 (start_prod.ps1), never by accident.
Runs `import app.core` in a fresh process (the mode is fixed per process); nothing touches prod."""
import os
import subprocess
import sys
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1]


def _import_core(env_extra: dict) -> subprocess.CompletedProcess:
    env = {k: v for k, v in os.environ.items() if k not in ("TRIPPLET_MODE", "TRIPPLET_WEB_ALLOW_PROD")}
    env.update(env_extra)
    return subprocess.run([sys.executable, "-c", "import app.core"], cwd=BACKEND, env=env,
                          capture_output=True, text=True, timeout=60)


def test_prod_refused_without_switch():
    r = _import_core({"TRIPPLET_MODE": "prod"})
    assert r.returncode != 0 and "not allowed" in r.stderr


def test_dev_refused_even_with_prod_switch():
    r = _import_core({"TRIPPLET_MODE": "dev", "TRIPPLET_WEB_ALLOW_PROD": "1"})
    assert r.returncode != 0 and "not allowed" in r.stderr


def test_tests_never_run_against_prod():
    # conftest.py forces dev_local and drops the switch
    from app import auth, core
    assert core.MODE == "dev_local" and not core.ALLOW_PROD and auth.COOKIE_NAME == "tripplet_session"
