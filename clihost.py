#!/usr/bin/env python3
"""Host a CLI agent and bridge chat events from the LiveView server."""

import argparse
import asyncio
import base64
import json
import os
import queue
import signal
import sys
import threading
from typing import List, Optional

import websockets


def _decode_newline(token: str) -> str:
    """Interpret escape sequences like ``\n`` from command line arguments."""

    return token.encode("utf-8").decode("unicode_escape")


def parse_args(argv: List[str]) -> tuple[argparse.Namespace, List[str]]:
    """Split host arguments from the child command definition."""

    if "--" not in argv:
        parser = argparse.ArgumentParser(description="Host a CLI agent")
        parser.print_usage(sys.stderr)
        raise SystemExit(
            "Missing '--' separator. Example: clihost.py --url ws://localhost:8080/agent-feed -- python agent.py"
        )

    idx = argv.index("--")
    host_args = argv[1:idx]
    child_cmd = argv[idx + 1 :]

    parser = argparse.ArgumentParser(description="Host a CLI agent and forward chat events")
    parser.add_argument("--url", default="ws://localhost:8080/agent-feed", help="WebSocket feed exposed by the server")
    parser.add_argument("--encoding", default="utf-8", help="Encoding for stdin/stdout interactions")
    parser.add_argument(
        "--echo-injections",
        action="store_true",
        help="Print messages that are injected into the child process",
    )
    parser.add_argument(
        "--injection-prefix",
        default="[server] ",
        help="Prefix used when echoing injected lines to stdout",
    )
    parser.add_argument(
        "--newline",
        default="\\n",
        help="Newline appended to injected chat messages (escape sequences supported)",
    )
    parser.add_argument(
        "--no-reconnect",
        action="store_true",
        help="Disable the automatic WebSocket reconnect loop",
    )
    parser.add_argument(
        "--no-user-stdin",
        action="store_true",
        help="Prevent forwarding keyboard input to the child process",
    )
    parser.add_argument(
        "--exit-on-error",
        dest="exit_on_error",
        action="store_true",
        help="Terminate the child process if the WebSocket feed cannot be reached or disconnects",
    )
    parser.add_argument(
        "--no-exit-on-error",
        dest="exit_on_error",
        action="store_false",
        help="Keep retrying the WebSocket even if the child stays running",
    )
    parser.set_defaults(exit_on_error=True)
    parser.add_argument(
        "--force-pty",
        action="store_true",
        help="Wrap the child command in a pseudo-terminal (via `script`) to preserve interactive behavior",
    )
    parser.add_argument(
        "--verbose",
        action=argparse.BooleanOptionalAction,
        default=True,
        help="Enable additional logging for debugging (use --no-verbose to disable)",
    )
    parser.add_argument(
        "--echo-chat",
        action=argparse.BooleanOptionalAction,
        default=True,
        help="Always print chat messages received from the server (use --no-echo-chat to suppress)",
    )

    args = parser.parse_args(host_args)
    if not child_cmd:
        raise SystemExit("Missing child command after '--'")
    return args, child_cmd


async def create_child(child_cmd: List[str]) -> asyncio.subprocess.Process:
    """Spawn the agent process whose stdin/stdout we proxy."""

    print(f"[clihost] launching child command: {' '.join(child_cmd)}")
    sys.stdout.flush()
    return await asyncio.create_subprocess_exec(
        *child_cmd,
        stdin=asyncio.subprocess.PIPE,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )


async def pump_stream(
    reader: asyncio.StreamReader,
    dest,
    *,
    timeout: Optional[float] = None,
    proc: Optional[asyncio.subprocess.Process] = None,
) -> None:
    """Continuously copy the child's output into the terminal.

    A timeout keeps the read loop from hanging indefinitely when the child is idle.
    """

    while True:
        try:
            if timeout is not None:
                chunk = await asyncio.wait_for(reader.read(4096), timeout=timeout)
            else:
                chunk = await reader.read(4096)
        except asyncio.TimeoutError:
            if proc is not None and proc.returncode is not None:
                break
            continue
        if not chunk:
            break
        if hasattr(dest, "buffer"):
            dest.buffer.write(chunk)
        else:
            dest.write(chunk.decode(errors="replace"))
        try:
            dest.flush()
        except Exception:
            pass


def stdin_thread(stdin_q: "queue.Queue[Optional[str]]") -> None:
    """Read local keyboard input in a blocking thread."""

    try:
        for line in sys.stdin:
            stdin_q.put(line)
    finally:
        stdin_q.put(None)


async def forward_user_stdin(
    stdin_q: "queue.Queue[Optional[str]]",
    proc: asyncio.subprocess.Process,
    encoding: str,
) -> None:
    """Forward terminal input captured by the helper thread to the child."""

    loop = asyncio.get_running_loop()
    while True:
        line = await loop.run_in_executor(None, stdin_q.get)
        if line is None or proc.stdin is None:
            break
        try:
            proc.stdin.write(line.encode(encoding, errors="replace"))
            await proc.stdin.drain()
        except Exception:
            break


async def inject_line_to_child(
    proc: asyncio.subprocess.Process,
    text: str,
    *,
    encoding: str,
    newline: str,
) -> None:
    """Inject a line of text into the child's stdin."""

    if proc.stdin is None:
        return
    payload = f"{text}{newline}".encode(encoding, errors="replace")
    proc.stdin.write(payload)
    try:
        await proc.stdin.drain()
    except Exception:
        pass


async def _terminate_child(proc: asyncio.subprocess.Process, *, timeout: float = 5.0) -> None:
    """Gracefully terminate the child process, escalating if needed."""

    if proc.returncode is not None:
        print(f"[clihost] child already exited with code {proc.returncode}")
        sys.stdout.flush()
        return

    try:
        print(f"[clihost] terminating child PID {proc.pid}")
        sys.stdout.flush()
        proc.send_signal(signal.SIGTERM)
    except ProcessLookupError:
        return
    except Exception:
        proc.terminate()
    try:
        await asyncio.wait_for(proc.wait(), timeout=timeout)
        print(f"[clihost] child exited with code {proc.returncode}")
        sys.stdout.flush()
    except asyncio.TimeoutError:
        proc.kill()
        await proc.wait()
        print(f"[clihost] child killed after timeout (code {proc.returncode})")
        sys.stdout.flush()


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
    force_echo_chat: bool,
) -> None:
    """Stream chat messages from the server and feed them to the child process."""

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
                        if echo or force_echo_chat:
                            print(f"{prefix}{text}")
                            sys.stdout.flush()
                        await inject_line_to_child(
                            proc,
                            text,
                            encoding=encoding,
                            newline=decoded_newline,
                        )
                        if verbose:
                            print(f"[clihost] injected chat into child PID {proc.pid}: {text!r}")
                            sys.stdout.flush()
                    elif mtype == "control" and msg.get("cmd") == "quit":
                        if proc.returncode is None:
                            proc.terminate()
                    elif mtype == "raw":
                        payload = msg.get("bytes_b64", "")
                        if proc.stdin is not None and payload:
                            data = base64.b64decode(payload)
                            proc.stdin.write(data)
                            try:
                                await proc.stdin.drain()
                            except Exception:
                                pass
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


async def main() -> None:
    args, child_cmd = parse_args(sys.argv)

    print("[clihost] awaiting child process creation...")
    sys.stdout.flush()
    child_cmd_to_run = child_cmd
    if args.force_pty:
        child_cmd_to_run = [
            "script",
            "-q",
            "/dev/null",
            "--",
            *child_cmd,
        ]
        print(f"[clihost] wrapping child with pseudo-terminal: {' '.join(child_cmd_to_run)}")
        sys.stdout.flush()
    proc = await create_child(child_cmd_to_run)
    print(f"[clihost] started child PID {proc.pid}: {' '.join(child_cmd_to_run)}")
    sys.stdout.flush()

    tasks = [
        asyncio.create_task(pump_stream(proc.stdout, sys.stdout, timeout=10.0, proc=proc)),
        asyncio.create_task(pump_stream(proc.stderr, sys.stderr, timeout=10.0, proc=proc)),
    ]
    if args.verbose:
        print("[clihost] stdout/stderr pump tasks started")
        sys.stdout.flush()

    stdin_q: "queue.Queue[Optional[str]]" = queue.Queue()
    if not args.no_user_stdin:
        threading.Thread(target=stdin_thread, args=(stdin_q,), daemon=True).start()
        tasks.append(asyncio.create_task(forward_user_stdin(stdin_q, proc, args.encoding)))

    tasks.append(
        asyncio.create_task(
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
                force_echo_chat=args.echo_chat,
            )
        )
    )
    if args.verbose:
        print("[clihost] websocket consumer task started")
        sys.stdout.flush()

    stop_event = asyncio.Event()

    def _handle_signal(signum: int, _frame) -> None:
        if proc.returncode is None:
            try:
                print(f"[clihost] forwarding signal {signum} to child {proc.pid}")
                proc.send_signal(signum)
            except ProcessLookupError:
                print("[clihost] child already exited before signal forwarding")
            except Exception as exc:
                print(f"[clihost] failed to forward signal ({exc}); falling back to terminate()")
                proc.terminate()
        stop_event.set()

    for sig in (signal.SIGINT, signal.SIGTERM):
        try:
            signal.signal(sig, _handle_signal)
        except Exception:
            pass

    done, pending = await asyncio.wait(
        {asyncio.create_task(proc.wait()), asyncio.create_task(stop_event.wait())},
        return_when=asyncio.FIRST_COMPLETED,
    )
    for future in done:
        future.result()

    for task in tasks:
        task.cancel()
    for task in tasks:
        try:
            await task
        except asyncio.CancelledError:
            pass

    if proc.returncode is None:
        print("[clihost] child still running during shutdown; terminating")
        await _terminate_child(proc)


if __name__ == "__main__":
    asyncio.run(main())
