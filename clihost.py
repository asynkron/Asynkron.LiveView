#!/usr/bin/env python3
"""Host a CLI TUI (Copilot or Codex) and inject keystrokes from a WebSocket feed.

This version is tailored for macOS TUIs that need a real terminal.
It does NOT capture or proxy stdio. The child inherits your terminal.
We only simulate keypresses by pushing bytes into the terminal input buffer.
"""

import argparse
import asyncio
import base64
import json
import os
import signal
import sys
from typing import List, Optional

import websockets

# Unix only, required for TTY injection
import fcntl
import termios


def _decode_newline(token: str) -> str:
    """Interpret escape sequences like '\\r' or '\\n' from command line arguments."""
    return token.encode("utf-8").decode("unicode_escape")


def parse_args(argv: List[str]) -> tuple[argparse.Namespace, List[str]]:
    """Split host args from the child command definition."""
    if "--" not in argv:
        parser = argparse.ArgumentParser(description="Host a CLI TUI and inject keystrokes")
        parser.print_usage(sys.stderr)
        raise SystemExit(
            "Missing '--' separator. Example: clihost.py --url ws://localhost:8080/agent-feed -- copilot-cli chat"
        )

    idx = argv.index("--")
    host_args = argv[1:idx]
    child_cmd = argv[idx + 1 :]

    parser = argparse.ArgumentParser(description="Host a CLI TUI and forward chat events")
    parser.add_argument("--url", default="ws://localhost:8080/agent-feed", help="WebSocket feed exposed by the server")
    parser.add_argument("--encoding", default="utf-8", help="Text encoding for chat messages")
    parser.add_argument(
        "--echo-injections",
        action="store_true",
        help="Print text messages that are injected (for debugging)",
    )
    parser.add_argument(
        "--injection-prefix",
        default="[server] ",
        help="Prefix used when echoing injected lines",
    )
    parser.add_argument(
        "--newline",
        default="",
        help="Newline appended to injected chat messages, escape sequences supported (eg '\\r' for Enter)",
    )
    parser.add_argument(
        "--no-reconnect",
        action="store_true",
        help="Disable the automatic WebSocket reconnect loop",
    )
    parser.add_argument(
        "--exit-on-error",
        dest="exit_on_error",
        action="store_true",
        help="Terminate the child if the WebSocket cannot be reached or disconnects",
    )
    parser.add_argument(
        "--no-exit-on-error",
        dest="exit_on_error",
        action="store_false",
        help="Keep retrying the WebSocket even if the child stays running",
    )
    parser.set_defaults(exit_on_error=True)
    parser.add_argument(
        "--verbose",
        action=argparse.BooleanOptionalAction,
        default=True,
        help="Enable extra logging (use --no-verbose to reduce)",
    )

    args = parser.parse_args(host_args)
    if not child_cmd:
        raise SystemExit("Missing child command after '--'")
    return args, child_cmd


# ------------- tty injection (macOS, Unix) -------------
_tty_fd: Optional[int] = None


def _open_tty_fd() -> int:
    """Open the controlling terminal for this process."""
    global _tty_fd
    if _tty_fd is not None:
        return _tty_fd
    # This must be run from a real terminal session
    _tty_fd = os.open("/dev/tty", os.O_RDWR | os.O_CLOEXEC)
    return _tty_fd


async def inject_bytes_to_tty(data: bytes) -> None:
    """Simulate keystrokes by pushing bytes into the TTY input queue via TIOCSTI."""
    fd = _open_tty_fd()
    for b in data:
        fcntl.ioctl(fd, termios.TIOCSTI, bytes([b]))  # kernel consumes one byte per ioctl


async def inject_line_via_tty(text: str, *, encoding: str, newline: str) -> None:
    payload = f"{text}{newline}".encode(encoding, errors="replace")
    await inject_bytes_to_tty(payload)


# ------------- child process management -------------
async def create_child(child_cmd: List[str]) -> asyncio.subprocess.Process:
    """Spawn the TUI child so it inherits the current terminal."""
    print(f"[clihost] launching child command: {' '.join(child_cmd)}")
    sys.stdout.flush()
    # Important: inherit the controlling TTY and stay in the same session and foreground group
    return await asyncio.create_subprocess_exec(
        *child_cmd,
        stdin=None,
        stdout=None,
        stderr=None,
        start_new_session=False,
    )


async def _terminate_child(proc: asyncio.subprocess.Process, *, timeout: float = 5.0) -> None:
    """Ask the child to exit, then escalate if needed."""
    if proc.returncode is not None:
        print(f"[clihost] child already exited with code {proc.returncode}")
        sys.stdout.flush()
        return
    try:
        print(f"[clihost] terminating child PID {proc.pid}")
        sys.stdout.flush()
        proc.terminate()
        await asyncio.wait_for(proc.wait(), timeout=timeout)
        print(f"[clihost] child exited with code {proc.returncode}")
        sys.stdout.flush()
    except asyncio.TimeoutError:
        proc.kill()
        await proc.wait()
        print(f"[clihost] child killed after timeout (code {proc.returncode})")
        sys.stdout.flush()


# ------------- websocket consumer -------------
async def ws_consumer(
    url: str,
    proc: asyncio.subprocess.Process,
    *,
    encoding: str,
    newline: str,
    echo: bool,
    prefix: str,
    reconnect: bool,
    exit_on_error: bool,
    verbose: bool,
) -> None:
    """Stream events and inject into the TTY as keystrokes."""
    backoff = 1
    decoded_newline = _decode_newline(newline)

    while True:
        if proc.returncode is not None:
            return
        try:
            async with websockets.connect(
                url,
                ping_interval=20,
                ping_timeout=20,
                max_size=None,
            ) as ws:
                backoff = 1
                hello = json.dumps({"type": "hello", "pid": os.getpid()})
                await ws.send(hello)
                if verbose:
                    print(f"[clihost] websocket connected to {url}")
                    sys.stdout.flush()

                async for raw in ws:
                    if proc.returncode is not None:
                        break
                    try:
                        msg = json.loads(raw)
                    except json.JSONDecodeError:
                        msg = {"type": "chat", "text": str(raw)}

                    mtype = msg.get("type")
                    if mtype == "chat":
                        text = msg.get("text", "")
                        if echo:
                            print(f"{prefix}{text}")
                            sys.stdout.flush()
                        await inject_line_via_tty(
                            text,
                            encoding=encoding,
                            newline=decoded_newline,
                        )
                        if verbose:
                            print(f"[clihost] injected chat into TTY: {text!r}")
                            sys.stdout.flush()
                    elif mtype == "raw":
                        payload = msg.get("bytes_b64", "")
                        if payload:
                            data = base64.b64decode(payload)
                            await inject_bytes_to_tty(data)
                            if verbose:
                                print(f"[clihost] injected {len(data)} raw bytes into TTY")
                                sys.stdout.flush()
                    elif mtype == "control" and msg.get("cmd") == "quit":
                        if proc.returncode is None:
                            proc.terminate()
                if proc.returncode is not None:
                    return
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            print(f"[clihost] websocket error: {exc}", file=sys.stderr)
            if exit_on_error:
                await _terminate_child(proc)
                return
            if not reconnect:
                return
            await asyncio.sleep(backoff)
            backoff = min(backoff * 2, 30)
        else:
            if exit_on_error:
                await _terminate_child(proc)
                return
            if not reconnect:
                return


# ------------- main -------------
async def main() -> int:
    args, child_cmd = parse_args(sys.argv)

    # Hard fail early if no controlling terminal is available
    try:
        _open_tty_fd()
    except OSError:
        raise SystemExit("tty injection needs a real terminal. Run this from Terminal or iTerm.")

    print("[clihost] awaiting child process creation...")
    sys.stdout.flush()

    # Do NOT wrap with script or any PTY tool. The child must share our TTY.
    proc = await create_child(child_cmd)
    print(f"[clihost] started child PID {proc.pid}: {' '.join(child_cmd)}")
    sys.stdout.flush()

    # Start websocket consumer
    ws_task = asyncio.create_task(
        ws_consumer(
            args.url,
            proc,
            encoding=args.encoding,
            newline=args.newline,
            echo=args.echo_injections,
            prefix=args.injection_prefix,
            reconnect=not args.no_reconnect,
            exit_on_error=args.exit_on_error,
            verbose=args.verbose,
        )
    )

    # Handle Ctrl+C and SIGTERM by stopping our loop. The TTY will also deliver the signal to the child.
    stop_event = asyncio.Event()

    def _handle_signal(signum: int, _frame) -> None:
        stop_event.set()

    for sig in (signal.SIGINT, signal.SIGTERM):
        try:
            signal.signal(sig, _handle_signal)
        except Exception:
            pass

    # Wait for either the child to exit or a stop signal
    done, _pending = await asyncio.wait(
        {asyncio.create_task(proc.wait()), asyncio.create_task(stop_event.wait())},
        return_when=asyncio.FIRST_COMPLETED,
    )
    for fut in done:
        fut.result()

    # Cancel websocket consumer
    ws_task.cancel()
    try:
        await ws_task
    except asyncio.CancelledError:
        pass

    # Ensure child is gone if we are stopping first
    if proc.returncode is None:
        print("[clihost] child still running during shutdown, terminating")
        await _terminate_child(proc)

    return int(proc.returncode or 0)


if __name__ == "__main__":
    try:
        code = asyncio.run(main())
    except KeyboardInterrupt:
        code = 130
    sys.exit(code)
