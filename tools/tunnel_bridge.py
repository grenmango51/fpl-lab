"""Publish the private origin and replace expired or disconnected Quick Tunnels."""

from __future__ import annotations

import json
from pathlib import Path
from queue import Empty, Queue
import re
import subprocess
from threading import Thread
import time
import urllib.request


METRICS_ADDRESS = "127.0.0.1:18084"
CHECK_INTERVAL = 15
DISCONNECTED_TIMEOUT = 120
STARTUP_TIMEOUT = 180
REGISTRATION_ATTEMPTS = 8


class TunnelUnavailable(RuntimeError):
    """Exit so systemd creates and registers a fresh tunnel."""


def tunnel_ready():
    # Probe cloudflared, not the API: idle forecasting must remain socket-activated.
    try:
        with urllib.request.urlopen(f"http://{METRICS_ADDRESS}/ready", timeout=2) as response:
            status = json.load(response)
            return response.status == 200 and status.get("readyConnections", 0) > 0
    except (OSError, ValueError, TypeError, AttributeError):
        return False


def register_origin(url, token):
    request = urllib.request.Request(
        "https://open-fpl.hoaianh517.workers.dev/internal/origin",
        data=json.dumps({"url": url}).encode(),
        headers={
            "Authorization": "Bearer " + token,
            "Content-Type": "application/json",
            "User-Agent": "Mozilla/5.0 OpenFPL-origin/1.0",
        },
    )
    with urllib.request.urlopen(request, timeout=10) as response:
        if response.status != 200 or json.load(response).get("registered") is not True:
            raise OSError("Origin registration was not acknowledged.")


class TunnelMonitor:
    def __init__(self, token):
        self.token = token
        self.started_at = self.last_ready_at = time.monotonic()
        self.next_check_at = self.next_registration_at = self.started_at
        self.url = None
        self.ready = self.registered = False
        self.attempts = 0

    def observe(self, line):
        # cloudflared otherwise retries this permanently invalid tunnel forever.
        if "unauthorized: tunnel not found" in line.lower():
            raise TunnelUnavailable("Cloudflare discarded the tunnel; creating a replacement.")
        if self.url is None:
            match = re.search(r"https://[a-z0-9-]+\.trycloudflare\.com", line)
            if match:
                self.url = match.group(0)

    def check(self):
        now = time.monotonic()
        if now >= self.next_check_at:
            self.ready = tunnel_ready()
            self.next_check_at = now + CHECK_INTERVAL
            if self.ready:
                self.last_ready_at = now
        if not self.ready and now - self.last_ready_at >= DISCONNECTED_TIMEOUT:
            raise TunnelUnavailable("Tunnel disconnected for two minutes; creating a replacement.")
        if not self.registered and now - self.started_at >= STARTUP_TIMEOUT:
            raise TunnelUnavailable("Tunnel startup or origin registration stalled; retrying.")
        if self.url and self.ready and not self.registered and now >= self.next_registration_at:
            self.attempts += 1
            try:
                register_origin(self.url, self.token)
            except (OSError, ValueError, AttributeError):
                if self.attempts >= REGISTRATION_ATTEMPTS:
                    raise TunnelUnavailable("Could not register the private planning tunnel.") from None
                self.next_registration_at = time.monotonic() + 3
                print("Origin registration unavailable; retrying.", flush=True)
            else:
                self.registered = True
                print("Private planning tunnel registered.", flush=True)


def read_output(stream, events):
    try:
        for line in stream:
            events.put(line)
    finally:
        events.put(None)


def run(token):
    process = subprocess.Popen(
        [str(Path.home() / ".local/bin/cloudflared"), "tunnel", "--no-autoupdate",
         "--url", "http://127.0.0.1:18082", "--protocol", "http2",
         "--metrics", METRICS_ADDRESS, "--grace-period", "5s"],
        stderr=subprocess.PIPE,
        text=True,
    )
    events = Queue()
    reader = Thread(target=read_output, args=(process.stderr, events), daemon=True)
    reader.start()
    monitor = TunnelMonitor(token)
    try:
        while True:
            # A separate reader keeps checks running even when cloudflared is silent.
            monitor.check()
            try:
                line = events.get(timeout=CHECK_INTERVAL)
            except Empty:
                continue
            if line is None:
                raise TunnelUnavailable("Tunnel process exited; creating a replacement.")
            print(line.rstrip(), flush=True)
            monitor.observe(line)
    finally:
        if process.poll() is None:
            process.terminate()
        try:
            process.wait(timeout=10)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait(timeout=5)
        reader.join(timeout=1)
        process.stderr.close()


def main():
    private = Path.home() / ".config/open-fpl/production.env"
    settings = dict(line.split("=", 1) for line in private.read_text().splitlines() if "=" in line)
    try:
        run(settings["OPEN_FPL_ORIGIN_TOKEN"])
    except (OSError, TunnelUnavailable) as error:
        print(str(error), flush=True)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
