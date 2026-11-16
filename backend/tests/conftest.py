import os
import sys
from pathlib import Path

os.environ["TRIPPLET_MODE"] = "dev_local"
# tests write and delete for real - never against prod, whatever the shell has set
os.environ.pop("TRIPPLET_WEB_ALLOW_PROD", None)
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
