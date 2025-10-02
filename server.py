#!/usr/bin/env python3
"""
Unified Server for Markdown Live View with MCP Integration

Combines both the HTTP LiveView server and MCP server functionality into a single application.
Provides both web interface for viewing markdown files and MCP protocol support for AI assistants.
"""

import asyncio
import argparse
import json
import logging
import time
from pathlib import Path
from typing import Any, Dict, List, Optional
from urllib.parse import quote
from aiohttp import web, WSMsgType
from aiohttp.web_response import Response
from watchdog.observers import Observer
from watchdog.events import FileSystemEventHandler

# Import MCP classes and functionality
from fastmcp import FastMCP
from mcp.types import (
    CallToolRequest,
    ListToolsRequest,
    ListToolsResult,
    DEFAULT_NEGOTIATED_VERSION,
    INTERNAL_ERROR,
    INVALID_PARAMS,
    INVALID_REQUEST,
    METHOD_NOT_FOUND,
    PARSE_ERROR,
    JSONRPCError
)

# Import component modules
from components.file_manager import FileManager
from components.mcp_tools import MCPTools
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
    """Unified server class combining LiveView and MCP functionality."""
    
    def __init__(self, markdown_dir: str = "markdown", port: int = 8080, enable_mcp: bool = True):
        self.default_markdown_dir = Path(markdown_dir)
        self.markdown_dir = self.default_markdown_dir  # Current active directory
        self.port = port
        self.clients: set = set()
        self.sse_clients: set = set()  # Track SSE clients for chat messages
        self.observer = None
        self.enable_mcp = enable_mcp
        self._mcp_client_capabilities: Dict[str, Any] | None = None
        self._mcp_initialized = False
        self._negotiated_protocol_version: str | int = DEFAULT_NEGOTIATED_VERSION
        self.sticky_files: Dict[str, str] = {}  # Maps directory path to sticky filename
        self.chat_messages: List[Dict[str, Any]] = []  # Store recent chat messages
        self.chat_subscribers: List[asyncio.Queue] = []  # Queues for streaming chat to MCP clients
        
        # Initialize component modules (pass sticky_files reference to FileManager)
        self.file_manager = FileManager(self.default_markdown_dir, self.sticky_files)
        self.template_handler = TemplateHandler(
            Path(__file__).resolve().parent / "templates" / "unified_index.html"
        )
        self.request_handlers = RequestHandlers(self.default_markdown_dir)
        self.mcp_tools = MCPTools(self.default_markdown_dir, self.file_manager, self.chat_messages)
        
        # Initialize FastMCP server if enabled
        if self.enable_mcp:
            self.mcp_server = FastMCP(
                name="markdown-liveview",
                version="1.0.0",
                instructions="MCP server for managing markdown files in the live view system"
            )
            self._register_mcp_tools()
            logger.info(f"FastMCP Server initialized for directory: {self.default_markdown_dir}")

    def _build_tool_definitions(self):
        """Return the shared MCP tool definitions."""
        return self.mcp_tools.build_tool_definitions()

    def _handle_mcp_initialize(self, params: Dict[str, Any]) -> Dict[str, Any]:
        """Process an MCP initialize request and return the server capabilities."""
        protocol_version = params.get("protocolVersion") or DEFAULT_NEGOTIATED_VERSION
        capabilities = params.get("capabilities")

        if isinstance(capabilities, dict):
            self._mcp_client_capabilities = capabilities
        else:
            self._mcp_client_capabilities = None

        self._negotiated_protocol_version = protocol_version
        self._mcp_initialized = False

        # FastMCP initialization response
        server_info: Dict[str, Any] = {
            "name": self.mcp_server.name,
            "version": "1.0.0",
        }

        init_result: Dict[str, Any] = {
            "protocolVersion": protocol_version,
            "capabilities": {
                "tools": {}
            },
            "serverInfo": server_info,
        }

        if self.mcp_server.instructions:
            init_result["instructions"] = self.mcp_server.instructions

        logger.info(
            "MCP initialize handshake (protocol=%s, client caps present=%s)",
            protocol_version,
            isinstance(capabilities, dict),
        )

        return init_result

    def _register_mcp_tools(self):
        """Register all available MCP tools with FastMCP."""
        
        @self.mcp_server.tool()
        async def show_content(content: str, title: str = None) -> str:
            """Create new markdown content that appears in the live view."""
            result = await self.mcp_tools.show_content(content, title)
            # Extract text from CallToolResult
            if result.content and len(result.content) > 0:
                return result.content[0].text
            return "Content created"
        
        @self.mcp_server.tool()
        async def list_content() -> str:
            """List every markdown entry managed by the server."""
            result = await self.mcp_tools.list_content()
            if result.content and len(result.content) > 0:
                return result.content[0].text
            return "No content"
        
        @self.mcp_server.tool()
        async def view_content(fileId: str) -> str:
            """Read markdown content using a File Id."""
            result = await self.mcp_tools.view_content(fileId)
            if result.content and len(result.content) > 0:
                return result.content[0].text
            return "Content not found"
        
        @self.mcp_server.tool()
        async def update_content(fileId: str, content: str, mode: str = "append") -> str:
            """Append to or replace existing markdown content."""
            result = await self.mcp_tools.update_content(fileId, content, mode)
            if result.content and len(result.content) > 0:
                return result.content[0].text
            return "Content updated"
        
        @self.mcp_server.tool()
        async def remove_content(fileId: str) -> str:
            """Delete markdown content using its File Id."""
            result = await self.mcp_tools.remove_content(fileId)
            if result.content and len(result.content) > 0:
                return result.content[0].text
            return "Content removed"
        
        @self.mcp_server.tool()
        async def subscribe_chat() -> str:
            """Subscribe to receive chat messages from the UI."""
            result = await self.mcp_tools.subscribe_chat()
            if result.content and len(result.content) > 0:
                return result.content[0].text
            return "Subscribed to chat"
        
        @self.mcp_server.tool()
        async def get_chat_messages(since: float = None) -> str:
            """Get recent chat messages from the UI."""
            result = await self.mcp_tools.get_chat_messages(since)
            if result.content and len(result.content) > 0:
                return result.content[0].text
            return "No messages"

        @self.mcp_server.tool()
        async def get_stream_chat_endpoint() -> str:
            """Get the HTTP streaming endpoint for live chat messages."""
            return f"Use POST http://localhost:{self.port}/mcp/stream/chat for real-time chat streaming. This endpoint uses chunked transfer encoding to stream JSON-RPC responses as newline-delimited JSON (NDJSON). Each line contains a complete JSON-RPC response with the next chat message."

        @self.mcp_server.tool()
        async def subscribe_chat_stream():
            """Subscribe to live chat messages from the UI using async generator."""
            # Create a queue for this subscriber
            queue = asyncio.Queue()
            self.chat_subscribers.append(queue)
            
            try:
                # Send initial message to confirm subscription
                yield "🔔 Subscribed to live chat stream. Waiting for messages..."
                
                # Stream messages as they arrive
                while True:
                    message_data = await queue.get()
                    yield f"💬 [{message_data['timestamp']:.3f}] {message_data['message']}"
            except asyncio.CancelledError:
                # Clean up when the stream is cancelled
                if queue in self.chat_subscribers:
                    self.chat_subscribers.remove(queue)
                yield "🔕 Chat stream subscription ended."
                raise
            except Exception as e:
                # Clean up on error
                if queue in self.chat_subscribers:
                    self.chat_subscribers.remove(queue)
                yield f"❌ Error in chat stream: {str(e)}"
                raise

        @self.mcp_server.tool()
        async def get_chat_stream_url() -> str:
            """Get the SSE URL for streaming chat messages in real-time."""
            return f"http://localhost:{self.port}/mcp/chat/subscribe"

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
                            await self.broadcast_chat_to_mcp(chat_message)
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
    
    async def handle_mcp_info(self, request):
        """GET endpoint for MCP server discovery and capabilities."""
        if not self.enable_mcp:
            return web.json_response({'error': 'MCP not enabled'}, status=503)
        
        # Return server information and available tools (using FastMCP)
        tools = self._build_tool_definitions()
        
        return web.json_response({
            'protocol': 'MCP (Model Context Protocol)',
            'version': '1.0.0',
            'name': self.mcp_server.name,
            'description': 'FastMCP server for managing markdown files in the live view system',
            'transport': 'JSON-RPC 2.0 over HTTP',
            'endpoint': '/mcp',
            'methods': ['POST'],
            'capabilities': {
                'tools': {}
            },
            'tools': [
                {
                    'name': tool.name,
                    'description': tool.description
                }
                for tool in tools
            ],
            'usage': {
                'initialize': 'POST /mcp with {"jsonrpc":"2.0","method":"initialize","id":1,"params":{"protocolVersion":"2024-11-05","capabilities":{}}}',
                'list_tools': 'POST /mcp with {"jsonrpc":"2.0","method":"tools/list","id":2}',
                'call_tool': 'POST /mcp with {"jsonrpc":"2.0","method":"tools/call","id":3,"params":{"name":"show_content","arguments":{...}}}'
            },
            'documentation': {
                'quick_reference': '/MCP_QUICK_REFERENCE.md',
                'connection_guide': '/MCP_CONNECTION_GUIDE.md',
                'troubleshooting': '/TROUBLESHOOTING_405.md'
            }
        })
    
    async def handle_mcp_http(self, request):
        """HTTP endpoint for MCP protocol (JSON-RPC over HTTP)."""
        if not self.enable_mcp:
            return web.json_response({'error': 'MCP not enabled'}, status=503)

        try:
            data = await request.json()
        except json.JSONDecodeError as exc:
            logger.warning(f"Failed to parse MCP request JSON: {exc}")
            return web.json_response(
                {
                    "jsonrpc": "2.0",
                    "id": None,
                    "error": {"code": PARSE_ERROR, "message": "Malformed JSON payload"}
                },
                status=400,
            )
        except Exception as exc:  # pragma: no cover - defensive
            logger.error(f"Unexpected error reading MCP request body: {exc}")
            return web.json_response(
                {
                    "jsonrpc": "2.0",
                    "id": None,
                    "error": {"code": INTERNAL_ERROR, "message": "Failed to read request body"}
                },
                status=500,
            )

        if not isinstance(data, dict):
            return web.json_response(
                {
                    "jsonrpc": "2.0",
                    "id": None,
                    "error": {"code": INVALID_REQUEST, "message": "Request payload must be an object"}
                },
                status=400,
            )

        method = data.get('method')
        params = data.get('params') or {}
        request_id = data.get('id')

        def jsonrpc_error(code: int, message: str, *, status: int = 400):
            return web.json_response(
                {
                    "jsonrpc": "2.0",
                    "id": request_id,
                    "error": {"code": code, "message": message}
                },
                status=status,
            )

        if not method:
            return jsonrpc_error(INVALID_REQUEST, "Request is missing method")

        if method == 'initialize':
            if request_id is None:
                return jsonrpc_error(INVALID_REQUEST, "initialize requires an id")
            if not isinstance(params, dict):
                return jsonrpc_error(INVALID_PARAMS, "initialize params must be an object")

            init_result = self._handle_mcp_initialize(params)
            return web.json_response({
                "jsonrpc": "2.0",
                "id": request_id,
                "result": init_result
            })

        if method == 'notifications/initialized':
            self._mcp_initialized = True
            return web.Response(status=204)

        if method == 'ping':
            if request_id is None:
                return web.Response(status=204)
            return web.json_response({
                "jsonrpc": "2.0",
                "id": request_id,
                "result": {}
            })

        if method == 'tools/list':
            if request_id is None:
                return jsonrpc_error(INVALID_REQUEST, "tools/list requires an id")
            list_result = ListToolsResult(tools=self._build_tool_definitions())
            return web.json_response({
                "jsonrpc": "2.0",
                "id": request_id,
                "result": list_result.model_dump(exclude_none=True)
            })

        if method == 'tools/call':
            if request_id is None:
                return jsonrpc_error(INVALID_REQUEST, "tools/call requires an id")
            if not isinstance(params, dict):
                return jsonrpc_error(INVALID_PARAMS, "tools/call params must be an object")

            tool_name = params.get('name')
            arguments = params.get('arguments') or {}

            if not tool_name:
                return jsonrpc_error(INVALID_PARAMS, "Tool name is required")
            if not isinstance(arguments, dict):
                return jsonrpc_error(INVALID_PARAMS, "Tool arguments must be an object")

            try:
                # Get FastMCP tools and execute
                fastmcp_tools = await self.mcp_server.get_tools()
                
                if tool_name not in fastmcp_tools:
                    return jsonrpc_error(METHOD_NOT_FOUND, f"Unknown tool: {tool_name}")
                
                tool = fastmcp_tools[tool_name]
                tool_result = await tool.run(arguments)
                
                # Convert FastMCP ToolResult to MCP CallToolResult format
                content_list, metadata = tool_result.to_mcp_result()
                from mcp.types import CallToolResult
                result = CallToolResult(
                    content=content_list,
                    isError=False
                )
            except Exception as exc:
                if hasattr(exc, 'model_dump'):
                    logger.error(f"MCP tool returned JSONRPCError: {exc}")
                    return web.json_response(
                        exc.model_dump(exclude_none=True),
                        status=400,
                    )
                logger.error(f"Unexpected error calling tool {tool_name}: {exc}")
                return web.json_response(
                    {
                        "jsonrpc": "2.0",
                        "id": request_id,
                        "error": {"code": INTERNAL_ERROR, "message": f"Tool execution failed: {exc}"}
                    },
                    status=500,
                )

            return web.json_response({
                "jsonrpc": "2.0",
                "id": request_id,
                "result": result.model_dump(exclude_none=True)
            })

        return jsonrpc_error(METHOD_NOT_FOUND, f"Unknown method: {method}")
    
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
    
    async def handle_chat_sse(self, request):
        """SSE endpoint for chat message subscriptions."""
        if not self.enable_mcp:
            return web.json_response({'error': 'MCP not enabled'}, status=503)
        
        response = web.StreamResponse(
            status=200,
            reason='OK',
            headers={
                'Content-Type': 'text/event-stream',
                'Cache-Control': 'no-cache',
                'Connection': 'keep-alive',
                'X-Accel-Buffering': 'no',  # Disable nginx buffering
            }
        )
        await response.prepare(request)
        
        # Add this client to SSE clients
        self.sse_clients.add(response)
        logger.info(f"SSE client connected for chat. Total SSE clients: {len(self.sse_clients)}")
        
        try:
            # Send initial connection confirmation
            await response.write(b'data: {"type":"connected","message":"Successfully subscribed to chat messages"}\n\n')
            
            # Keep the connection alive
            while True:
                await asyncio.sleep(30)  # Send heartbeat every 30 seconds
                try:
                    await response.write(b': heartbeat\n\n')
                except Exception as e:
                    logger.debug(f"Failed to send heartbeat, client likely disconnected: {e}")
                    break
                    
        except asyncio.CancelledError:
            logger.info("SSE connection cancelled")
        except Exception as e:
            logger.error(f"SSE error: {e}")
        finally:
            self.sse_clients.discard(response)
            logger.info(f"SSE client disconnected. Total SSE clients: {len(self.sse_clients)}")
        
        return response
    
    async def broadcast_chat_to_mcp(self, message: str):
        """Broadcast chat message to all connected MCP clients via SSE."""
        # Store the message for polling (backward compatibility)
        chat_entry = {
            "type": "chat",
            "message": message,
            "timestamp": time.time()
        }
        self.chat_messages.append(chat_entry)
        
        # Keep only last 100 messages
        if len(self.chat_messages) > 100:
            self.chat_messages = self.chat_messages[-100:]
        
        logger.info(f"Stored chat message for MCP clients: {message[:50]}...")
        logger.info(f"Total chat messages stored: {len(self.chat_messages)}")
        
        # Send via SSE to all connected clients
        if self.sse_clients:
            sse_data = json.dumps({
                "type": "chat",
                "message": message,
                "timestamp": chat_entry["timestamp"]
            })
            sse_message = f"data: {sse_data}\n\n"
            
            disconnected_clients = set()
            for client in self.sse_clients:
                try:
                    await client.write(sse_message.encode('utf-8'))
                except Exception as e:
                    logger.warning(f"Failed to send SSE message to client: {e}")
                    disconnected_clients.add(client)
            
            # Remove disconnected clients
            for client in disconnected_clients:
                self.sse_clients.discard(client)
            
            logger.info(f"Sent chat message via SSE to {len(self.sse_clients)} clients")
        
        # Send to streaming chat subscribers (new generator-based functionality)
        if self.chat_subscribers:
            message_data = {
                "message": message,
                "timestamp": chat_entry["timestamp"]
            }
            
            # Send to all active streaming subscribers
            disconnected_subscribers = []
            for i, queue in enumerate(self.chat_subscribers):
                try:
                    queue.put_nowait(message_data)
                except asyncio.QueueFull:
                    logger.warning(f"Chat subscriber queue {i} is full, skipping message")
                except Exception as e:
                    logger.warning(f"Failed to send to chat subscriber {i}: {e}")
                    disconnected_subscribers.append(queue)
            
            # Remove disconnected subscribers
            for queue in disconnected_subscribers:
                self.chat_subscribers.remove(queue)
            
            logger.info(f"Sent chat message to {len(self.chat_subscribers)} streaming subscribers")

    async def handle_mcp_stream_chat(self, request):
        """HTTP streaming endpoint for MCP chat subscription using chunked transfer encoding."""
        if not self.enable_mcp:
            return web.json_response({'error': 'MCP not enabled'}, status=503)
        
        # Set up streaming response
        response = web.StreamResponse(
            status=200,
            headers={
                'Content-Type': 'application/x-ndjson',  # Newline Delimited JSON
                'Cache-Control': 'no-cache',
                'Connection': 'keep-alive',
                'Transfer-Encoding': 'chunked'
            }
        )
        await response.prepare(request)
        
        # Create a queue for this subscriber
        queue = asyncio.Queue()
        self.chat_subscribers.append(queue)
        
        try:
            # Send initial subscription confirmation
            initial_response = {
                "jsonrpc": "2.0",
                "id": 1,
                "result": "🔔 Subscribed to live chat stream. Waiting for messages..."
            }
            await response.write(f"{json.dumps(initial_response)}\n".encode('utf-8'))
            
            # Stream messages as they arrive
            message_id = 2
            while True:
                try:
                    # Wait for new message
                    message_data = await queue.get()
                    
                    # Format as JSON-RPC response
                    streaming_response = {
                        "jsonrpc": "2.0",
                        "id": message_id,
                        "result": f"💬 [{message_data['timestamp']:.3f}] {message_data['message']}"
                    }
                    
                    # Send the chunk
                    chunk = f"{json.dumps(streaming_response)}\n"
                    await response.write(chunk.encode('utf-8'))
                    message_id += 1
                    
                except asyncio.CancelledError:
                    logger.info("MCP chat stream cancelled")
                    break
                except Exception as e:
                    logger.error(f"Error in MCP chat stream: {e}")
                    error_response = {
                        "jsonrpc": "2.0",
                        "id": message_id,
                        "error": {"code": -32000, "message": f"Stream error: {str(e)}"}
                    }
                    await response.write(f"{json.dumps(error_response)}\n".encode('utf-8'))
                    break
                    
        except Exception as e:
            logger.error(f"MCP streaming error: {e}")
        finally:
            # Clean up subscriber
            if queue in self.chat_subscribers:
                self.chat_subscribers.remove(queue)
            logger.info(f"MCP chat stream disconnected. Remaining subscribers: {len(self.chat_subscribers)}")
        
        return response

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
    
    async def run_mcp_stdio(self):
        """Run the FastMCP server using stdio (for AI assistant integration)."""
        if not self.enable_mcp:
            logger.warning("MCP not enabled, skipping stdio server")
            return
        
        logger.info("Starting FastMCP stdio server...")
        await self.mcp_server.run_stdio_async()
    
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
        if self.enable_mcp:
            app.router.add_get('/mcp', self.handle_mcp_info)  # Discovery endpoint
            app.router.add_post('/mcp', self.handle_mcp_http)
            app.router.add_get('/mcp/chat/subscribe', self.handle_chat_sse)
            app.router.add_post('/mcp/stream/chat', self.handle_mcp_stream_chat)  # HTTP streaming for chat

        return app

    async def run(self, enable_stdio_mcp: bool = False):
        """Run the unified server."""
        app = self.create_app()
        
        # Get the current event loop
        loop = asyncio.get_event_loop()
        
        # Start file watcher
        self.start_file_watcher(loop)
        
        try:
            logger.info(f"Starting unified server on http://localhost:{self.port}")
            if self.enable_mcp:
                logger.info("MCP functionality enabled:")
                logger.info("  - HTTP endpoint: POST /mcp")
                if enable_stdio_mcp:
                    logger.info("  - stdio server: will start after HTTP server")
            
            runner = web.AppRunner(app)
            await runner.setup()
            site = web.TCPSite(runner, 'localhost', self.port)
            await site.start()
            
            logger.info(f"Server running at http://localhost:{self.port}")
            logger.info(f"Watching markdown files in: {self.default_markdown_dir.absolute()}")
            
            # Optionally start stdio MCP server in parallel
            if enable_stdio_mcp and self.enable_mcp:
                # Create a task for the stdio MCP server
                stdio_task = asyncio.create_task(self.run_mcp_stdio())
            
            # Keep the server running
            while True:
                await asyncio.sleep(1)
                
        except KeyboardInterrupt:
            logger.info("Server shutting down...")
        finally:
            self.stop_file_watcher()

def main():
    """Main entry point."""
    import argparse
    
    parser = argparse.ArgumentParser(description='Unified Markdown Live View Server with MCP Integration')
    parser.add_argument('--dir', default='markdown', help='Directory to watch for markdown files')
    parser.add_argument('--port', type=int, default=8080, help='Port to run server on')
    parser.add_argument('--disable-mcp', action='store_true', help='Disable MCP functionality')
    parser.add_argument('--mcp-stdio', action='store_true', help='Enable MCP stdio server alongside HTTP server')
    
    args = parser.parse_args()
    
    server = UnifiedMarkdownServer(args.dir, args.port, enable_mcp=not args.disable_mcp)
    
    try:
        asyncio.run(server.run(enable_stdio_mcp=args.mcp_stdio))
    except KeyboardInterrupt:
        logger.info("Server stopped by user")

if __name__ == '__main__':
    main()
