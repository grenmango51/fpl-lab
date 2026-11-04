"""Keep the socket queue intact until Uvicorn has finished starting."""

import time
import urllib.error
import urllib.request
from pathlib import Path

values = dict(line.split("=", 1) for line in (Path.home() / ".config/open-fpl/production.env").read_text().splitlines() if "=" in line)
for attempt in range(60):
    try:
        request = urllib.request.Request("http://127.0.0.1:18083/api/health",
            headers={"X-Open-FPL-Origin-Token": values["OPEN_FPL_ORIGIN_TOKEN"]})
        with urllib.request.urlopen(request, timeout=1) as response:
            if response.status == 200:
                break
    except (OSError, urllib.error.URLError):
        time.sleep(0.25)
else:
    raise SystemExit("Open FPL did not start in time.")
