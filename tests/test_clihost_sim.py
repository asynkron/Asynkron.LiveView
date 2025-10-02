import asyncio
import http.client
import json
import os
import signal
import socket
import subprocess
import sys
import time
from pathlib import Path
from typing import List, Tuple

import pytest
import websockets

ROOT = Path(__file__).resolve().parents[1]
CLIHOST = ROOT / "clihost.py"
HELPERS_DIR = ROOT / "tests" / "helpers"
SIMPLE_AGENT = HELPERS_DIR / "simple_agent.py"
SIM_SERVER = HELPERS_DIR / "simulated_server.py"
REAL_SERVER = ROOT / "server.py"

if sys.platform == "win32":  # pragma: no cover - not intended for Windows CI
    pytest.skip("clihost integration tests require POSIX signals", allow_module_level=True)


def _pick_port() -> Tuple[str, int]:
    sock = socket.socket()
    sock.bind(("127.0.0.1", 0))
    host, port = sock.getsockname()
    sock.close()
    return host, port


def _wait_for_http(host: str, port: int, timeout: float = 10.0) -> None:
    deadline = time.time() + timeout
    last_error: Exception | None = None

    while time.time() < deadline:
        conn: http.client.HTTPConnection | None = None
        try:
            conn = http.client.HTTPConnection(host, port, timeout=0.5)
            conn.request("GET", "/api/content")
            response = conn.getresponse()
            response.read()
            if response.status:
                return
        except Exception as exc:  # pragma: no cover - debugging aid
            last_error = exc
            time.sleep(0.1)
        finally:
            if conn is not None:
                conn.close()

    raise RuntimeError(f"server failed to start on {host}:{port}") from last_error


async def _send_ui_messages(host: str, port: int, messages: List[str], *, initial_delay: float = 0.6, between: float = 0.3) -> None:
    await asyncio.sleep(initial_delay)
    uri = f"ws://{host}:{port}/ws"

    async with websockets.connect(uri) as ws:
        try:
            await asyncio.wait_for(ws.recv(), timeout=5)
        except asyncio.TimeoutError:  # pragma: no cover - handshake optional
            pass

        for message in messages:
            payload = json.dumps({"type": "chat", "message": message})
            await ws.send(payload)
            await asyncio.sleep(between)


@pytest.fixture
def launch_server():
    processes: List[subprocess.Popen] = []

    def _launch(*, messages=None, interval=0.2, auto_stop=False):
        host, port = _pick_port()
        cmd = [
            sys.executable,
            str(SIM_SERVER),
            "--host",
            host,
            "--port",
            str(port),
            "--interval",
            str(interval),
        ]
        if messages:
            for msg in messages:
                cmd.extend(["--message", msg])
        if auto_stop:
            cmd.append("--auto-stop")

        proc = subprocess.Popen(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, text=True)

        deadline = time.time() + 5
        while time.time() < deadline:
            if proc.poll() is not None:
                _, stderr = proc.communicate()
                raise RuntimeError(f"simulated server exited early: {stderr}")
            try:
                with socket.create_connection((host, port), timeout=0.2):
                    break
            except OSError:
                time.sleep(0.05)
        else:
            proc.terminate()
            raise RuntimeError("simulated server failed to start")

        processes.append(proc)
        return host, port, proc

    yield _launch

    for proc in processes:
        if proc.poll() is None:
            proc.send_signal(signal.SIGINT)
            try:
                proc.wait(timeout=5)
            except subprocess.TimeoutExpired:
                proc.kill()


@pytest.mark.asyncio
async def test_simulated_server_broadcast(launch_server):
    host, port, _ = launch_server(messages=["hello"], interval=0.1, auto_stop=True)

    uri = f"ws://{host}:{port}/agent-feed"
    async with websockets.connect(uri) as ws:
        hello = json.loads(await asyncio.wait_for(ws.recv(), timeout=2))
        assert hello["type"] == "hello"
        chat = json.loads(await asyncio.wait_for(ws.recv(), timeout=2))
        assert chat["type"] == "chat"
        assert chat["text"] == "hello"


def _run_clihost(url: str, *extra_args: str) -> subprocess.Popen:
    env = os.environ.copy()
    env["PYTHONUNBUFFERED"] = "1"

    cmd = [
        sys.executable,
        "-u",
        str(CLIHOST),
        "--url",
        url,
        "--echo-chat",
        "--verbose",
        "--no-reconnect",
        "--",
        sys.executable,
        "-u",
        str(SIMPLE_AGENT),
    ]
    if extra_args:
        cmd[4:4] = list(extra_args)

    return subprocess.Popen(
        cmd,
        cwd=str(ROOT),
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        env=env,
    )


def test_clihost_receives_chat_and_stops_child(launch_server):
    host, port, _ = launch_server(messages=["hello", "quit"], interval=0.3, auto_stop=True)
    url = f"ws://{host}:{port}/agent-feed"

    proc = _run_clihost(url)
    stdout, _ = proc.communicate(timeout=10)

    assert proc.returncode == 0
    assert "[clihost] injected chat" in stdout
    assert "[simple-agent] received: hello" in stdout
    assert "[simple-agent] quitting" in stdout


def test_clihost_exits_on_connection_failure():
    host, port = _pick_port()
    url = f"ws://{host}:{port}/agent-feed"

    proc = _run_clihost(url)
    stdout, _ = proc.communicate(timeout=5)

    assert proc.returncode == 0
    assert "websocket error" in stdout
    assert "terminating child PID" in stdout
    assert "child exited" in stdout


def test_real_server_broadcast_reaches_clihost(tmp_path):
    host, port = _pick_port()

    env = os.environ.copy()
    env.setdefault("PYTHONUNBUFFERED", "1")

    server_cmd = [
        sys.executable,
        str(REAL_SERVER),
        "--dir",
        str(tmp_path),
        "--port",
        str(port),
        "--disable-mcp",
    ]

    server_proc = subprocess.Popen(
        server_cmd,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        env=env,
    )

    clihost_proc: subprocess.Popen | None = None
    clihost_stdout = ""

    try:
        _wait_for_http(host, port)

        url = f"ws://{host}:{port}/agent-feed"
        clihost_proc = _run_clihost(url)

        try:
            asyncio.run(
                _send_ui_messages(
                    host,
                    port,
                    ["hello from real server", "hello again", "quit", "quit"],
                    initial_delay=0.8,
                    between=0.3,
                )
            )
        finally:
            if clihost_proc.poll() is None:
                try:
                    clihost_stdout, _ = clihost_proc.communicate(timeout=15)
                except subprocess.TimeoutExpired:
                    clihost_proc.kill()
                    clihost_stdout, _ = clihost_proc.communicate(timeout=5)
            else:
                clihost_stdout, _ = clihost_proc.communicate()

        assert clihost_proc.returncode == 0, f"clihost failed with output:\n{clihost_stdout}"
        assert "[clihost] injected chat" in clihost_stdout
        assert "[simple-agent] received: hello from real server" in clihost_stdout
        assert "[simple-agent] quitting" in clihost_stdout

    finally:
        if server_proc.poll() is None:
            server_proc.send_signal(signal.SIGINT)
            try:
                server_proc.communicate(timeout=10)
            except subprocess.TimeoutExpired:
                server_proc.kill()
                server_proc.communicate(timeout=5)
