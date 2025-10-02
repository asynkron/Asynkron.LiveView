import os
import asyncio
import json
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

if sys.platform == "win32":  # pragma: no cover - not intended for Windows CI
    pytest.skip("clihost integration tests require POSIX signals", allow_module_level=True)
def _pick_port() -> Tuple[str, int]:
    sock = socket.socket()
    sock.bind(("127.0.0.1", 0))
    host, port = sock.getsockname()
    sock.close()
    return host, port


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
