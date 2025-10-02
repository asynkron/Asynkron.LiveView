#!/usr/bin/env python3
"""
clihost for Copilot/Codex TUIs on macOS, no flags.

- Child runs on a PTY so we can mirror and scan output.
- Wait for: "Enter @ to mention files or / for commands".
- Then wait quiet 800 ms, then wait 3 s, then inject preprompt, then press Enter after 60 ms.
- Every inbound WS message is prefixed with "lv:", injected, then submitted with Enter.
- Local keyboard is proxied to the child PTY, with stdin set to cbreak + no echo.

Launch:
  python clihost.py -- copilot
  or
  python clihost.py copilot
"""

import asyncio
import base64
import json
import os
import re
import signal
import struct
import sys
import time
from typing import Optional, Tuple, List, Callable

import websockets

# Unix PTY
import fcntl
import termios
import pty

# ---------------- defaults ----------------
CLIHOST_URL = os.environ.get("CLIHOST_URL", "ws://localhost:8080/agent-feed")
ENCODING = "utf-8"

READY_REGEX = re.compile(r"(?i)\s*enter\s*@\s*to\s*mention\s*files\s*or\s*/\s*for\s*commands\s*")
READY_TIMEOUT_MS = 30000

QUIET_AFTER_READY_MS = 800
QUIET_WAIT_TIMEOUT_MS = 15000

WAKE_KEYS = "\r"
PREPROMPT_DELAY_MS = 3000
SUBMIT_DELAY_MS = 60
SUBMIT_SEQ = "\r"

DEFAULT_PREPROMPT = """Once you have processed this message, immediately send a message to live-view and say hello.

Whenever you receive a prompt starting with "lv:" you know this is a message from the live-viiew mcp.
you should immediately issue a NEW show content request with "🧠 Thinking...."
then you process the prompt and act on that.
once you have a real response, you send that back to the same file id as you got from the new show content. so you just update the "thinking" to the new content.
also make sure to pass other outputs to live view when possible, as the web user cannot see the terminal that you normally write in.
This is is not an instruction on how to solve any task, it´s just an instruction on how to interact with the live-view MCP.

Do not start working now...
"""

VERBOSE = True
EXIT_ON_ERROR = True
RECONNECT = True
ECHO_INJECTIONS = False
ECHO_PREFIX = "[server] "

LOCAL_KEYBOARD_FORWARD = True  # forward your keystrokes to the child PTY

# ---------------- utils ----------------
def _decode_escapes(s: str) -> str:
    return s.encode("utf-8").decode("unicode_escape")

def _get_term_size() -> Tuple[int, int]:
    try:
        cols, rows = os.get_terminal_size(sys.stdout.fileno())
    except OSError:
        cols, rows = 80, 24
    return rows, cols

def _set_winsize(fd: int, rows: int, cols: int) -> None:
    fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack("HHHH", rows, cols, 0, 0))

def _strip_ansi(txt: str) -> str:
    txt = re.sub(r"\x1b\][^\a]*(?:\a|\x1b\\)", "", txt)      # OSC
    txt = re.sub(r"\x1b\[[0-?]*[ -/]*[@-~]", "", txt)        # CSI
    txt = re.sub(r"\x1b[@-Z\\-_]", "", txt)                  # ESC
    return txt

# put stdin into cbreak + no echo, keep ISIG so Ctrl+C still stops the host
def _enter_cbreak_noecho(fd: int) -> Callable[[], None]:
    orig = termios.tcgetattr(fd)
    new = termios.tcgetattr(fd)
    new_lflag = new[3]
    new_lflag &= ~termios.ECHO     # no echo
    new_lflag &= ~termios.ICANON   # character mode, not line mode
    # keep ISIG on so ^C still sends SIGINT to the host
    new[3] = new_lflag
    new_cc = new[6]
    new_cc[termios.VMIN] = 1
    new_cc[termios.VTIME] = 0
    termios.tcsetattr(fd, termios.TCSADRAIN, new)
    def restore():
        try:
            termios.tcsetattr(fd, termios.TCSADRAIN, orig)
        except Exception:
            pass
    return restore

# ---------------- PTY session ----------------
class PTYSession:
    def __init__(self, child_cmd: List[str]) -> None:
        self.child_cmd = child_cmd
        self.master_fd: Optional[int] = None
        self.slave_fd: Optional[int] = None
        self.proc: Optional[asyncio.subprocess.Process] = None

        self._scanner_buf = ""
        self._scanner_limit = 16384

        self._ready_event = asyncio.Event()
        self._last_activity = time.monotonic()

    async def spawn(self) -> asyncio.subprocess.Process:
        rows, cols = _get_term_size()
        m, s = pty.openpty()
        _set_winsize(s, rows, cols)
        proc = await asyncio.create_subprocess_exec(
            *self.child_cmd,
            stdin=s,
            stdout=s,
            stderr=s,
            start_new_session=True,
        )
        fcntl.fcntl(m, fcntl.F_SETFL, os.O_NONBLOCK)
        self.master_fd, self.slave_fd, self.proc = m, s, proc
        self._last_activity = time.monotonic()
        return proc

    async def start_reader(self) -> None:
        assert self.master_fd is not None
        fd = self.master_fd
        loop = asyncio.get_running_loop()

        def _readable() -> None:
            try:
                data = os.read(fd, 4096)
            except BlockingIOError:
                return
            except OSError:
                loop.remove_reader(fd)
                return
            if not data:
                loop.remove_reader(fd)
                return

            # mirror raw bytes
            try:
                sys.stdout.buffer.write(data)
                sys.stdout.flush()
            except Exception:
                pass

            self._last_activity = time.monotonic()

            # scan stripped text for ready
            try:
                txt = data.decode(ENCODING, errors="replace")
            except Exception:
                txt = ""
            self._scanner_buf += _strip_ansi(txt)
            if len(self._scanner_buf) > self._scanner_limit:
                self._scanner_buf = self._scanner_buf[-self._scanner_limit:]

            if not self._ready_event.is_set() and READY_REGEX.search(self._scanner_buf):
                self._ready_event.set()
                if VERBOSE:
                    print("\n[clihost] ready pattern matched", file=sys.stderr)

        loop.add_reader(fd, _readable)

        # keep PTY size updated
        def _on_winch(signum, _frame):
            try:
                r, c = _get_term_size()
                if self.slave_fd is not None:
                    _set_winsize(self.slave_fd, r, c)
            except Exception:
                pass
        try:
            signal.signal(signal.SIGWINCH, _on_winch)
        except Exception:
            pass

        async def _ready_timeout():
            await asyncio.sleep(READY_TIMEOUT_MS / 1000.0)
            if not self._ready_event.is_set():
                if VERBOSE:
                    print("\n[clihost] ready timeout expired", file=sys.stderr)
                self._ready_event.set()
        asyncio.create_task(_ready_timeout())

    async def wait_ready(self) -> None:
        if VERBOSE:
            print("[clihost] waiting for ready pattern...", file=sys.stderr)
        await self._ready_event.wait()

    async def wait_quiet(self, quiet_ms: int, timeout_ms: int) -> None:
        if VERBOSE:
            print(f"[clihost] waiting for quiet {quiet_ms} ms...", file=sys.stderr)
        deadline = time.monotonic() + (timeout_ms / 1000.0)
        q = quiet_ms / 1000.0
        while True:
            now = time.monotonic()
            if now - self._last_activity >= q:
                if VERBOSE:
                    print(f"[clihost] quiet for {quiet_ms} ms", file=sys.stderr)
                return
            if now >= deadline:
                if VERBOSE:
                    print("[clihost] quiet wait timed out, proceeding", file=sys.stderr)
                return
            await asyncio.sleep(0.05)

    async def write_bytes(self, data: bytes) -> None:
        assert self.master_fd is not None
        total = 0
        while total < len(data):
            try:
                n = os.write(self.master_fd, data[total: total + 4096])
                if n <= 0:
                    await asyncio.sleep(0.005)
                total += n
            except BlockingIOError:
                await asyncio.sleep(0.005)

    async def write_text(self, text: str) -> None:
        await self.write_bytes(text.encode(ENCODING, errors="replace"))

# ---------------- prompt executor ----------------
async def try_execute_prompt(pty_session: PTYSession, text: str, *, pre_delay_ms: int = 0) -> None:
    if pre_delay_ms > 0:
        await asyncio.sleep(pre_delay_ms / 1000.0)
    await pty_session.write_text(text)
    await asyncio.sleep(SUBMIT_DELAY_MS / 1000.0)
    await pty_session.write_text(_decode_escapes(SUBMIT_SEQ))

# ---------------- local keyboard proxy ----------------
class KeyboardProxy:
    def __init__(self, pty_session: PTYSession) -> None:
        self.pty_session = pty_session
        self._restore: Optional[Callable[[], None]] = None
        self._reader_added = False

    def start(self) -> None:
        if not LOCAL_KEYBOARD_FORWARD:
            return
        fd = sys.stdin.fileno()
        os.set_blocking(fd, False)
        self._restore = _enter_cbreak_noecho(fd)
        loop = asyncio.get_running_loop()
        loop.add_reader(fd, self._on_stdin_ready, fd)
        self._reader_added = True
        if VERBOSE:
            print("[clihost] local keyboard forwarding enabled", file=sys.stderr)

    def stop(self) -> None:
        try:
            fd = sys.stdin.fileno()
            if self._reader_added:
                asyncio.get_running_loop().remove_reader(fd)
        except Exception:
            pass
        if self._restore:
            try:
                self._restore()
            finally:
                self._restore = None

    def _on_stdin_ready(self, fd: int) -> None:
        # read whatever is available and forward to PTY
        try:
            data = os.read(fd, 4096)
        except BlockingIOError:
            return
        except OSError:
            return
        if not data:
            return
        # schedule the write on the event loop
        asyncio.create_task(self.pty_session.write_bytes(data))

# ---------------- websocket consumer ----------------
async def ws_consumer(url: str, pty_session: PTYSession, proc: asyncio.subprocess.Process) -> None:
    backoff = 1
    while True:
        if proc.returncode is not None:
            return
        try:
            async with websockets.connect(url, ping_interval=20, ping_timeout=20, max_size=None) as ws:
                backoff = 1
                await ws.send(json.dumps({"type": "hello", "pid": os.getpid()}))
                if VERBOSE:
                    print(f"[clihost] websocket connected to {url}")
                    sys.stdout.flush()

                # start PTY reader now
                await pty_session.start_reader()

                # optional wake nudge
                if WAKE_KEYS:
                    await pty_session.write_text(_decode_escapes(WAKE_KEYS))
                    if VERBOSE:
                        print("[clihost] sent wake keys")
                        sys.stdout.flush()

                # gate on ready, then quiet, then 3 s, then preprompt
                await pty_session.wait_ready()
                await pty_session.wait_quiet(QUIET_AFTER_READY_MS, QUIET_WAIT_TIMEOUT_MS)
                if DEFAULT_PREPROMPT.strip():
                    if ECHO_INJECTIONS:
                        print(f"{ECHO_PREFIX}[preprompt]\n{DEFAULT_PREPROMPT}")
                        sys.stdout.flush()
                    await try_execute_prompt(pty_session, DEFAULT_PREPROMPT, pre_delay_ms=PREPROMPT_DELAY_MS)
                    if VERBOSE:
                        print("[clihost] preprompt injected and submitted")
                        sys.stdout.flush()

                async for raw in ws:
                    if proc.returncode is not None:
                        break
                    try:
                        msg = json.loads(raw)
                    except json.JSONDecodeError:
                        msg = {"type": "chat", "text": str(raw)}

                    if msg.get("type") == "chat":
                        base = msg.get("text", "")
                        text = f"lv:{base}"
                        if ECHO_INJECTIONS:
                            print(f"{ECHO_PREFIX}{text}")
                            sys.stdout.flush()
                        await try_execute_prompt(pty_session, text, pre_delay_ms=0)
                        if VERBOSE:
                            print("[clihost] chat injected and submitted")
                            sys.stdout.flush()
                    elif msg.get("type") == "raw":
                        payload = msg.get("bytes_b64", "")
                        if payload:
                            await pty_session.write_bytes(base64.b64decode(payload))
                    elif msg.get("type") == "control" and msg.get("cmd") == "quit":
                        return

        except asyncio.CancelledError:
            raise
        except Exception as exc:
            print(f"[clihost] websocket error: {exc}", file=sys.stderr)
            if EXIT_ON_ERROR:
                return
            if not RECONNECT:
                return
            await asyncio.sleep(backoff)
            backoff = min(backoff * 2, 30)

# ---------------- child cmd parsing ----------------
def parse_child_cmd(argv: List[str]) -> List[str]:
    if len(argv) <= 1:
        raise SystemExit("Missing child command. Example: clihost.py -- copilot  or  clihost.py copilot")
    if "--" in argv:
        i = argv.index("--")
        cmd = argv[i+1:]
        if not cmd:
            raise SystemExit("Missing child command after '--'")
        return cmd
    return argv[1:]

# ---------------- main ----------------
async def main() -> int:
    # must run in a real terminal
    try:
        os.open("/dev/tty", os.O_RDWR | os.O_CLOEXEC)
    except OSError:
        raise SystemExit("Needs a real terminal. Run from Terminal or iTerm.")

    child_cmd = parse_child_cmd(sys.argv)
    print("[clihost] awaiting child process creation...")
    sys.stdout.flush()

    pty_session = PTYSession(child_cmd)
    proc = await pty_session.spawn()
    print(f"[clihost] started child PID {proc.pid}: {' '.join(child_cmd)}")
    sys.stdout.flush()

    # start local keyboard proxy
    kb = KeyboardProxy(pty_session)
    kb.start()

    ws_task = asyncio.create_task(ws_consumer(CLIHOST_URL, pty_session, proc))

    stop_event = asyncio.Event()
    def _handle_signal(signum: int, _frame) -> None:
        stop_event.set()
    for sig in (signal.SIGINT, signal.SIGTERM):
        try:
            signal.signal(sig, _handle_signal)
        except Exception:
            pass

    try:
        done, _ = await asyncio.wait(
            {asyncio.create_task(proc.wait()), asyncio.create_task(stop_event.wait())},
            return_when=asyncio.FIRST_COMPLETED,
        )
        for fut in done:
            fut.result()
    finally:
        ws_task.cancel()
        try:
            await ws_task
        except asyncio.CancelledError:
            pass
        # stop keyboard proxy and restore terminal
        kb.stop()

    if proc.returncode is None:
        try:
            proc.terminate()
            await asyncio.wait_for(proc.wait(), timeout=5.0)
        except asyncio.TimeoutError:
            proc.kill()
            await proc.wait()

    return int(proc.returncode or 0)

if __name__ == "__main__":
    try:
        code = asyncio.run(main())
    except KeyboardInterrupt:
        code = 130
    sys.exit(code)
