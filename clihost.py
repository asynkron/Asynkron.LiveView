#!/usr/bin/env python3
"""Host a CLI TUI (Copilot or Codex) and inject keystrokes from a WebSocket feed.

macOS focused:
- Child inherits your terminal. No stdio capture or PTY wrappers.
- We simulate keypresses by pushing bytes into the terminal input buffer (TIOCSTI).
- Defaults tuned for Copilot/Codex: wake with CR, delay 60 ms, submit with CR, no bracketed paste.
- On connect we pre-seed the agent with a system-style prompt so it knows how to handle "lv:" messages.
- Every inbound WebSocket "chat" message is prefixed with "lv:" before injection.
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


DEFAULT_PREPROMPT = """Whenever you receive a prompt starting with "lv:" you know this is a message from the live-viiew mcp.
you should immediately issue a NEW show content request with "🧠 Thinking...."
then you process the prompt and act on that.
once you have a real response, you send that back to the same file id as you got from the new show content. so you just update the "thinking" to the new content.

also make sure to pass other outputs to live view when possible, as the web user cannot see the terminal that you normally write in.
"""


def _decode_escapes(token: str) -> str:
    """Interpret escape sequences like '\\r', '\\n', '\\x1b[A'."""
    return token.encode("utf-8").decode("unicode_escape")


def parse_args(argv: List[str]) -> tuple[argparse.Namespace, List[str]]:
    if "--" not in argv:
        parser = argparse.ArgumentParser(description="Host a CLI TUI and inject keystrokes")
        parser.print_usage(sys.stderr)
        raise SystemExit(
            "Missing '--' separator. Example: clihost.py --url ws://localhost:8080/agent-feed -- copilot"
        )

    idx = argv.index("--")
    host_args = argv[1:idx]
    child_cmd = argv[idx + 1 :]

    parser = argparse.ArgumentParser(description="Host a CLI TUI and forward chat events")

    parser.add_argument("--url", default="ws://localhost:8080/agent-feed", help="WebSocket feed")
    parser.add_argument("--encoding", default="utf-8", help="Text encoding for chat messages")

    parser.add_argument("--echo-injections", action="store_true", help="Print injected text")
    parser.add_argument("--injection-prefix", default="[server] ", help="Prefix when echoing injected lines")

    parser.add_argument(
        "--append-text-suffix",
        default="",
        help="Optional text appended after the injected message, escapes supported (e.g. '\\n')",
    )

    # Defaults set for your working setup
    parser.add_argument(
        "--submit-seq",
        default="\\r",
        help='Key sequence to submit after inject. Default "\\r". Examples: "\\r", "\\n"',
    )
    parser.add_argument(
        "--submit-delay-ms",
        type=int,
        default=60,
        help="Delay between injecting text and sending submit sequence, default 60",
    )
    parser.add_argument(
        "--send-on-connect",
        default="\\r",
        help='Keys to inject immediately after WebSocket connect, default "\\r"',
    )
    parser.add_argument(
        "--bracketed-paste",
        action=argparse.BooleanOptionalAction,
        default=False,
        help="Wrap injected text in bracketed paste markers \\x1b[200~ ... \\x1b[201~ (off by default)",
    )

    # Preprompt that seeds the agent about handling lv: messages
    parser.add_argument(
        "--preprompt",
        default=DEFAULT_PREPROMPT,
        help="Instruction sent to the agent on connect before any messages. Set empty to disable.",
    )

    parser.add_argument("--no-reconnect", action="store_true", help="Disable reconnect loop")
    parser.add_argument(
        "--exit-on-error",
        dest="exit_on_error",
        action="store_true",
        help="Terminate child if WebSocket fails",
    )
    parser.add_argument(
        "--no-exit-on-error",
        dest="exit_on_error",
        action="store_false",
        help="Keep retrying WebSocket even if child is running",
    )
    parser.set_defaults(exit_on_error=True)

    parser.add_argument("--verbose", action=argparse.BooleanOptionalAction, default=True, help="Verbose logs")

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
    _tty_fd = os.open("/dev/tty", os.O_RDWR | os.O_CLOEXEC)
    return _tty_fd


async def inject_bytes_to_tty(data: bytes) -> None:
    """Simulate keystrokes by pushing bytes into the TTY input queue via TIOCSTI."""
    fd = _open_tty_fd()
    for b in data:
        fcntl.ioctl(fd, termios.TIOCSTI, bytes([b]))  # one byte per ioctl


async def inject_text_with_options(
    text: str,
    *,
    encoding: str,
    suffix: str,
    bracketed_paste: bool,
) -> None:
    """Inject text, optionally with bracketed paste, plus a suffix (not Enter)."""
    payload = text + (suffix or "")
    if bracketed_paste:
        wrapped = "\x1b[200~" + payload + "\x1b[201~"
        await inject_bytes_to_tty(wrapped.encode(encoding, errors="replace"))
    else:
        await inject_bytes_to_tty(payload.encode(encoding, errors="replace"))


async def send_submit_sequence(seq: str, *, encoding: str) -> None:
    """Send the submit sequence."""
    await inject_bytes_to_tty(_decode_escapes(seq).encode(encoding, errors="replace"))


# ------------- child process management -------------
async def create_child(child_cmd: List[str]) -> asyncio.subprocess.Process:
    """Spawn the TUI child so it inherits the current terminal."""
    print(f"[clihost] launching child command: {' '.join(child_cmd)}")
    sys.stdout.flush()
    return await asyncio.create_subprocess_exec(
        *child_cmd,
        stdin=None,
        stdout=None,
        stderr=None,
        start_new_session=False,  # stay in same session and foreground group
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
    text_suffix: str,
    submit_seq: str,
    submit_delay_ms: int,
    send_on_connect: str,
    preprompt: str,
    echo: bool,
    prefix: str,
    reconnect: bool,
    exit_on_error: bool,
    verbose: bool,
    bracketed_paste: bool,
) -> None:
    backoff = 1
    decoded_suffix = _decode_escapes(text_suffix) if text_suffix else ""
    decoded_wake = _decode_escapes(send_on_connect) if send_on_connect else ""
    preprompt_text = preprompt or ""

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

                # Optional wake keys on connect, default is CR
                if decoded_wake:
                    await inject_bytes_to_tty(decoded_wake.encode(encoding, errors="replace"))
                    if verbose:
                        print(f"[clihost] injected connect keys: {decoded_wake!r}")
                        sys.stdout.flush()

                # Inject preprompt before processing any incoming messages
                if preprompt_text.strip():
                    if echo:
                        print(f"{prefix}[preprompt]\n{preprompt_text}")
                        sys.stdout.flush()
                    await inject_text_with_options(
                        preprompt_text,
                        encoding=encoding,
                        suffix=decoded_suffix,
                        bracketed_paste=bracketed_paste,
                    )
                    await asyncio.sleep(max(0, submit_delay_ms) / 1000.0)
                    await send_submit_sequence(submit_seq, encoding=encoding)
                    if verbose:
                        print("[clihost] injected preprompt and submit")
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
                        base_text = msg.get("text", "")
                        # Prefix with lv: so the agent recognizes LiveView messages
                        text = f"lv:{base_text}"
                        if echo:
                            print(f"{prefix}{text}")
                            sys.stdout.flush()

                        # 1) inject text block (optional suffix)
                        await inject_text_with_options(
                            text,
                            encoding=encoding,
                            suffix=decoded_suffix,
                            bracketed_paste=bracketed_paste,
                        )

                        # 2) delay so the TUI applies the paste to the editor first
                        await asyncio.sleep(max(0, submit_delay_ms) / 1000.0)

                        # 3) send submit sequence (default CR)
                        await send_submit_sequence(submit_seq, encoding=encoding)

                        if verbose:
                            print("[clihost] injected chat and submit sequence")
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

    # Fail fast if no controlling terminal
    try:
        _open_tty_fd()
    except OSError:
        raise SystemExit("tty injection needs a real terminal. Run this from Terminal or iTerm.")

    print("[clihost] awaiting child process creation...")
    sys.stdout.flush()

    proc = await create_child(child_cmd)
    print(f"[clihost] started child PID {proc.pid}: {' '.join(child_cmd)}")
    sys.stdout.flush()

    ws_task = asyncio.create_task(
        ws_consumer(
            args.url,
            proc,
            encoding=args.encoding,
            text_suffix=args.append_text_suffix,
            submit_seq=args.submit_seq,
            submit_delay_ms=args.submit_delay_ms,
            send_on_connect=args.send_on_connect,
            preprompt=args.preprompt,
            echo=args.echo_injections,
            prefix=args.injection_prefix,
            reconnect=not args.no_reconnect,
            exit_on_error=args.exit_on_error,
            verbose=args.verbose,
            bracketed_paste=args.bracketed_paste,
        )
    )

    stop_event = asyncio.Event()

    def _handle_signal(signum: int, _frame) -> None:
        stop_event.set()

    for sig in (signal.SIGINT, signal.SIGTERM):
        try:
            signal.signal(sig, _handle_signal)
        except Exception:
            pass

    done, _pending = await asyncio.wait(
        {asyncio.create_task(proc.wait()), asyncio.create_task(stop_event.wait())},
        return_when=asyncio.FIRST_COMPLETED,
    )
    for fut in done:
        fut.result()

    ws_task.cancel()
    try:
        await ws_task
    except asyncio.CancelledError:
        pass

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
