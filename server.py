#!/usr/bin/env python3
"""A minimal markdown live viewer with websocket powered directory updates."""

from __future__ import annotations

import argparse
import asyncio
import json
import logging
from pathlib import Path
from typing import Dict, Optional
from urllib.parse import unquote

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
        self.template_path = Path(__file__).resolve().parent / "templates" / "unified_index.html"

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
        files = self.file_manager.list_markdown_files(root)
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
        files = self.file_manager.list_markdown_files(root)

        return web.json_response(
            {
                "rootPath": str(root),
                "pathArgument": original,
                "files": files,
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

        files = self.file_manager.list_markdown_files(root)
        await ws.send_json({"type": "directory_update", "path": str(root), "files": files})

    async def handle_filesystem_event(self, root: Path, kind: str, relative: Optional[str]) -> None:
        if kind in {"created", "deleted", "moved"}:
            await self.notify_directory_update(root)
        if kind in {"modified", "created", "moved"} and relative:
            await self.notify_file_changed(root, relative)

    async def notify_directory_update(self, root: Path) -> None:
        files = self.file_manager.list_markdown_files(root)
        await self._broadcast(root, {"type": "directory_update", "path": str(root), "files": files})

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
        observer.schedule(handler, str(resolved), recursive=False)
        observer.start()
        self.watchers[resolved] = observer

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
        app.router.add_get("/ws", self.websocket_handler)
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
