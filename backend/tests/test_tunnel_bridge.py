"""A live process must not leave the hosted planner behind a dead Quick Tunnel."""

import io
import json
import subprocess
import urllib.error

import pytest

from tools import tunnel_bridge as bridge


@pytest.fixture
def clock(monkeypatch):
    value = [0.0]
    monkeypatch.setattr(bridge.time, "monotonic", lambda: value[0])
    return value


def test_expired_tunnel_fails_immediately_even_while_process_is_alive(clock):
    monitor = bridge.TunnelMonitor("private")
    with pytest.raises(bridge.TunnelUnavailable, match="discarded"):
        monitor.observe('ERR Register tunnel error="Unauthorized: Tunnel not found"')


def test_silent_disconnection_is_bounded_without_touching_the_api(clock, monkeypatch):
    monkeypatch.setattr(bridge, "tunnel_ready", lambda: False)
    monitor = bridge.TunnelMonitor("private")
    monitor.check()
    clock[0] = 119
    monitor.check()
    clock[0] = 120
    with pytest.raises(bridge.TunnelUnavailable, match="two minutes"):
        monitor.check()


def test_transient_disconnect_recovers_and_resets_the_failure_window(clock, monkeypatch):
    ready = [True]
    monkeypatch.setattr(bridge, "tunnel_ready", lambda: ready[0])
    monkeypatch.setattr(bridge, "register_origin", lambda *_: None)
    monitor = bridge.TunnelMonitor("private")
    monitor.observe("https://example.trycloudflare.com")
    monitor.check()
    ready[0] = False
    clock[0] = 30
    monitor.check()
    clock[0] = 119
    monitor.check()
    ready[0] = True
    clock[0] = 134
    monitor.check()
    ready[0] = False
    clock[0] = 240
    monitor.check()
    clock[0] = 254
    with pytest.raises(bridge.TunnelUnavailable, match="two minutes"):
        monitor.check()


def test_only_connected_tunnels_are_published_and_registration_is_not_repeated(clock, monkeypatch):
    ready = [False]
    publications = []
    monkeypatch.setattr(bridge, "tunnel_ready", lambda: ready[0])
    monkeypatch.setattr(bridge, "register_origin", lambda *args: publications.append(args))
    monitor = bridge.TunnelMonitor("private")
    monitor.observe("Visit https://example.trycloudflare.com")
    monitor.check()
    assert publications == []
    ready[0] = True
    clock[0] = 15
    monitor.check()
    for now in (30, 180, 3600):
        clock[0] = now
        monitor.check()
    assert publications == [("https://example.trycloudflare.com", "private")]


def test_missing_url_cannot_leave_a_healthy_but_unregistered_process_forever(clock, monkeypatch):
    monkeypatch.setattr(bridge, "tunnel_ready", lambda: True)
    monitor = bridge.TunnelMonitor("private")
    monitor.check()
    clock[0] = 180
    with pytest.raises(bridge.TunnelUnavailable, match="startup or origin registration stalled"):
        monitor.check()


def test_registration_failures_retry_then_replace_without_logging_the_token(clock, monkeypatch, capsys):
    monkeypatch.setattr(bridge, "tunnel_ready", lambda: True)

    def fail(*_):
        raise OSError("request failed with a sensitive diagnostic")

    monkeypatch.setattr(bridge, "register_origin", fail)
    monitor = bridge.TunnelMonitor("private-token")
    monitor.observe("https://example.trycloudflare.com")
    for attempt in range(7):
        clock[0] = attempt * 3
        monitor.check()
    clock[0] = 21
    with pytest.raises(bridge.TunnelUnavailable, match="Could not register"):
        monitor.check()
    output = capsys.readouterr().out
    assert "private-token" not in output
    assert "sensitive diagnostic" not in output


@pytest.mark.parametrize("connections", [0, 1])
def test_readiness_checks_the_connector_not_forecasting(connections, monkeypatch):
    class Response(io.StringIO):
        status = 200

    def respond(url, *, timeout):
        assert url == "http://127.0.0.1:18084/ready"
        assert timeout == 2
        return Response(json.dumps({"readyConnections": connections}))

    monkeypatch.setattr(bridge.urllib.request, "urlopen", respond)
    assert bridge.tunnel_ready() is bool(connections)


@pytest.mark.parametrize("error", [urllib.error.URLError("unreachable"), ValueError("invalid JSON")])
def test_readiness_failures_are_recoverable(error, monkeypatch):
    def fail(*_, **__):
        raise error

    monkeypatch.setattr(bridge.urllib.request, "urlopen", fail)
    assert bridge.tunnel_ready() is False


@pytest.mark.parametrize("hangs", [False, True])
def test_recovery_reaps_the_old_connector_before_systemd_restarts_it(clock, monkeypatch, hangs):
    class Process:
        stderr = io.StringIO('ERR error="Unauthorized: Tunnel not found"\n')
        terminated = killed = False

        def poll(self):
            return None

        def terminate(self):
            self.terminated = True

        def kill(self):
            self.killed = True

        def wait(self, timeout):
            if hangs and not self.killed:
                raise subprocess.TimeoutExpired("cloudflared", timeout)
            return 0

    process = Process()
    monkeypatch.setattr(bridge.subprocess, "Popen", lambda *_, **__: process)
    monkeypatch.setattr(bridge, "tunnel_ready", lambda: False)
    with pytest.raises(bridge.TunnelUnavailable, match="discarded"):
        bridge.run("private")
    assert process.terminated
    assert process.killed is hangs
    assert process.stderr.closed
