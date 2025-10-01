#!/usr/bin/env python3
"""
Unified Server for Markdown Live View with MCP Integration

Combines both the HTTP LiveView server and MCP server functionality into a single application.
Provides both web interface for viewing markdown files and MCP protocol support for AI assistants.
"""

import asyncio
import json
import logging
import os
import secrets
import time
from datetime import datetime
from pathlib import Path
from html import escape
from typing import Any, Dict, List, Optional
from urllib.parse import unquote
from aiohttp import web, WSMsgType
from aiohttp.web_response import Response
from watchdog.observers import Observer
from watchdog.events import FileSystemEventHandler

# Import MCP classes and functionality
from mcp.server import Server
from mcp.server.stdio import stdio_server
from mcp.types import (
    CallToolRequest,
    CallToolResult,
    ListToolsRequest,
    ListToolsResult,
    Tool,
    TextContent,
    DEFAULT_NEGOTIATED_VERSION,
    INTERNAL_ERROR,
    INVALID_PARAMS,
    INVALID_REQUEST,
    METHOD_NOT_FOUND,
    PARSE_ERROR,
    JSONRPCError
)

# Configure logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

INDEX_TEMPLATE_PLACEHOLDER = "__CURRENT_DIRECTORY__"
DEFAULT_UNIFIED_INDEX_TEMPLATE = """<!DOCTYPE html>
<html lang=\"en\">
<head>
    <meta charset=\"UTF-8\">
    <meta name=\"viewport\" content=\"width=device-width, initial-scale=1.0\">
    <title>Markdown Live View</title>
    <style>
        body {
            font-family: sans-serif;
            margin: 0;
            padding: 2rem;
            background-color: #121a22;
            color: #ddd;
        }
        code {
            background: #1d2a36;
            padding: 0.25rem 0.5rem;
            border-radius: 4px;
        }
    </style>
</head>
<body>
    <h1>Markdown Live View</h1>
    <p>Template file missing. Showing fallback page.</p>
    <p><strong>📁 Current Directory:</strong> <code>__CURRENT_DIRECTORY__</code></p>
</body>
</html>
"""

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
        self.observer = None
        self.enable_mcp = enable_mcp
        self.template_path = Path(__file__).resolve().parent / "templates" / "unified_index.html"
        self._mcp_client_capabilities: Dict[str, Any] | None = None
        self._mcp_initialized = False
        self._negotiated_protocol_version: str | int = DEFAULT_NEGOTIATED_VERSION
        self.sticky_files: Dict[str, str] = {}  # Maps directory path to sticky filename
        self.chat_messages: List[Dict[str, Any]] = []  # Store recent chat messages
        
        # Ensure default markdown directory exists
        self.default_markdown_dir.mkdir(exist_ok=True)
        
        # Initialize MCP server if enabled
        if self.enable_mcp:
            self.mcp_server = Server("markdown-liveview")
            self._register_mcp_tools()
            logger.info(f"MCP Server initialized for directory: {self.default_markdown_dir}")

    def _build_tool_definitions(self) -> List[Tool]:
        """Return the shared MCP tool definitions."""
        return [
            Tool(
                name="show_content",
                description="Create new markdown content that appears in the live view",
                inputSchema={
                    "type": "object",
                    "properties": {
                        "content": {
                            "type": "string",
                            "description": "Markdown content to create"
                        },
                        "title": {
                            "type": "string",
                            "description": "Optional descriptive title included in responses"
                        }
                    },
                    "required": ["content"]
                }
            ),
            Tool(
                name="list_content",
                description="List every markdown entry managed by the server",
                inputSchema={
                    "type": "object",
                    "properties": {},
                    "additionalProperties": False
                }
            ),
            Tool(
                name="view_content",
                description="Read markdown content using a File Id",
                inputSchema={
                    "type": "object",
                    "properties": {
                        "fileId": {
                            "type": "string",
                            "description": "The File Id that was returned when the content was created"
                        }
                    },
                    "required": ["fileId"]
                }
            ),
            Tool(
                name="update_content",
                description="Append to or replace existing markdown content",
                inputSchema={
                    "type": "object",
                    "properties": {
                        "fileId": {
                            "type": "string",
                            "description": "The File Id returned from show_content"
                        },
                        "content": {
                            "type": "string",
                            "description": "Markdown content to append or use when replacing"
                        },
                        "mode": {
                            "type": "string",
                            "enum": ["append", "replace"],
                            "description": "Whether to append to or replace the file content",
                            "default": "append"
                        }
                    },
                    "required": ["fileId", "content"]
                }
            ),
            Tool(
                name="remove_content",
                description="Delete markdown content using its File Id",
                inputSchema={
                    "type": "object",
                    "properties": {
                        "fileId": {
                            "type": "string",
                            "description": "The File Id returned from show_content"
                        }
                    },
                    "required": ["fileId"]
                }
            ),
            Tool(
                name="subscribe_chat",
                description="Subscribe to receive chat messages from the UI. After subscribing, use get_chat_messages to poll for new messages.",
                inputSchema={
                    "type": "object",
                    "properties": {},
                    "additionalProperties": False
                }
            ),
            Tool(
                name="get_chat_messages",
                description="Get recent chat messages from the UI. Returns messages since a given timestamp.",
                inputSchema={
                    "type": "object",
                    "properties": {
                        "since": {
                            "type": "number",
                            "description": "Unix timestamp - only return messages after this time. If not provided, returns all recent messages."
                        }
                    },
                    "additionalProperties": False
                }
            )
        ]

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

        init_options = self.mcp_server.create_initialization_options()
        server_info: Dict[str, Any] = {
            "name": init_options.server_name,
            "version": init_options.server_version,
        }

        if init_options.website_url:
            server_info["websiteUrl"] = init_options.website_url
        if init_options.icons:
            server_info["icons"] = [icon.model_dump(exclude_none=True) for icon in init_options.icons]

        init_result: Dict[str, Any] = {
            "protocolVersion": protocol_version,
            "capabilities": init_options.capabilities.model_dump(exclude_none=True),
            "serverInfo": server_info,
        }

        if init_options.instructions:
            init_result["instructions"] = init_options.instructions

        logger.info(
            "MCP initialize handshake (protocol=%s, client caps present=%s)",
            protocol_version,
            isinstance(capabilities, dict),
        )

        return init_result

    def _register_mcp_tools(self):
        """Register all available MCP tools."""

        @self.mcp_server.list_tools()
        async def list_tools() -> ListToolsResult:
            """List all available tools."""
            return ListToolsResult(tools=self._build_tool_definitions())
        
        @self.mcp_server.call_tool()
        async def call_tool(name: str, arguments: Dict[str, Any]) -> CallToolResult:
            """Handle tool calls."""
            try:
                legacy_aliases = {
                    "create_markdown_file": "show_content",
                    "list_markdown_files": "list_content",
                    "read_markdown_file": "view_content",
                    "update_markdown_file": "update_content",
                    "delete_markdown_file": "remove_content",
                }
                effective_name = legacy_aliases.get(name, name)

                if effective_name == "show_content":
                    return await self._show_content(
                        arguments.get("content", ""),
                        arguments.get("title")
                    )
                elif effective_name == "list_content":
                    return await self._list_content()
                elif effective_name == "view_content":
                    return await self._view_content(arguments.get("fileId") or arguments.get("filename", ""))
                elif effective_name == "update_content":
                    return await self._update_content(
                        arguments.get("fileId") or arguments.get("filename", ""),
                        arguments.get("content", ""),
                        arguments.get("mode", "append")
                    )
                elif effective_name == "remove_content":
                    return await self._remove_content(arguments.get("fileId") or arguments.get("filename", ""))
                elif effective_name == "subscribe_chat":
                    return await self._subscribe_chat()
                elif effective_name == "get_chat_messages":
                    return await self._get_chat_messages(arguments.get("since"))
                else:
                    raise JSONRPCError(METHOD_NOT_FOUND, f"Unknown tool: {name}")
            except Exception as e:
                logger.error(f"Error in tool call {name}: {e}")
                raise JSONRPCError(INTERNAL_ERROR, f"Tool execution failed: {e}")

    def _generate_file_id(self) -> str:
        """Generate a unique File Id for newly created content."""
        for _ in range(10):
            candidate = f"{secrets.token_hex(4)}.md"
            if not (self.default_markdown_dir / candidate).exists():
                return candidate
        raise JSONRPCError(INTERNAL_ERROR, "Unable to allocate a unique File Id")

    def _sanitize_file_id(self, file_id: str) -> str:
        """Ensure the provided File Id maps to a safe filename."""
        sanitized = Path(file_id).name
        if not sanitized.endswith('.md'):
            sanitized += '.md'
        return sanitized

    async def _show_content(self, content: str, title: Optional[str] = None) -> CallToolResult:
        """Create a new markdown file using a generated File Id."""
        if not content:
            raise JSONRPCError(INTERNAL_ERROR, "Content cannot be empty")

        file_id = self._generate_file_id()
        file_path = self.default_markdown_dir / file_id

        try:
            file_path.write_text(content, encoding='utf-8')
            logger.info(f"Created markdown file: {file_id}")

            display_title = f" '{title}'" if title else ""
            message = (
                f"Created new markdown{display_title} entry.\n"
                f"File Id: {file_id}"
            )

            return CallToolResult(
                content=[TextContent(type="text", text=message)]
            )

        except Exception as e:
            logger.error(f"Error creating file: {e}")
            raise JSONRPCError(INTERNAL_ERROR, f"Failed to create file: {e}")

    async def _list_content(self) -> CallToolResult:
        """List all markdown files in the directory."""
        try:
            md_files = sorted(self.default_markdown_dir.glob('*.md'))
            file_info = []

            for file_path in md_files:
                try:
                    stat = file_path.stat()
                    size = stat.st_size
                    modified = datetime.fromtimestamp(stat.st_mtime).strftime('%Y-%m-%d %H:%M:%S')
                    file_info.append(f"📄 {file_path.name} ({size} bytes, modified: {modified})")
                except Exception as e:
                    file_info.append(f"📄 {file_path.name} (error reading info: {e})")
            
            if not file_info:
                result_text = "No markdown files found in the directory."
            else:
                result_text = f"Found {len(file_info)} markdown files:\n\n" + "\n".join(file_info)
            
            return CallToolResult(
                content=[TextContent(
                    type="text",
                    text=result_text
                )]
            )

        except Exception as e:
            logger.error(f"Error listing files: {e}")
            raise JSONRPCError(INTERNAL_ERROR, f"Failed to list files: {e}")

    async def _view_content(self, fileId: str) -> CallToolResult:  # type: ignore[override]
        """Read the content of a specific markdown file."""
        if not fileId:
            raise JSONRPCError(INTERNAL_ERROR, "File Id cannot be empty")

        filename = self._sanitize_file_id(fileId)
        file_path = self.default_markdown_dir / filename

        if not file_path.exists():
            raise JSONRPCError(INTERNAL_ERROR, f"File '{filename}' does not exist")

        try:
            content = file_path.read_text(encoding='utf-8')

            return CallToolResult(
                content=[TextContent(
                    type="text",
                    text=f"Content of '{filename}':\n\n{content}"
                )]
            )

        except Exception as e:
            logger.error(f"Error reading file: {e}")
            raise JSONRPCError(INTERNAL_ERROR, f"Failed to read file: {e}")

    async def _update_content(self, fileId: str, content: str, mode: str = "append") -> CallToolResult:  # type: ignore[override]
        """Update or append to an existing markdown file."""
        if not fileId:
            raise JSONRPCError(INTERNAL_ERROR, "File Id cannot be empty")

        filename = self._sanitize_file_id(fileId)
        file_path = self.default_markdown_dir / filename

        if not file_path.exists():
            raise JSONRPCError(INTERNAL_ERROR, f"File '{filename}' does not exist")

        try:
            if mode == "replace":
                file_path.write_text(content, encoding='utf-8')
                action = "replaced"
            else:  # append
                existing_content = file_path.read_text(encoding='utf-8')
                new_content = existing_content + '\n\n' + content
                file_path.write_text(new_content, encoding='utf-8')
                action = "appended to"

            logger.info(f"Updated markdown file: {filename} ({mode} mode)")

            return CallToolResult(
                content=[TextContent(
                    type="text",
                    text=f"Successfully {action} file '{filename}'."
                )]
            )

        except Exception as e:
            logger.error(f"Error updating file: {e}")
            raise JSONRPCError(INTERNAL_ERROR, f"Failed to update file: {e}")

    async def _remove_content(self, fileId: str) -> CallToolResult:  # type: ignore[override]
        """Delete a markdown file."""
        if not fileId:
            raise JSONRPCError(INTERNAL_ERROR, "File Id cannot be empty")

        filename = self._sanitize_file_id(fileId)
        file_path = self.default_markdown_dir / filename

        if not file_path.exists():
            raise JSONRPCError(INTERNAL_ERROR, f"File '{filename}' does not exist")

        try:
            file_path.unlink()
            logger.info(f"Deleted markdown file: {filename}")

            return CallToolResult(
                content=[TextContent(
                    type="text",
                    text=f"Successfully deleted file '{filename}'."
                )]
            )

        except Exception as e:
            logger.error(f"Error deleting file: {e}")
            raise JSONRPCError(INTERNAL_ERROR, f"Failed to delete file: {e}")
    
    async def _subscribe_chat(self) -> CallToolResult:
        """Subscribe to chat messages from the UI."""
        return CallToolResult(
            content=[TextContent(
                type="text",
                text="Successfully subscribed to chat messages. Use the 'get_chat_messages' tool to poll for new messages from the UI. Messages are stored with timestamps, so you can track which ones you've already processed."
            )]
        )
    
    async def _get_chat_messages(self, since: Optional[float] = None) -> CallToolResult:
        """Get chat messages since a given timestamp."""
        try:
            if since is None:
                # Return all messages
                messages = self.chat_messages
            else:
                # Return only messages after the given timestamp
                messages = [msg for msg in self.chat_messages if msg['timestamp'] > since]
            
            if not messages:
                return CallToolResult(
                    content=[TextContent(
                        type="text",
                        text="No new chat messages."
                    )]
                )
            
            # Format messages
            message_lines = []
            for msg in messages:
                timestamp_str = datetime.fromtimestamp(msg['timestamp']).strftime('%Y-%m-%d %H:%M:%S')
                message_lines.append(f"[{timestamp_str}] {msg['message']}")
            
            result_text = f"Found {len(messages)} chat message(s):\n\n" + "\n".join(message_lines)
            
            return CallToolResult(
                content=[TextContent(
                    type="text",
                    text=result_text
                )]
            )
        except Exception as e:
            logger.error(f"Error getting chat messages: {e}")
            raise JSONRPCError(INTERNAL_ERROR, f"Failed to get chat messages: {e}")
    
    # LiveView server methods (copied and adapted from server.py)
    def resolve_markdown_path(self, path_param: str = None) -> Path:
        """Resolve the markdown directory path from various sources."""
        # Priority order:
        # 1. Query parameter: ?path=/some/path
        # 2. Environment variable: LIVEVIEW_PATH
        # 3. Default directory from constructor
        
        target_path = None
        
        if path_param:
            # Handle query parameter
            target_path = Path(unquote(path_param)).expanduser().resolve()
            logger.info(f"Using path from query parameter: {target_path}")
        else:
            # Check environment variable
            env_path = os.environ.get('LIVEVIEW_PATH')
            if env_path:
                target_path = Path(env_path).expanduser().resolve()
                logger.info(f"Using path from environment variable: {target_path}")
            else:
                # Use default
                target_path = self.default_markdown_dir
                logger.info(f"Using default path: {target_path}")
        
        return target_path
    
    def get_fallback_content(self, requested_path: Path) -> str:
        """Generate fallback markdown content when directory is missing or empty."""
        return f"""# 📁 Directory Not Found or Empty

The requested directory could not be accessed or contains no markdown files.

**Requested Path:** `{requested_path}`

## What happened?

- The directory doesn't exist, or
- The directory exists but contains no `.md` files, or  
- There was a permission error accessing the directory

## How to fix this:

1. **Check the path**: Make sure the directory exists and contains `.md` files
2. **Check permissions**: Ensure the server can read the directory
3. **Use query parameter**: Try `?path=/your/markdown/directory`
4. **Use environment variable**: Set `LIVEVIEW_PATH=/your/markdown/directory`

## Examples:

- **Query string**: `http://localhost:8080/?path=~/Documents/notes`
- **Environment variable**: `LIVEVIEW_PATH=~/git/project/docs ./run.sh`

## Get started:

Create some `.md` files in your directory and refresh this page!
"""
    
    def get_markdown_files(self, custom_path: Path = None) -> List[Dict[str, Any]]:
        """Get all markdown files sorted by creation time."""
        files = []
        target_dir = custom_path if custom_path else self.markdown_dir
        
        if not target_dir.exists():
            logger.warning(f"Directory does not exist: {target_dir}")
            # Return fallback content
            fallback_time = time.time()
            return [{
                'path': target_dir / 'fallback.md',
                'name': 'Directory Not Found',
                'created': fallback_time,
                'updated': fallback_time,
                'sort_key': fallback_time,
                'content': self.get_fallback_content(target_dir)
            }]
            
        md_files = list(target_dir.glob('*.md'))
        if not md_files:
            logger.warning(f"No markdown files found in: {target_dir}")
            # Return fallback content for empty directory
            fallback_time = time.time()
            return [{
                'path': target_dir / 'fallback.md', 
                'name': 'No Markdown Files Found',
                'created': fallback_time,
                'updated': fallback_time,
                'sort_key': fallback_time,
                'content': self.get_fallback_content(target_dir)
            }]
            
        for md_file in md_files:
            try:
                stat = md_file.stat()
                content = md_file.read_text(encoding='utf-8')
                created_ts = getattr(stat, 'st_birthtime', stat.st_ctime)
                updated_ts = max(stat.st_mtime, created_ts)
                files.append({
                    'path': md_file,
                    'name': md_file.name,
                    'created': created_ts,
                    'updated': stat.st_mtime,
                    'sort_key': updated_ts,
                    'content': content
                })
            except Exception as e:
                logger.warning(f"Could not read file {md_file}: {e}")
                # Add a placeholder for unreadable files
                error_time = time.time()
                files.append({
                    'path': md_file,
                    'name': md_file.name,
                    'created': error_time,
                    'updated': error_time,
                    'sort_key': error_time,
                    'content': f"# Error Reading File\n\nCould not read `{md_file.name}`: {e}"
                })

        # Sort by most recent update time so fresh changes stay at the top
        files.sort(key=lambda x: x['sort_key'], reverse=True)
        
        # Move sticky file to the top if one exists for this directory
        sticky_filename = self.sticky_files.get(str(target_dir))
        if sticky_filename:
            sticky_index = None
            for i, file_info in enumerate(files):
                if file_info['name'] == sticky_filename:
                    sticky_index = i
                    break
            
            if sticky_index is not None and sticky_index > 0:
                # Move sticky file to the beginning
                sticky_file = files.pop(sticky_index)
                files.insert(0, sticky_file)
        
        return files
    
    def get_unified_markdown(self, custom_path: Path = None) -> str:
        """Get all markdown content unified into a single string."""
        files = self.get_markdown_files(custom_path)
        if not files:
            return "# No Markdown Files Found\n\nNo `.md` files were found in the specified directory."
        
        unified_content = []
        for file_info in files:
            content = file_info['content']
            # Add separator between files (except for the first one)
            if unified_content:
                unified_content.append("\n\n---\n\n")
            unified_content.append(content)
        
        return "".join(unified_content)
    
    def load_index_template(self) -> str:
        """Load unified index template from disk, falling back to a minimal version."""
        try:
            return self.template_path.read_text(encoding='utf-8')
        except FileNotFoundError:
            logger.error(f"Template file not found: {self.template_path}")
        except Exception as exc:
            logger.error(f"Error reading template {self.template_path}: {exc}")
        return DEFAULT_UNIFIED_INDEX_TEMPLATE

    def render_index_template(self, target_path: Path) -> str:
        """Populate the template with runtime values."""
        template = self.load_index_template()
        safe_path = escape(str(target_path))
        return template.replace(INDEX_TEMPLATE_PLACEHOLDER, safe_path)

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
        
        return web.json_response({
            'content': unified_content,
            'files': len(files),
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
                legacy_aliases = {
                    "create_markdown_file": "show_content",
                    "list_markdown_files": "list_content",
                    "read_markdown_file": "view_content",
                    "update_markdown_file": "update_content",
                    "delete_markdown_file": "remove_content",
                }
                effective_name = legacy_aliases.get(tool_name, tool_name)

                if effective_name == "show_content":
                    result = await self._show_content(
                        arguments.get("content", ""),
                        arguments.get("title")
                    )
                elif effective_name == "list_content":
                    result = await self._list_content()
                elif effective_name == "view_content":
                    result = await self._view_content(arguments.get("fileId") or arguments.get("filename", ""))
                elif effective_name == "update_content":
                    result = await self._update_content(
                        arguments.get("fileId") or arguments.get("filename", ""),
                        arguments.get("content", ""),
                        arguments.get("mode", "append")
                    )
                elif effective_name == "remove_content":
                    result = await self._remove_content(arguments.get("fileId") or arguments.get("filename", ""))
                elif effective_name == "subscribe_chat":
                    result = await self._subscribe_chat()
                elif effective_name == "get_chat_messages":
                    result = await self._get_chat_messages(arguments.get("since"))
                else:
                    return jsonrpc_error(METHOD_NOT_FOUND, f"Unknown tool: {tool_name}")
            except JSONRPCError as rpc_error:  # pragma: no cover - defensive while tooling stabilises
                logger.error(f"MCP tool returned JSONRPCError: {rpc_error}")
                return web.json_response(
                    rpc_error.model_dump(exclude_none=True),
                    status=400,
                )
            except Exception as exc:
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
    
    async def broadcast_chat_to_mcp(self, message: str):
        """Broadcast chat message to all connected MCP clients."""
        # Store the message for polling
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
        """Run the MCP server using stdio (for AI assistant integration)."""
        if not self.enable_mcp:
            logger.warning("MCP not enabled, skipping stdio server")
            return
        
        logger.info("Starting MCP stdio server...")
        async with stdio_server() as streams:
            await self.mcp_server.run(streams[0], streams[1], self.mcp_server.create_initialization_options())
    
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
            app.router.add_post('/mcp', self.handle_mcp_http)

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
