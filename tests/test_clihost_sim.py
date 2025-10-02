import os
import signal
import socket
import subprocess
import sys
import time
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
CLIHOST = ROOT / "clihost.py"
RUN_SCRIPT = ROOT / "run_clihost.sh"
SIMPLE_AGENT = ROOT / "simple_agent.py"
SIM_SERVER = ROOT / "simulated_server.py"


@pytest.fixture(scope="module")
def simulated_server():
    sock = socket.socket()
    sock.bind(("127.0.0.1", 0))
    host, port = sock.getsockname()
    sock.close()

    proc = subprocess.Popen(
        [sys.executable, str(SIM_SERVER), "--host", host, "--port", str(port)],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.PIPE,
        text=True,
    )

    # Wait for port to become available
    deadline = time.time() + 5
    while time.time() < deadline:
        if proc.poll() is not None:
            stdout, stderr = proc.communicate()
            raise RuntimeError(f"simulated server exited early: {stderr}")
        try:
            with socket.create_connection((host, port), timeout=0.2):
                break
        except OSError:
            time.sleep(0.1)
    else:
        proc.terminate()
        raise RuntimeError("simulated server failed to start")

    yield host, port, proc
    proc.send_signal(signal.SIGINT)
    try:
        proc.wait(timeout=5)
    except subprocess.TimeoutExpired:
        proc.kill()


def test_clihost_receives_chat(simulated_server):
    host, port, _ = simulated_server
    if sys.platform == "win32":
        pytest.skip("clihost test requires POSIX shell")

    env = os.environ.copy()
    env["PYTHONUNBUFFERED"] = "1"

    proc = subprocess.Popen(
        [
            sys.executable,
            "-u",
            str(CLIHOST),
            "--url",
            f"ws://{host}:{port}/agent-feed",
            "--echo-chat",
            "--verbose",
            "--no-reconnect",
            "--",
            sys.executable,
            "-u",
            str(SIMPLE_AGENT),
        ],
        cwd=str(ROOT),
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        env=env,
    )

    try:
        time.sleep(3)
        proc.send_signal(signal.SIGINT)
        stdout, _ = proc.communicate(timeout=5)
        assert "[clihost] injected chat" in stdout, stdout
    finally:
        if proc.poll() is None:
            proc.kill()
