#!/usr/bin/env python3
"""Host a CLI agent and inject chat messages delivered by the Live View server.

The host keeps the terminal interactive for the human operator while also
listening to `/agent-feed` for server-originated chat messages. Each incoming
message is appended with a configurable newline and written to the agent's stdin
so the agent reacts as if the user had typed it manually.
"""

from __future__ import annotations

import argparse
import asyncio
import base64
import json
import os
import queue
import signal
import sys
import threading
from dataclasses import dataclass
from typing import List, Optional

import websockets

DEFAULT_URL = "ws://localhost:8080/agent-feed"


@dataclass
class HostConfig:
    """Configuration derived from CLI flags."""

    url: str
    encoding: str
    echo_injections: bool
    injection_prefix: str
    newline: str
    reconnect: bool
    forward_stdin: bool


def parse_args() -> tuple[HostConfig, List[str]]:
    """Split host options from the child command."""

    if "--" not in sys.argv:
        raise SystemExit(
            "Usage: clihost.py [host options] -- <agent command> [args...]"
        )

    idx = sys.argv.index("--")
    host_argv = sys.argv[1:idx]
    child_cmd = sys.argv[idx + 1 :]

    parser = argparse.ArgumentParser(
        description="Run a CLI agent and forward chat messages from the Live View server.",
    )
    parser.add_argument("--url", default=DEFAULT_URL, help="WebSocket URL to the server feed")
    parser.add_argument(
        "--encoding",
        default="utf-8",
        help="Encoding used when writing to the child stdin",
    )
    parser.add_argument(
        "--echo-injections",
        action="store_true",
        help="Print injected lines with a prefix before forwarding to the agent",
    )
    parser.add_argument(
        "--injection-prefix",
        default="[server] ",
        help="Prefix printed before injected lines when echoing",
    )
    parser.add_argument(
        "--newline",
        default="\\n",
        help="Newline (supports escape sequences) appended to injected messages",
    )
    parser.add_argument(
        "--no-reconnect",
        action="store_true",
        help="Disable automatic WebSocket reconnection",
    )
    parser.add_argument(
        "--no-user-stdin",
        action="store_true",
        help="Do not forward keyboard input to the child process",
    )

    args = parser.parse_args(host_argv)
    if not child_cmd:
        raise SystemExit("Missing child command after '--'")

    config = HostConfig(
        url=args.url,
        encoding=args.encoding,
        echo_injections=args.echo_injections,
        injection_prefix=args.injection_prefix,
        newline=args.newline.encode("utf-8").decode("unicode_escape"),
        reconnect=not args.no_reconnect,
        forward_stdin=not args.no_user_stdin,
    )
    return config, child_cmd


async def spawn_child(cmd: List[str]) -> asyncio.subprocess.Process:
    """Launch the agent process with stdio pipes."""

    return await asyncio.create_subprocess_exec(
        *cmd,
        stdin=asyncio.subprocess.PIPE,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )


async def pump_stream(reader: asyncio.StreamReader, dest) -> None:
    """Forward bytes from the child to the parent terminal."""

    while True:
        chunk = await reader.read(4096)
        if not chunk:
            break
        dest.buffer.write(chunk) if hasattr(dest, "buffer") else dest.write(chunk.decode(errors="replace"))
        try:
            dest.flush()
        except Exception:
            pass


def stdin_collector(out_q: "queue.Queue[Optional[str]]") -> None:
    """Collect blocking stdin input on a background thread."""

    try:
        for line in sys.stdin:
            out_q.put(line)
    finally:
        out_q.put(None)


async def forward_stdin(
    proc: asyncio.subprocess.Process,
    input_q: "queue.Queue[Optional[str]]",
    encoding: str,
) -> None:
    """Write queued stdin lines to the child process."""

    loop = asyncio.get_running_loop()
    while True:
        line = await loop.run_in_executor(None, input_q.get)
        if line is None or proc.stdin is None:
            break
        try:
            proc.stdin.write(line.encode(encoding, errors="replace"))
            await proc.stdin.drain()
        except Exception:
            break


async def inject_line(
    proc: asyncio.subprocess.Process,
    text: str,
    encoding: str,
    newline: str,
) -> None:
    """Send a line of text to the child process."""

    if proc.stdin is None:
        return
    data = f"{text}{newline}".encode(encoding, errors="replace")
    proc.stdin.write(data)
    try:
        await proc.stdin.drain()
    except Exception:
        pass


async def handle_message(
    proc: asyncio.subprocess.Process,
    config: HostConfig,
    payload: str,
) -> None:
    """Decode and forward a WebSocket message."""

    try:
        message = json.loads(payload)
    except json.JSONDecodeError:
        message = {"type": "chat", "text": payload}

    msg_type = message.get("type")
    if msg_type == "chat":
        text = message.get("text", "")
        if config.echo_injections:
            print(f"{config.injection_prefix}{text}")
            sys.stdout.flush()
        await inject_line(proc, text, config.encoding, config.newline)
    elif msg_type == "raw":
        if proc.stdin is None:
            return
        try:
            raw_bytes = base64.b64decode(message.get("bytes_b64", ""))
        except Exception:
            return
        proc.stdin.write(raw_bytes)
        try:
            await proc.stdin.drain()
        except Exception:
            pass
    elif msg_type == "control" and message.get("cmd") == "quit":
        proc.terminate()


async def websocket_consumer(proc: asyncio.subprocess.Process, config: HostConfig) -> None:
    """Connect to the agent feed and inject incoming messages."""

    backoff = 1
    while True:
        try:
            async with websockets.connect(
                config.url,
                ping_interval=20,
                ping_timeout=20,
                max_size=None,
            ) as ws:
                backoff = 1
                hello = {"type": "host", "pid": os.getpid()}
                await ws.send(json.dumps(hello))
                async for payload in ws:
                    await handle_message(proc, config, payload)
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            print(f"[clihost] WebSocket error: {exc}", file=sys.stderr)
            if not config.reconnect:
                break
            await asyncio.sleep(backoff)
            backoff = min(backoff * 2, 30)
        else:
            if not config.reconnect:
                break


async def main_async() -> int:
    config, child_cmd = parse_args()

    proc = await spawn_child(child_cmd)

    tasks = [
        asyncio.create_task(pump_stream(proc.stdout, sys.stdout)),
        asyncio.create_task(pump_stream(proc.stderr, sys.stderr)),
        asyncio.create_task(websocket_consumer(proc, config)),
    ]

    stdin_q: "queue.Queue[Optional[str]]" = queue.Queue()
    if config.forward_stdin:
        thread = threading.Thread(target=stdin_collector, args=(stdin_q,), daemon=True)
        thread.start()
        tasks.append(asyncio.create_task(forward_stdin(proc, stdin_q, config.encoding)))

    stop_event = asyncio.Event()

    def request_stop(signum, _frame) -> None:
        if proc.returncode is None:
            try:
                proc.terminate()
            except ProcessLookupError:
                pass
        stop_event.set()

    for sig in (signal.SIGINT, signal.SIGTERM):
        try:
            signal.signal(sig, request_stop)
        except Exception:
            pass

    await asyncio.wait(
        [asyncio.create_task(proc.wait()), asyncio.create_task(stop_event.wait())],
        return_when=asyncio.FIRST_COMPLETED,
    )

    for task in tasks:
        task.cancel()
    for task in tasks:
        try:
            await task
        except asyncio.CancelledError:
            pass

    if proc.returncode is None:
        proc.kill()

    return proc.returncode or 0


def main() -> int:
    try:
        return asyncio.run(main_async())
    except KeyboardInterrupt:
        return 0


if __name__ == "__main__":
    sys.exit(main())
