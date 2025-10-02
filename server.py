#!/usr/bin/env python3
"""Unified server for the Markdown Live View experience.

The previous implementation exposed MCP tooling and an HTTP streaming bridge for
chat messages. That path turned out to be brittle, so the server now focuses on
the Live View UI and a lightweight WebSocket feed that can push chat messages to
external host processes.
"""

import asyncio
import argparse
import json
import logging
import time
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Set
from urllib.parse import quote

from aiohttp import WSMsgType, web
from aiohttp.web_response import Response
from watchdog.events import FileSystemEventHandler
from watchdog.observers import Observer

# Import component modules
from components.file_manager import FileManager
from components.template_handler import TemplateHandler
from components.request_handlers import RequestHandlers

# Configure logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)


class MarkdownFileHandler(FileSystemEventHandler):
    """Handles file system events for markdown files."""
    
    def __init__(self, server, loop):
        self.server = server
        self.loop = loop
        super().__init__()
    
    def on_created(self, event):
        if not event.is_directory and event.src_path.endswith('.md'):
            logger.info(f"New markdown file detected: {event.src_path}")
            # Schedule the coroutine on the main event loop
            asyncio.run_coroutine_threadsafe(
                self.server.notify_clients_file_change(event.src_path), 
                self.loop
            )
    
    def on_modified(self, event):
        if not event.is_directory and event.src_path.endswith('.md'):
            logger.info(f"Markdown file modified: {event.src_path}")
            # Schedule the coroutine on the main event loop
            asyncio.run_coroutine_threadsafe(
                self.server.notify_clients_file_change(event.src_path), 
                self.loop
            )
    
    def on_deleted(self, event):
        if not event.is_directory and event.src_path.endswith('.md'):
            logger.info(f"Markdown file deleted: {event.src_path}")
            # Schedule the coroutine on the main event loop
            asyncio.run_coroutine_threadsafe(
                self.server.notify_clients_file_change(event.src_path), 
                self.loop
            )

class UnifiedMarkdownServer:
    """Live View server with WebSocket chat fan-out for CLI agent hosts."""
    
    def __init__(
        self,
        markdown_dir: str = "markdown",
        port: int = 8080,
    ):
        self.default_markdown_dir = Path(markdown_dir)
        self.markdown_dir = self.default_markdown_dir  # Current active directory
        self.port = port
        self.clients: set = set()
        self.agent_feed_clients: Set[web.WebSocketResponse] = set()
        self.observer = None
        self.sticky_files: Dict[str, str] = {}  # Maps directory path to sticky filename

        # Initialize component modules (pass sticky_files reference to FileManager)
        self.file_manager = FileManager(self.default_markdown_dir, self.sticky_files)
        self.template_handler = TemplateHandler(
            Path(__file__).resolve().parent / "templates" / "unified_index.html"
        )
        self.request_handlers = RequestHandlers(self.default_markdown_dir)

    def _sanitize_file_id(self, file_id: str) -> str:
        """Ensure the provided File Id maps to a safe filename."""
        return self.file_manager.sanitize_file_id(file_id)

    def resolve_markdown_path(self, path_param: str = None) -> Path:
        """Resolve the markdown directory path from various sources."""
        return self.request_handlers.resolve_markdown_path(path_param)
    
    def get_markdown_files(self, custom_path: Path = None) -> List[Dict[str, Any]]:
        """Get all markdown files sorted by creation time."""
        return self.file_manager.get_markdown_files(custom_path)
    
    def get_unified_markdown(self, custom_path: Path = None) -> str:
        """Get all markdown content unified into a single string."""
        return self.file_manager.get_unified_markdown(custom_path)
    
    def load_index_template(self) -> str:
        """Load unified index template from disk."""
        return self.template_handler.load_template()

    def render_index_template(self, target_path: Path) -> str:
        """Populate the template with runtime values."""
        return self.template_handler.render_template(target_path)

    async def handle_index(self, request):
        """Serve the main HTML page."""
        # Get optional path parameter
        path_param = request.query.get('path')
        
        # Update the active directory
        self.markdown_dir = self.resolve_markdown_path(path_param)
        
        html = self.render_index_template(self.markdown_dir)
        return Response(text=html, content_type='text/html')
    
    async def handle_websocket(self, request):
        """Handle WebSocket connections."""
        ws = web.WebSocketResponse()
        await ws.prepare(request)
        
        # Get optional path parameter
        path_param = request.query.get('path')
        target_directory = self.resolve_markdown_path(path_param)
        
        self.clients.add(ws)
        logger.info(f"WebSocket client connected. Total clients: {len(self.clients)}")
        
        # Send initial content
        try:
            unified_content = self.get_unified_markdown(target_directory)
            await ws.send_str(json.dumps({
                'type': 'content_update',
                'content': unified_content
            }))
        except Exception as e:
            logger.error(f"Error sending initial content: {e}")
        
        try:
            async for msg in ws:
                if msg.type == WSMsgType.TEXT:
                    try:
                        data = json.loads(msg.data)
                        if data.get('type') == 'chat':
                            # Handle chat message from UI
                            chat_message = data.get('message', '')
                            logger.info(f"Received chat message from UI: {chat_message}")
                            await self.broadcast_chat_to_hosts(chat_message)
                    except json.JSONDecodeError:
                        logger.warning(f"Received non-JSON message: {msg.data}")
                    except Exception as e:
                        logger.error(f"Error processing WebSocket message: {e}")
                elif msg.type == WSMsgType.ERROR:
                    logger.error(f'WebSocket error: {ws.exception()}')
                    break
        except Exception as e:
            logger.error(f"WebSocket error: {e}")
        finally:
            self.clients.discard(ws)
            logger.info(f"WebSocket client disconnected. Total clients: {len(self.clients)}")
        
        return ws
    
    async def handle_api_content(self, request):
        """API endpoint to get unified markdown content."""
        # Get optional path parameter
        path_param = request.query.get('path')
        target_directory = self.resolve_markdown_path(path_param)
        
        files = self.get_markdown_files(target_directory)
        unified_content = self.get_unified_markdown(target_directory)
        
        # Get the sticky filename for this directory
        sticky_filename = self.sticky_files.get(str(target_directory))
        
        # Build file list with metadata for UI actions
        file_list = []
        for file_info in files:
            file_list.append({
                'name': file_info['name'],
                'path': str(file_info['path']),
                'fileId': file_info['name'],
                'created': file_info['created'],
                'updated': file_info['updated'],
                'isSticky': file_info['name'] == sticky_filename
            })
        
        # For empty directories, report at least 1 file (the fallback content)
        file_count = len(files) if files else 1
        
        return web.json_response({
            'content': unified_content,
            'files': file_count,
            'fileList': file_list,
            'timestamp': time.time(),
            'directory': str(target_directory)
        })
    
    async def handle_delete_file(self, request):
        """API endpoint to delete a markdown file."""
        try:
            data = await request.json()
            file_id = data.get('fileId')
            
            if not file_id:
                return web.json_response({
                    'success': False,
                    'error': 'fileId is required'
                }, status=400)
            
            # Get the target directory
            path_param = request.query.get('path')
            target_directory = self.resolve_markdown_path(path_param)
            
            # Sanitize the file ID
            filename = self._sanitize_file_id(file_id)
            file_path = target_directory / filename
            
            if not file_path.exists():
                return web.json_response({
                    'success': False,
                    'error': f'File not found: {filename}'
                }, status=404)
            
            # Delete the file
            file_path.unlink()
            logger.info(f"Deleted file via API: {file_path}")
            
            return web.json_response({
                'success': True,
                'message': f'File deleted: {filename}'
            })
            
        except Exception as e:
            logger.error(f"Error deleting file: {e}")
            return web.json_response({
                'success': False,
                'error': str(e)
            }, status=500)
    
    async def handle_raw_markdown(self, request):
        """Serve unified markdown content as plain text."""
        # Get optional path parameter
        path_param = request.query.get('path')
        target_directory = self.resolve_markdown_path(path_param)
        
        unified_content = self.get_unified_markdown(target_directory)
        return Response(text=unified_content, content_type='text/plain', charset='utf-8')
    
    async def handle_get_file(self, request):
        """API endpoint to get individual file content."""
        try:
            file_id = request.query.get('fileId')
            
            if not file_id:
                return web.json_response({
                    'success': False,
                    'error': 'fileId is required'
                }, status=400)
            
            # Get the target directory
            path_param = request.query.get('path')
            target_directory = self.resolve_markdown_path(path_param)
            
            # Sanitize the file ID
            filename = self._sanitize_file_id(file_id)
            file_path = target_directory / filename
            
            if not file_path.exists():
                return web.json_response({
                    'success': False,
                    'error': f'File not found: {filename}'
                }, status=404)
            
            # Read the file
            content = file_path.read_text(encoding='utf-8')
            
            return web.json_response({
                'success': True,
                'fileId': file_id,
                'content': content
            })
            
        except Exception as e:
            logger.error(f"Error reading file: {e}")
            return web.json_response({
                'success': False,
                'error': str(e)
            }, status=500)
    
    async def handle_toggle_sticky(self, request):
        """API endpoint to toggle sticky status of a file."""
        try:
            data = await request.json()
            file_id = data.get('fileId')
            
            if not file_id:
                return web.json_response({
                    'success': False,
                    'error': 'fileId is required'
                }, status=400)
            
            # Get the target directory
            path_param = request.query.get('path')
            target_directory = self.resolve_markdown_path(path_param)
            
            # Sanitize the file ID
            filename = self._sanitize_file_id(file_id)
            file_path = target_directory / filename
            
            if not file_path.exists():
                return web.json_response({
                    'success': False,
                    'error': f'File not found: {filename}'
                }, status=404)
            
            dir_key = str(target_directory)
            current_sticky = self.sticky_files.get(dir_key)
            
            # Toggle: if this file is currently sticky, remove it; otherwise set it as sticky
            if current_sticky == filename:
                # Remove sticky status
                del self.sticky_files[dir_key]
                logger.info(f"Removed sticky status from: {filename}")
                is_sticky = False
            else:
                # Set as sticky (only one file can be sticky at a time)
                self.sticky_files[dir_key] = filename
                logger.info(f"Set sticky status for: {filename} in {dir_key}")
                is_sticky = True
            
            return web.json_response({
                'success': True,
                'isSticky': is_sticky,
                'message': f'Sticky status toggled for: {filename}'
            })
            
        except Exception as e:
            logger.error(f"Error toggling sticky: {e}")
            return web.json_response({
                'success': False,
                'error': str(e)
            }, status=500)
    
    async def notify_clients_file_change(self, file_path: str):
        """Notify all connected clients about file changes."""
        if not self.clients:
            return
        
        try:
            # Get updated content
            unified_content = self.get_unified_markdown()
            
            # Prepare WebSocket message
            message = json.dumps({
                'type': 'content_update',
                'content': unified_content,
                'changed_file': str(file_path)
            })
            
            # Send to all connected clients
            disconnected_clients = set()
            for client in self.clients:
                try:
                    await client.send_str(message)
                except Exception as e:
                    logger.warning(f"Failed to send message to client: {e}")
                    disconnected_clients.add(client)
            
            # Remove disconnected clients
            for client in disconnected_clients:
                self.clients.discard(client)
                
            logger.info(f"Notified {len(self.clients)} clients about file change: {file_path}")
            
        except Exception as e:
            logger.error(f"Error notifying clients: {e}")
    
    async def broadcast_chat_to_hosts(self, message: str) -> None:
        """Send chat messages from the UI to every connected agent host."""

        if not self.agent_feed_clients:
            logger.info("No agent hosts connected; skipping broadcast")
            return

        payload = json.dumps({"type": "chat", "text": message, "timestamp": time.time()})

        disconnected: Set[web.WebSocketResponse] = set()
        for ws in list(self.agent_feed_clients):
            try:
                await ws.send_str(payload)
            except ConnectionResetError:
                disconnected.add(ws)
            except Exception as exc:  # pragma: no cover - guard rail
                logger.error(f"Failed to send chat message to agent host: {exc}")
                disconnected.add(ws)

        for ws in disconnected:
            self.agent_feed_clients.discard(ws)

        logger.info(
            "Broadcast chat message to %d agent host(s)",
            len(self.agent_feed_clients),
        )

    async def handle_agent_feed(self, request: web.Request) -> web.WebSocketResponse:
        """Accept WebSocket connections from CLI host processes."""

        ws = web.WebSocketResponse()
        await ws.prepare(request)

        self.agent_feed_clients.add(ws)
        logger.info("Agent host connected. Total hosts: %d", len(self.agent_feed_clients))

        try:
            async for msg in ws:
                if msg.type == WSMsgType.TEXT:
                    logger.debug("Received message from agent host: %s", msg.data)
                elif msg.type == WSMsgType.ERROR:
                    logger.error("Agent host websocket error: %s", ws.exception())
                    break
        finally:
            self.agent_feed_clients.discard(ws)
            logger.info("Agent host disconnected. Total hosts: %d", len(self.agent_feed_clients))

        return ws
    

    def start_file_watcher(self, loop):
        """Start watching the markdown directory for changes."""
        if self.observer is not None:
            return  # Already watching
        
        self.observer = Observer()
        event_handler = MarkdownFileHandler(self, loop)
        self.observer.schedule(event_handler, str(self.default_markdown_dir), recursive=False)
        self.observer.start()
        logger.info(f"Started watching directory: {self.default_markdown_dir}")
    
    def stop_file_watcher(self):
        """Stop the file watcher."""
        if self.observer is not None:
            self.observer.stop()
            self.observer.join()
            logger.info("File watcher stopped")

    def create_app(self) -> web.Application:
        """Create the aiohttp application with all registered routes."""
        app = web.Application()

        # LiveView routes
        app.router.add_get('/', self.handle_index)
        app.router.add_get('/ws', self.handle_websocket)
        app.router.add_get('/api/content', self.handle_api_content)
        app.router.add_get('/api/file', self.handle_get_file)
        app.router.add_post('/api/delete', self.handle_delete_file)
        app.router.add_post('/api/toggle-sticky', self.handle_toggle_sticky)
        app.router.add_get('/raw', self.handle_raw_markdown)

        # Agent feed for external CLI hosts
        app.router.add_get('/agent-feed', self.handle_agent_feed)

        return app

    async def run(self) -> None:
        """Run the Live View server."""

        app = self.create_app()

        # Get the current event loop
        loop = asyncio.get_event_loop()

        # Start file watcher
        self.start_file_watcher(loop)

        try:
            logger.info(f"Starting server on http://localhost:{self.port}")
            runner = web.AppRunner(app)
            await runner.setup()
            site = web.TCPSite(runner, 'localhost', self.port)
            await site.start()

            logger.info(f"Server running at http://localhost:{self.port}")
            logger.info(f"Watching markdown files in: {self.default_markdown_dir.absolute()}")

            # Keep the server running
            while True:
                await asyncio.sleep(1)

        except KeyboardInterrupt:
            logger.info("Server shutting down...")
        except asyncio.CancelledError:
            logger.info("Server task cancelled")
            raise
        finally:
            self.stop_file_watcher()

def main():
    """Main entry point."""
    import argparse

    parser = argparse.ArgumentParser(description='Markdown Live View Server')
    parser.add_argument('--dir', default='markdown', help='Directory to watch for markdown files')
    parser.add_argument('--port', type=int, default=8080, help='Port to run server on')

    args = parser.parse_args()

    server = UnifiedMarkdownServer(
        args.dir,
        args.port,
    )

    try:
        asyncio.run(server.run())
    except KeyboardInterrupt:
        logger.info("Server stopped by user")

if __name__ == '__main__':
    main()
