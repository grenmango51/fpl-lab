"""Deploy using existing local credentials; never print or pass secrets as args."""

from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import shlex
import subprocess
import urllib.error
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
ACCOUNT = "75c6177cf669342ee7b051bdd6682008"
PRIVATE = Path.home() / ".config" / "open-fpl"


def env_file(path):
    values = {}
    for line in path.read_text().splitlines():
        line = line.strip().removeprefix("export ")
        if line and not line.startswith("#"):
            key, _, value = line.partition("=")
            values[key] = shlex.split(value)[0] if value else ""
    return values


def environment():
    env = dict(os.environ)
    if not env.get("CLOUDFLARE_API_TOKEN"):
        env.update(env_file(Path.home() / ".config/flight-finder/cloudflare.env"))
    env["CLOUDFLARE_ACCOUNT_ID"] = ACCOUNT
    env["WRANGLER_SEND_METRICS"] = "false"
    return env


def api(path, body=None):
    request = urllib.request.Request("https://api.cloudflare.com/client/v4/" + path,
        data=json.dumps(body).encode() if body is not None else None,
        headers={"Authorization": "Bearer " + environment()["CLOUDFLARE_API_TOKEN"], "Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(request, timeout=45) as response:
            return json.load(response)["result"]
    except urllib.error.HTTPError as exc:
        raise RuntimeError(f"Cloudflare API returned HTTP {exc.code}.") from None


def wrangler(*args, secret=None):
    subprocess.run(["npx", "wrangler", *args], cwd=ROOT, env=environment(),
        input=secret.encode() if secret is not None else None, check=True)


def provision():
    databases = api(f"accounts/{ACCOUNT}/d1/database")
    database = next((row for row in databases if row["name"] == "open-fpl"), None)
    if database is None:
        database = api(f"accounts/{ACCOUNT}/d1/database", {"name": "open-fpl", "primary_location_hint": "weur"})
    path = ROOT / "wrangler.jsonc"
    config = json.loads(path.read_text())
    config["d1_databases"][0]["database_id"] = database["uuid"]
    path.write_text(json.dumps(config, indent=2) + "\n")
    print("Open FPL session database configured.")


def put_secrets():
    origin = env_file(PRIVATE / "production.env")
    google = env_file(Path.home() / ".config/flight-finder/google.env")
    wrangler("secret", "put", "ORIGIN_TOKEN", secret=origin["OPEN_FPL_ORIGIN_TOKEN"])
    wrangler("secret", "put", "GOOGLE_CLIENT_SECRET", secret=google["GOOGLE_CLIENT_SECRET"])


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("action", choices=("provision", "secrets", "deploy"))
    args = parser.parse_args()
    if args.action == "provision":
        provision()
    elif args.action == "secrets":
        put_secrets()
    else:
        wrangler("d1", "migrations", "apply", "DB", "--remote")
        wrangler("deploy")
