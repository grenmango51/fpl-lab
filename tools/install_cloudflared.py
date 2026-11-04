"""Install the pinned public tunnel binary after checking GitHub's digest."""

import hashlib
import json
import os
from pathlib import Path
import platform
import urllib.request

version = "2026.10.3"
architecture = {"x86_64": "amd64", "aarch64": "arm64"}[platform.machine()]
request = urllib.request.Request(f"https://api.github.com/repos/cloudflare/cloudflared/releases/tags/{version}",
    headers={"User-Agent": "OpenFPL-deploy"})
release = json.load(urllib.request.urlopen(request, timeout=30))
asset = next(row for row in release["assets"] if row["name"] == f"cloudflared-linux-{architecture}")
digest = asset.get("digest", "")
if not digest.startswith("sha256:"):
    raise SystemExit("The release has no SHA-256 receipt.")
raw = urllib.request.urlopen(asset["browser_download_url"], timeout=90).read()
if hashlib.sha256(raw).hexdigest() != digest.split(":")[1]:
    raise SystemExit("The release checksum does not match.")
path = Path.home() / ".local/bin/cloudflared"
path.parent.mkdir(parents=True, exist_ok=True)
temporary = path.with_suffix(".download")
temporary.write_bytes(raw)
os.chmod(temporary, 0o755)
temporary.replace(path)
print("Installed verified cloudflared", version)
