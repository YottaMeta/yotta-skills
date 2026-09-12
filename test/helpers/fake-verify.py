#!/usr/bin/env python3
import json
import os
import sys

verdict = os.environ.get("YOTTA_SKILLS_FAKE_VERDICT", "SAFE TO INSTALL")
counts = {
    "critical": 1 if verdict == "DO NOT INSTALL" else 0,
    "high": 0,
    "medium": 0,
    "low": 0,
    "info": 0,
}
if os.environ.get("YOTTA_SKILLS_FAKE_INVALID_JSON") == "1":
    print("not-json")
    sys.exit(0)
print(json.dumps({"verdict": verdict, "counts": counts}))
sys.exit(3 if verdict == "DO NOT INSTALL" else 0)
