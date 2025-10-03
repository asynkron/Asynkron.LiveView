#!/usr/bin/env python3
"""A minimal markdown live viewer with websocket powered directory updates."""

from __future__ import annotations

import argparse
import asyncio
import contextlib
import json
import logging
import os
import pty
import signal
import struct
import termios
from pathlib import Path
from typing import Dict, Optional
from urllib.parse import unquote

import fcntl
from aiohttp import WSMsgType, web
from watchdog.events import FileSystemEventHandler
from watchdog.observers import Observer

from components.file_manager import FileManager

logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(levelname)s - %(message)s")
logger = logging.getLogger(__name__)


class MarkdownDirectoryEventHandler(FileSystemEventHandler):
    """Forward filesystem events for markdown files back to the aiohttp loop."""

    def __init__(self, server: "UnifiedMarkdownServer", root: Path) -> None:
        super().__init__()
        self.server = server
        self.root = root.resolve()

    def on_created(self, event):  # pragma: no cover - exercised via watcher integration tests
        if not event.is_directory:
            self._handle_event("created", event.src_path)

    def on_modified(self, event):  # pragma: no cover - exercised via watcher integration tests
        if not event.is_directory:
            self._handle_event("modified", event.src_path)

    def on_deleted(self, event):  # pragma: no cover - exercised via watcher integration tests
        if not event.is_directory:
            self._handle_event("deleted", event.src_path)

    def on_moved(self, event):  # pragma: no cover - exercised via watcher integration tests
        if not event.is_directory:
            self._handle_event("moved", event.dest_path or event.src_path)

    def _handle_event(self, kind: str, raw_path: Optional[str]) -> None:
        if not raw_path or not raw_path.endswith(".md"):
            return

        try:
            resolved = Path(raw_path).expanduser().resolve()
            relative = resolved.relative_to(self.root).as_posix()
        except Exception:  # File may have been removed or moved away.
            relative = None

        if self.server.loop is None:
            return

        asyncio.run_coroutine_threadsafe(
            self.server.handle_filesystem_event(self.root, kind, relative),
            self.server.loop,
        )


class UnifiedMarkdownServer:
    """Serve a single markdown file view backed by a directory watcher."""

    def __init__(self, markdown_dir: str = "markdown", port: int = 8080) -> None:
        self.default_root = Path(markdown_dir).expanduser().resolve()
        self.port = port
        self.file_manager = FileManager()
        base_path = Path(__file__).resolve().parent
        self.template_path = base_path / "templates" / "unified_index.html"
        # Keep a dedicated directory for vendor assets so we do not rely on flaky CDNs.
        self.static_assets_path = base_path / "templates" / "static"

        self.loop: Optional[asyncio.AbstractEventLoop] = None
        self.clients: Dict[web.WebSocketResponse, str] = {}
        self.watchers: Dict[Path, Observer] = {}

    # ------------------------------------------------------------------
    # aiohttp lifecycle helpers
    # ------------------------------------------------------------------
    async def on_startup(self, app: web.Application) -> None:
        self.loop = asyncio.get_running_loop()
        if not self.default_root.exists():
            self.default_root.mkdir(parents=True, exist_ok=True)
        logger.info("Serving markdown from %s", self.default_root)

    async def on_shutdown(self, app: web.Application) -> None:
        for ws in list(self.clients.keys()):
            await ws.close()
        self.clients.clear()

        for observer in self.watchers.values():
            observer.stop()
            observer.join(timeout=1)
        self.watchers.clear()

    # ------------------------------------------------------------------
    # Path helpers
    # ------------------------------------------------------------------
    def resolve_root(self, path_param: Optional[str]) -> tuple[Path, str]:
        if path_param:
            candidate = Path(unquote(path_param)).expanduser()
            display_value = path_param
        else:
            candidate = self.default_root
            display_value = str(self.default_root)

        resolved = candidate.resolve()
        return resolved, display_value

    # ------------------------------------------------------------------
    # HTTP handlers
    # ------------------------------------------------------------------
    async def handle_index(self, request: web.Request) -> web.Response:
        path_param = request.rel_url.query.get("path")
        file_param = request.rel_url.query.get("file")

        root, original_path_argument = self.resolve_root(path_param)
        index = self.file_manager.build_markdown_index(root)
        files = index["files"]
        file_tree = index["tree"]
        selected_file = None
        error_message = None

        fallback = self.file_manager.fallback_markdown(root)

        if file_param:
            try:
                content = self.file_manager.read_markdown(root, file_param)
                selected_file = file_param
            except (FileNotFoundError, ValueError):
                content = fallback
                error_message = f"File not found: {file_param}"
        elif files:
            selected_file = files[0]["relativePath"]
            content = self.file_manager.read_markdown(root, selected_file)
        else:
            content = fallback

        initial_state = {
            "rootPath": str(root),
            "pathArgument": original_path_argument,
            "files": files,
            "fileTree": file_tree,
            "selectedFile": selected_file,
            "content": content,
            "error": error_message,
            "fallback": fallback,
        }

        html = self.template_path.read_text(encoding="utf-8")
        html = html.replace("__INITIAL_STATE_JSON__", json.dumps(initial_state))
        return web.Response(text=html, content_type="text/html")

    async def handle_list_files(self, request: web.Request) -> web.Response:
        path_param = request.rel_url.query.get("path")
        root, original = self.resolve_root(path_param)
        index = self.file_manager.build_markdown_index(root)
        files = index["files"]
        tree = index["tree"]

        return web.json_response(
            {
                "rootPath": str(root),
                "pathArgument": original,
                "files": files,
                "tree": tree,
            }
        )

    async def handle_get_file(self, request: web.Request) -> web.Response:
        path_param = request.rel_url.query.get("path")
        file_param = request.rel_url.query.get("file")
        if not file_param:
            return web.json_response({"error": "Missing file parameter"}, status=400)

        root, original = self.resolve_root(path_param)

        try:
            content = self.file_manager.read_markdown(root, file_param)
        except FileNotFoundError:
            return web.json_response({"error": "File not found"}, status=404)
        except ValueError:
            return web.json_response({"error": "Invalid file path"}, status=400)

        return web.json_response(
            {
                "rootPath": str(root),
                "pathArgument": original,
                "file": file_param,
                "content": content,
            }
        )

    async def handle_get_file_raw(self, request: web.Request) -> web.Response:
        path_param = request.rel_url.query.get("path")
        file_param = request.rel_url.query.get("file")
        if not file_param:
            return web.Response(text="Missing file parameter", status=400)

        root, _ = self.resolve_root(path_param)
        try:
            content = self.file_manager.read_markdown(root, file_param)
        except FileNotFoundError:
            return web.Response(text="File not found", status=404)
        except ValueError:
            return web.Response(text="Invalid file path", status=400)

        safe_name = Path(file_param).name
        headers = {
            "Content-Disposition": f'attachment; filename="{safe_name}"',
            "Content-Type": "text/markdown; charset=utf-8",
        }
        return web.Response(text=content, headers=headers)

    async def handle_delete_file(self, request: web.Request) -> web.Response:
        path_param = request.rel_url.query.get("path")
        file_param = request.rel_url.query.get("file")
        if not file_param:
            return web.json_response({"error": "Missing file parameter"}, status=400)

        root, _ = self.resolve_root(path_param)
        try:
            self.file_manager.delete_markdown(root, file_param)
        except FileNotFoundError:
            return web.json_response({"error": "File not found"}, status=404)
        except ValueError:
            return web.json_response({"error": "Invalid file path"}, status=400)

        await self.handle_filesystem_event(root, "deleted", file_param)
        return web.json_response({"success": True})

    async def handle_update_file(self, request: web.Request) -> web.Response:
        path_param = request.rel_url.query.get("path")
        file_param = request.rel_url.query.get("file")
        if not file_param:
            return web.json_response({"error": "Missing file parameter"}, status=400)

        try:
            payload = await request.json()
        except json.JSONDecodeError:
            return web.json_response({"error": "Invalid JSON payload"}, status=400)

        if "content" not in payload:
            return web.json_response({"error": "Missing content"}, status=400)

        content = str(payload["content"])
        root, _ = self.resolve_root(path_param)

        try:
            self.file_manager.write_markdown(root, file_param, content)
        except FileNotFoundError:
            return web.json_response({"error": "File not found"}, status=404)
        except ValueError as exc:
            return web.json_response({"error": str(exc)}, status=400)

        await self.handle_filesystem_event(root, "modified", file_param)
        return web.json_response({"success": True, "file": file_param, "content": content})

    # ------------------------------------------------------------------
    # Websocket handling
    # ------------------------------------------------------------------
    async def websocket_handler(self, request: web.Request) -> web.StreamResponse:
        ws = web.WebSocketResponse()
        await ws.prepare(request)
        self.clients[ws] = ""

        async for message in ws:
            if message.type == WSMsgType.TEXT:
                await self._handle_ws_message(ws, message.data)
            elif message.type == WSMsgType.ERROR:
                logger.error("WebSocket closed with error: %s", ws.exception())
                break

        self.clients.pop(ws, None)
        return ws

    async def terminal_websocket_handler(self, request: web.Request) -> web.StreamResponse:
        ws = web.WebSocketResponse()
        await ws.prepare(request)

        loop = asyncio.get_running_loop()

        try:
            pid, master_fd = pty.fork()
        except OSError as exc:  # pragma: no cover - defensive logging
            logger.exception("Failed to spawn terminal session: %s", exc)
            await ws.send_json({"type": "state", "message": "Unable to start shell"})
            await ws.close()
            return ws

        if pid == 0:  # Child process: replace with user shell
            shell = os.environ.get("SHELL", "/bin/bash")
            try:
                os.execvp(shell, [shell])
            except Exception:  # pragma: no cover - exec should not return
                os.execvp("/bin/sh", ["/bin/sh"])
            os._exit(1)

        os.set_blocking(master_fd, False)
        output_queue: asyncio.Queue[Optional[bytes]] = asyncio.Queue()

        def _enqueue_output() -> None:
            try:
                data = os.read(master_fd, 4096)
            except OSError:
                data = b""

            if data:
                output_queue.put_nowait(data)
            else:
                with contextlib.suppress(Exception):
                    loop.remove_reader(master_fd)
                output_queue.put_nowait(None)

        loop.add_reader(master_fd, _enqueue_output)
        output_task = asyncio.create_task(self._forward_terminal_output(output_queue, ws))

        await ws.send_json({"type": "state", "message": "Shell ready"})

        exit_code: Optional[int] = None

        try:
            async for message in ws:
                if message.type == WSMsgType.TEXT:
                    if not message.data:
                        continue
                    try:
                        payload = json.loads(message.data)
                    except json.JSONDecodeError:
                        os.write(master_fd, message.data.encode("utf-8"))
                        continue

                    msg_type = payload.get("type")
                    if msg_type == "input":
                        data = payload.get("data", "")
                        if isinstance(data, str) and data:
                            os.write(master_fd, data.encode("utf-8"))
                    elif msg_type == "resize":
                        cols = int(payload.get("cols") or 0)
                        rows = int(payload.get("rows") or 0)
                        self._resize_pty(master_fd, rows, cols)
                elif message.type == WSMsgType.BINARY:
                    if message.data:
                        os.write(master_fd, message.data)
                elif message.type == WSMsgType.ERROR:
                    logger.error("Terminal websocket closed with error: %s", ws.exception())
                    break
        finally:
            with contextlib.suppress(Exception):
                loop.remove_reader(master_fd)
            with contextlib.suppress(asyncio.QueueFull):
                output_queue.put_nowait(None)
            output_task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await output_task

            exit_code = await self._terminate_terminal_process(pid)

            with contextlib.suppress(OSError):
                os.close(master_fd)

            if exit_code is not None and not ws.closed:
                with contextlib.suppress(Exception):
                    await ws.send_json({"type": "exit", "code": exit_code})

            with contextlib.suppress(Exception):
                await ws.close()

        return ws

    async def _handle_ws_message(self, ws: web.WebSocketResponse, raw: str) -> None:
        try:
            payload = json.loads(raw)
        except json.JSONDecodeError:
            logger.warning("Ignoring malformed websocket message: %s", raw)
            return

        if payload.get("type") != "subscribe":
            return

        path_param = payload.get("path")
        root, _ = self.resolve_root(path_param)
        self.clients[ws] = str(root)
        await self._ensure_watcher(root)

        index = self.file_manager.build_markdown_index(root)
        await ws.send_json(
            {
                "type": "directory_update",
                "path": str(root),
                "files": index["files"],
                "tree": index["tree"],
            }
        )

    async def handle_filesystem_event(self, root: Path, kind: str, relative: Optional[str]) -> None:
        if kind in {"created", "deleted", "moved"}:
            await self.notify_directory_update(root)
        if kind in {"modified", "created", "moved"} and relative:
            await self.notify_file_changed(root, relative)

    async def notify_directory_update(self, root: Path) -> None:
        index = self.file_manager.build_markdown_index(root)
        await self._broadcast(
            root,
            {
                "type": "directory_update",
                "path": str(root),
                "files": index["files"],
                "tree": index["tree"],
            },
        )

    async def notify_file_changed(self, root: Path, relative: str) -> None:
        await self._broadcast(root, {"type": "file_changed", "path": str(root), "file": relative})

    async def _broadcast(self, root: Path, payload: Dict[str, object]) -> None:
        target = str(root)
        stale_clients = []
        for ws, subscribed_root in self.clients.items():
            if subscribed_root != target or ws.closed:
                continue
            try:
                await ws.send_json(payload)
            except Exception:  # pragma: no cover - defensive cleanup
                stale_clients.append(ws)

        for ws in stale_clients:
            self.clients.pop(ws, None)

    async def _ensure_watcher(self, root: Path) -> None:
        resolved = root.resolve()
        if resolved in self.watchers:
            return

        if not resolved.exists():
            resolved.mkdir(parents=True, exist_ok=True)

        if not resolved.is_dir():
            logger.warning("Cannot watch non-directory path: %s", resolved)
            return

        handler = MarkdownDirectoryEventHandler(self, resolved)
        observer = Observer()
        observer.schedule(handler, str(resolved), recursive=True)
        observer.start()
        self.watchers[resolved] = observer

    async def _forward_terminal_output(
        self,
        queue: asyncio.Queue[Optional[bytes]],
        ws: web.WebSocketResponse,
    ) -> None:
        try:
            while True:
                chunk = await queue.get()
                if chunk is None:
                    break
                if ws.closed:
                    break
                await ws.send_bytes(chunk)
        except asyncio.CancelledError:
            raise
        except Exception as exc:  # pragma: no cover - best effort logging
            logger.debug("Terminal output forwarding stopped: %s", exc)

    def _resize_pty(self, master_fd: int, rows: int, cols: int) -> None:
        if master_fd < 0 or rows <= 0 or cols <= 0:
            return
        try:
            packed = struct.pack("HHHH", rows, cols, 0, 0)
            fcntl.ioctl(master_fd, termios.TIOCSWINSZ, packed)
        except OSError as exc:  # pragma: no cover - resize failures are non-fatal
            logger.debug("Failed to resize PTY: rows=%s cols=%s error=%s", rows, cols, exc)

    async def _terminate_terminal_process(self, pid: int) -> Optional[int]:
        if pid <= 0:
            return None

        with contextlib.suppress(ProcessLookupError):
            os.kill(pid, signal.SIGTERM)

        try:
            _, status = await asyncio.to_thread(os.waitpid, pid, 0)
        except ChildProcessError:
            return None
        except Exception as exc:  # pragma: no cover - defensive logging
            logger.debug("waitpid failed for terminal process: %s", exc)
            return None

        try:
            return os.waitstatus_to_exitcode(status)
        except ValueError:
            return None

    # ------------------------------------------------------------------
    # Server bootstrap helpers
    # ------------------------------------------------------------------
    def create_app(self) -> web.Application:
        app = web.Application()
        app.router.add_get("/", self.handle_index)
        app.router.add_get("/api/files", self.handle_list_files)
        app.router.add_get("/api/file", self.handle_get_file)
        app.router.add_get("/api/file/raw", self.handle_get_file_raw)
        app.router.add_delete("/api/file", self.handle_delete_file)
        app.router.add_put("/api/file", self.handle_update_file)
        app.router.add_get("/ws", self.websocket_handler)
        app.router.add_get("/ws/terminal", self.terminal_websocket_handler)
        # Serve vendored assets (e.g. dockview) directly from disk to avoid CDN outages.
        if self.static_assets_path.exists():
            app.router.add_static("/static/", self.static_assets_path)
        app.on_startup.append(self.on_startup)
        app.on_shutdown.append(self.on_shutdown)
        return app

    def run(self) -> None:
        app = self.create_app()
        web.run_app(app, port=self.port)


def main() -> None:
    parser = argparse.ArgumentParser(description="Serve a markdown directory")
    parser.add_argument("--path", dest="path", default="markdown", help="Directory to watch")
    parser.add_argument("--port", dest="port", type=int, default=8080, help="Port to bind")
    args = parser.parse_args()

    server = UnifiedMarkdownServer(markdown_dir=args.path, port=args.port)
    server.run()


if __name__ == "__main__":
    main()
