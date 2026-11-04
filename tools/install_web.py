"""Install the socket-activated personal API without altering the collector."""

from pathlib import Path
import os
import secrets
import shutil
import subprocess

ROOT = Path(__file__).resolve().parents[1]
private = Path.home() / ".config/open-fpl"
private.mkdir(mode=0o700, parents=True, exist_ok=True)
os.chmod(private, 0o700)
env = private / "production.env"
if not env.exists():
    with open(env, "x", opener=lambda path, flags: os.open(path, flags, 0o600)) as file:
        file.write("OPEN_FPL_ORIGIN_TOKEN=" + secrets.token_urlsafe(48) + "\n")
        file.write("OPEN_FPL_WORKSPACE_PATH=" + str(ROOT / "data/workspace.sqlite3") + "\n")
os.chmod(env, 0o600)
units = Path.home() / ".config/systemd/user"
units.mkdir(parents=True, exist_ok=True)
for name in ("open-fpl-web.service", "open-fpl-web.socket", "open-fpl-web-proxy.service", "open-fpl-backup.service", "open-fpl-backup.timer", "open-fpl-tunnel.service"):
    shutil.copyfile(ROOT / "deploy" / name, units / name)
subprocess.run(["systemctl", "--user", "daemon-reload"], check=True)
subprocess.run(["systemctl", "--user", "enable", "--now", "open-fpl-web.socket", "open-fpl-backup.timer"], check=True)
print("Personal API socket installed. Origin credentials remain in a private environment file.")
