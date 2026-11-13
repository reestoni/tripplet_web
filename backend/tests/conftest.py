import os
import sys
from pathlib import Path

os.environ["TRIPPLET_MODE"] = "dev_local"
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
