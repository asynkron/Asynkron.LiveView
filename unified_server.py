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
import time
from datetime import datetime
from pathlib import Path
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
    INTERNAL_ERROR,
    METHOD_NOT_FOUND,
    JSONRPCError
)

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
        self.observer = None
        self.enable_mcp = enable_mcp
        
        # Ensure default markdown directory exists
        self.default_markdown_dir.mkdir(exist_ok=True)
        
        # Initialize MCP server if enabled
        if self.enable_mcp:
            self.mcp_server = Server("markdown-liveview")
            self._register_mcp_tools()
            logger.info(f"MCP Server initialized for directory: {self.default_markdown_dir}")
    
    def _register_mcp_tools(self):
        """Register all available MCP tools."""
        
        @self.mcp_server.list_tools()
        async def list_tools() -> ListToolsResult:
            """List all available tools."""
            tools = [
                Tool(
                    name="create_markdown_file",
                    description="Create a new markdown file with the given content",
                    inputSchema={
                        "type": "object",
                        "properties": {
                            "filename": {
                                "type": "string",
                                "description": "Name of the markdown file (without .md extension)"
                            },
                            "content": {
                                "type": "string",
                                "description": "Markdown content to write to the file"
                            },
                            "prefix": {
                                "type": "string",
                                "description": "Optional timestamp prefix (e.g., '01-', '02-'). If not provided, will auto-generate based on existing files.",
                                "default": ""
                            }
                        },
                        "required": ["filename", "content"]
                    }
                ),
                Tool(
                    name="list_markdown_files",
                    description="List all markdown files in the directory",
                    inputSchema={
                        "type": "object",
                        "properties": {},
                        "additionalProperties": False
                    }
                ),
                Tool(
                    name="read_markdown_file",
                    description="Read the content of a specific markdown file",
                    inputSchema={
                        "type": "object",
                        "properties": {
                            "filename": {
                                "type": "string",
                                "description": "Name of the markdown file (with or without .md extension)"
                            }
                        },
                        "required": ["filename"]
                    }
                ),
                Tool(
                    name="update_markdown_file",
                    description="Update or append to an existing markdown file",
                    inputSchema={
                        "type": "object",
                        "properties": {
                            "filename": {
                                "type": "string",
                                "description": "Name of the markdown file (with or without .md extension)"
                            },
                            "content": {
                                "type": "string",
                                "description": "Content to add to the file"
                            },
                            "mode": {
                                "type": "string",
                                "enum": ["append", "replace"],
                                "description": "Whether to append to or replace the file content",
                                "default": "append"
                            }
                        },
                        "required": ["filename", "content"]
                    }
                ),
                Tool(
                    name="delete_markdown_file",
                    description="Delete a markdown file",
                    inputSchema={
                        "type": "object",
                        "properties": {
                            "filename": {
                                "type": "string",
                                "description": "Name of the markdown file (with or without .md extension)"
                            }
                        },
                        "required": ["filename"]
                    }
                )
            ]
            return ListToolsResult(tools=tools)
        
        @self.mcp_server.call_tool()
        async def call_tool(name: str, arguments: Dict[str, Any]) -> CallToolResult:
            """Handle tool calls."""
            try:
                if name == "create_markdown_file":
                    return await self._create_markdown_file(
                        arguments.get("filename", ""),
                        arguments.get("content", ""),
                        arguments.get("prefix", "")
                    )
                elif name == "list_markdown_files":
                    return await self._list_markdown_files()
                elif name == "read_markdown_file":
                    return await self._read_markdown_file(arguments.get("filename", ""))
                elif name == "update_markdown_file":
                    return await self._update_markdown_file(
                        arguments.get("filename", ""),
                        arguments.get("content", ""),
                        arguments.get("mode", "append")
                    )
                elif name == "delete_markdown_file":
                    return await self._delete_markdown_file(arguments.get("filename", ""))
                else:
                    raise JSONRPCError(METHOD_NOT_FOUND, f"Unknown tool: {name}")
            except Exception as e:
                logger.error(f"Error in tool call {name}: {e}")
                raise JSONRPCError(INTERNAL_ERROR, f"Tool execution failed: {e}")
    
    def _generate_next_prefix(self) -> str:
        """Generate the next numbered prefix for a markdown file."""
        existing_files = list(self.default_markdown_dir.glob('*.md'))
        max_prefix = 0
        
        for file in existing_files:
            name = file.stem
            if '-' in name:
                prefix_part = name.split('-')[0]
                if prefix_part.isdigit():
                    max_prefix = max(max_prefix, int(prefix_part))
        
        return f"{max_prefix + 1:02d}-"
    
    async def _create_markdown_file(self, filename: str, content: str, prefix: str = "") -> CallToolResult:
        """Create a new markdown file."""
        if not filename:
            raise JSONRPCError(INTERNAL_ERROR, "Filename cannot be empty")
        
        # Add .md extension if not present
        if not filename.endswith('.md'):
            filename += '.md'
        
        # Add prefix if not provided
        if not prefix and not filename[0].isdigit():
            prefix = self._generate_next_prefix()
        
        final_filename = f"{prefix}{filename}"
        file_path = self.default_markdown_dir / final_filename
        
        # Check if file already exists
        if file_path.exists():
            raise JSONRPCError(INTERNAL_ERROR, f"File '{final_filename}' already exists")
        
        try:
            file_path.write_text(content, encoding='utf-8')
            logger.info(f"Created markdown file: {final_filename}")
            
            return CallToolResult(
                content=[TextContent(
                    type="text",
                    text=f"Successfully created file '{final_filename}' with {len(content)} characters."
                )]
            )
            
        except Exception as e:
            logger.error(f"Error creating file: {e}")
            raise JSONRPCError(INTERNAL_ERROR, f"Failed to create file: {e}")
    
    async def _list_markdown_files(self) -> CallToolResult:
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
    
    async def _read_markdown_file(self, filename: str) -> CallToolResult:
        """Read the content of a specific markdown file."""
        if not filename:
            raise JSONRPCError(INTERNAL_ERROR, "Filename cannot be empty")
        
        # Add .md extension if not present
        if not filename.endswith('.md'):
            filename += '.md'
        
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
    
    async def _update_markdown_file(self, filename: str, content: str, mode: str = "append") -> CallToolResult:
        """Update or append to an existing markdown file."""
        if not filename:
            raise JSONRPCError(INTERNAL_ERROR, "Filename cannot be empty")
        
        # Add .md extension if not present
        if not filename.endswith('.md'):
            filename += '.md'
        
        file_path = self.default_markdown_dir / filename
        
        if not file_path.exists():
            raise JSONRPCError(INTERNAL_ERROR, f"File '{filename}' does not exist")
        
        try:
            if mode == "replace":
                file_path.write_text(content, encoding='utf-8')
                action = "replaced"
            else:  # append
                existing_content = file_path.read_text(encoding='utf-8')
                new_content = existing_content + content
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
    
    async def _delete_markdown_file(self, filename: str) -> CallToolResult:
        """Delete a markdown file."""
        if not filename:
            raise JSONRPCError(INTERNAL_ERROR, "Filename cannot be empty")
        
        # Add .md extension if not present
        if not filename.endswith('.md'):
            filename += '.md'
        
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
            return [{
                'path': target_dir / 'fallback.md',
                'name': 'Directory Not Found',
                'created': time.time(),
                'content': self.get_fallback_content(target_dir)
            }]
            
        md_files = list(target_dir.glob('*.md'))
        if not md_files:
            logger.warning(f"No markdown files found in: {target_dir}")
            # Return fallback content for empty directory
            return [{
                'path': target_dir / 'fallback.md', 
                'name': 'No Markdown Files Found',
                'created': time.time(),
                'content': self.get_fallback_content(target_dir)
            }]
            
        for md_file in md_files:
            try:
                stat = md_file.stat()
                content = md_file.read_text(encoding='utf-8')
                files.append({
                    'path': md_file,
                    'name': md_file.name,
                    'created': stat.st_ctime,
                    'content': content
                })
            except Exception as e:
                logger.warning(f"Could not read file {md_file}: {e}")
                # Add a placeholder for unreadable files
                files.append({
                    'path': md_file,
                    'name': md_file.name,
                    'created': time.time(),
                    'content': f"# Error Reading File\n\nCould not read `{md_file.name}`: {e}"
                })
        
        # Sort by creation time
        files.sort(key=lambda x: x['created'])
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
    
    async def handle_index(self, request):
        """Serve the main HTML page."""
        # Get optional path parameter
        path_param = request.query.get('path')
        
        # Update the active directory
        self.markdown_dir = self.resolve_markdown_path(path_param)
        
        return Response(text=f"""
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Markdown Live View</title>
    <style>
        * {{
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }}
        
        body {{
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', 'Helvetica Neue', Arial, sans-serif;
            line-height: 1.6;
            color: #e0e6ed;
            background-color: #0d1117;
            padding: 20px;
        }}
        
        .container {{
            max-width: 1200px;
            margin: 0 auto;
        }}
        
        .header {{
            text-align: center;
            margin-bottom: 30px;
            padding: 20px;
            background: linear-gradient(135deg, #1f2a33 0%, #253548 100%);
            border-radius: 12px;
            border: 1px solid #3d4f5c;
        }}
        
        .header h1 {{
            font-size: 2.5rem;
            margin-bottom: 10px;
            background: linear-gradient(135deg, #58a6ff 0%, #79c0ff 100%);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
            background-clip: text;
        }}
        
        .header p {{
            color: #7d8590;
            font-size: 1.1rem;
        }}
        
        .directory-info {{
            background: #161b22;
            border: 1px solid #30363d;
            border-radius: 8px;
            padding: 15px;
            margin-bottom: 20px;
        }}
        
        .directory-info strong {{
            color: #58a6ff;
        }}
        
        #content {{
            background: #0d1117;
            border: 1px solid #30363d;
            border-radius: 8px;
            padding: 30px;
            min-height: 400px;
        }}
        
        /* Markdown styles */
        #content h1, #content h2, #content h3, #content h4, #content h5, #content h6 {{
            color: #f0f6fc;
            margin-top: 24px;
            margin-bottom: 16px;
            font-weight: 600;
            line-height: 1.25;
        }}
        
        #content h1 {{
            font-size: 2rem;
            border-bottom: 1px solid #21262d;
            padding-bottom: 8px;
        }}
        
        #content h2 {{
            font-size: 1.5rem;
            border-bottom: 1px solid #21262d;
            padding-bottom: 8px;
        }}
        
        #content p {{
            margin-bottom: 16px;
        }}
        
        #content ul, #content ol {{
            margin-bottom: 16px;
            padding-left: 32px;
        }}
        
        #content li {{
            margin-bottom: 4px;
        }}
        
        #content blockquote {{
            margin: 16px 0;
            padding: 0 16px;
            border-left: 4px solid #58a6ff;
            color: #7d8590;
        }}
        
        #content code {{
            background: #161b22;
            border: 1px solid #30363d;
            border-radius: 6px;
            padding: 2px 6px;
            font-family: 'SF Mono', Monaco, 'Cascadia Code', 'Roboto Mono', Consolas, 'Courier New', monospace;
            font-size: 85%;
        }}
        
        #content pre {{
            background: #161b22;
            border: 1px solid #30363d;
            border-radius: 6px;
            padding: 16px;
            overflow-x: auto;
            margin: 16px 0;
        }}
        
        #content pre code {{
            background: none;
            border: none;
            padding: 0;
            font-size: 85%;
        }}
        
        #content a {{
            color: #58a6ff;
            text-decoration: none;
        }}
        
        #content a:hover {{
            text-decoration: underline;
        }}
        
        #content table {{
            border-collapse: collapse;
            width: 100%;
            margin: 16px 0;
        }}
        
        #content th, #content td {{
            border: 1px solid #30363d;
            padding: 8px 12px;
            text-align: left;
        }}
        
        #content th {{
            background: #161b22;
            font-weight: 600;
        }}
        
        #content hr {{
            border: none;
            border-top: 1px solid #30363d;
            margin: 24px 0;
        }}
        
        /* Mermaid diagram styles */
        .mermaid {{
            text-align: center;
            margin: 20px 0;
        }}
        
        /* Status indicator */
        .status {{
            position: fixed;
            top: 20px;
            right: 20px;
            padding: 8px 16px;
            border-radius: 20px;
            font-size: 12px;
            font-weight: 500;
            z-index: 1000;
        }}
        
        .status.connected {{
            background: #1a7f37;
            color: white;
        }}
        
        .status.disconnected {{
            background: #cf222e;
            color: white;
        }}
        
        /* Loading animation */
        .loading {{
            text-align: center;
            color: #7d8590;
            font-style: italic;
        }}
        
        /* Code highlighting */
        .hljs {{
            background: #161b22 !important;
        }}
    </style>
    
    <script src="https://cdnjs.cloudflare.com/ajax/libs/marked/14.1.2/marked.min.js" defer=""></script>
    <script src="https://cdnjs.cloudflare.com/ajax/libs/mermaid/10.9.1/mermaid.min.js" defer=""></script>
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/styles/github-dark.min.css">
    <script src="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/highlight.min.js" defer=""></script>
    <script>
        window.addEventListener('DOMContentLoaded', () => {{
            let ws = null;
            let reconnectAttempts = 0;
            const maxReconnectAttempts = 5;
            let mermaidReady = false;
            let mermaidIdCounter = 0;
            let markedRenderer = null;
            const textEncoder = new TextEncoder();
            const textDecoder = new TextDecoder();

            function waitForLibraries(maxRetries = 50, intervalMs = 100) {{
                return new Promise((resolve, reject) => {{
                    let attempts = 0;
                    const check = () => {{
                        if (typeof marked !== 'undefined' && typeof mermaid !== 'undefined' && typeof hljs !== 'undefined') {{
                            resolve();
                        }} else if (attempts >= maxRetries) {{
                            reject(new Error('Required libraries failed to load'));
                        }} else {{
                            attempts += 1;
                            setTimeout(check, intervalMs);
                        }}
                    }};
                    check();
                }});
            }}

            function initializeMermaid() {{
                if (typeof mermaid === 'undefined') {{
                    console.warn('Mermaid not available');
                    mermaidReady = false;
                    return;
                }}

                try {{
                    mermaid.initialize({{
                        startOnLoad: false,
                        theme: 'dark',
                        securityLevel: 'loose',
                        themeVariables: {{
                            background: '#121a22',
                            primaryColor: '#1f2a33',
                            secondaryColor: '#253548',
                            primaryTextColor: '#e0e6ed',
                            primaryBorderColor: '#3d4f5c',
                            lineColor: '#7d8590',
                            tertiaryColor: '#161b22',
                            cScale0: '#58a6ff',
                            cScale1: '#79c0ff',
                            cScale2: '#a5f3fc'
                        }}
                    }});
                    mermaidReady = true;
                    console.log('Mermaid initialized successfully');
                }} catch (error) {{
                    console.error('Failed to initialize Mermaid:', error);
                    mermaidReady = false;
                }}
            }}

            function setupMarked() {{
                if (typeof marked === 'undefined') {{
                    console.warn('Marked not available');
                    return;
                }}

                markedRenderer = new marked.Renderer();
                
                const originalCodeRenderer = markedRenderer.code;
                markedRenderer.code = function(code, language) {{
                    if (language === 'mermaid' && mermaidReady) {{
                        const id = `mermaid-${{mermaidIdCounter++}}`;
                        setTimeout(() => {{
                            const element = document.getElementById(id);
                            if (element) {{
                                try {{
                                    mermaid.render(`${{id}}-svg`, code).then(result => {{
                                        element.innerHTML = result.svg;
                                    }}).catch(error => {{
                                        console.error('Mermaid rendering error:', error);
                                        element.innerHTML = `<div style="color: #cf222e; border: 1px solid #cf222e; padding: 10px; border-radius: 4px;">
                                            <strong>Mermaid Error:</strong><br>
                                            <code>${{error.message || 'Unknown error'}}</code>
                                        </div>`;
                                    }});
                                }} catch (error) {{
                                    console.error('Mermaid rendering error:', error);
                                    element.innerHTML = `<div style="color: #cf222e;">Mermaid Error: ${{error.message}}</div>`;
                                }}
                            }}
                        }}, 0);
                        return `<div id="${{id}}" class="mermaid">${{code}}</div>`;
                    }}
                    return originalCodeRenderer.call(this, code, language);
                }};

                marked.setOptions({{
                    renderer: markedRenderer,
                    highlight: function(code, lang) {{
                        if (typeof hljs !== 'undefined' && lang && hljs.getLanguage(lang)) {{
                            try {{
                                return hljs.highlight(code, {{ language: lang }}).value;
                            }} catch (err) {{
                                console.warn('Highlight.js error:', err);
                            }}
                        }}
                        return code;
                    }},
                    breaks: true,
                    gfm: true
                }});
            }}

            function updateStatus(connected) {{
                const status = document.querySelector('.status') || createStatusElement();
                if (connected) {{
                    status.textContent = '🟢 Connected';
                    status.className = 'status connected';
                }} else {{
                    status.textContent = '🔴 Disconnected';
                    status.className = 'status disconnected';
                }}
            }}

            function createStatusElement() {{
                const status = document.createElement('div');
                status.className = 'status';
                document.body.appendChild(status);
                return status;
            }}

            function connectWebSocket() {{
                const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
                const wsUrl = `${{protocol}}//${{window.location.host}}/ws${{window.location.search}}`;
                
                ws = new WebSocket(wsUrl);
                
                ws.onopen = function() {{
                    console.log('WebSocket connected');
                    updateStatus(true);
                    reconnectAttempts = 0;
                    loadContent();
                }};
                
                ws.onmessage = function(event) {{
                    console.log('Received WebSocket message:', event.data);
                    const data = JSON.parse(event.data);
                    if (data.type === 'content_update') {{
                        updateContent(data.content);
                    }}
                }};
                
                ws.onclose = function() {{
                    console.log('WebSocket disconnected');
                    updateStatus(false);
                    attemptReconnect();
                }};
                
                ws.onerror = function(error) {{
                    console.error('WebSocket error:', error);
                    updateStatus(false);
                }};
            }}

            function attemptReconnect() {{
                if (reconnectAttempts < maxReconnectAttempts) {{
                    reconnectAttempts++;
                    console.log(`Attempting to reconnect... (${{reconnectAttempts}}/${{maxReconnectAttempts}})`);
                    setTimeout(connectWebSocket, Math.pow(2, reconnectAttempts) * 1000);
                }} else {{
                    console.error('Max reconnection attempts reached');
                }}
            }}

            async function loadContent() {{
                try {{
                    const response = await fetch(`/api/content${{window.location.search}}`);
                    const data = await response.json();
                    updateContent(data.content);
                    
                    // Update directory info
                    const directoryInfo = document.querySelector('.directory-info');
                    if (directoryInfo) {{
                        directoryInfo.innerHTML = `<strong>📁 Directory:</strong> ${{data.directory}} | <strong>📄 Files:</strong> ${{data.files}} | <strong>🕒 Last Updated:</strong> ${{new Date(data.timestamp * 1000).toLocaleString()}}`;
                    }}
                }} catch (error) {{
                    console.error('Error loading content:', error);
                    document.getElementById('content').innerHTML = '<div class="loading">❌ Error loading content</div>';
                }}
            }}

            function updateContent(markdownContent) {{
                if (typeof marked === 'undefined') {{
                    document.getElementById('content').innerHTML = '<div class="loading">⏳ Loading markdown renderer...</div>';
                    return;
                }}

                try {{
                    const html = marked.parse(markdownContent);
                    document.getElementById('content').innerHTML = html;
                    
                    // Highlight code blocks
                    if (typeof hljs !== 'undefined') {{
                        document.querySelectorAll('pre code').forEach((block) => {{
                            hljs.highlightElement(block);
                        }});
                    }}
                }} catch (error) {{
                    console.error('Error rendering markdown:', error);
                    document.getElementById('content').innerHTML = `<div style="color: #cf222e;">Error rendering markdown: ${{error.message}}</div>`;
                }}
            }}

            // Initialize everything
            waitForLibraries()
                .then(() => {{
                    console.log('All libraries loaded successfully');
                    initializeMermaid();
                    setupMarked();
                    connectWebSocket();
                }})
                .catch((error) => {{
                    console.error('Failed to load required libraries:', error);
                    document.getElementById('content').innerHTML = '<div class="loading">❌ Failed to load required libraries</div>';
                }});
        }});
    </script>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>📝 Markdown Live View</h1>
            <p>Real-time markdown file viewer with MCP integration</p>
        </div>
        
        <div class="directory-info">
            <strong>📁 Directory:</strong> {self.markdown_dir} | <strong>📄 Files:</strong> Loading... | <strong>🕒 Last Updated:</strong> Loading...
        </div>
        
        <div id="content" class="loading">
            ⏳ Loading content...
        </div>
    </div>
</body>
</html>
        """, content_type='text/html')
    
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
                if msg.type == WSMsgType.ERROR:
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
        
        return web.json_response({
            'content': unified_content,
            'files': len(files),
            'timestamp': time.time(),
            'directory': str(target_directory)
        })
    
    async def handle_raw_markdown(self, request):
        """Serve unified markdown content as plain text."""
        # Get optional path parameter
        path_param = request.query.get('path')
        target_directory = self.resolve_markdown_path(path_param)
        
        unified_content = self.get_unified_markdown(target_directory)
        return Response(text=unified_content, content_type='text/plain', charset='utf-8')
    
    async def handle_mcp_http(self, request):
        """HTTP endpoint for MCP protocol (JSON-RPC over HTTP)."""
        if not self.enable_mcp:
            return web.json_response({'error': 'MCP not enabled'}, status=503)
        
        try:
            data = await request.json()
            
            # Handle different MCP methods
            method = data.get('method')
            params = data.get('params', {})
            request_id = data.get('id')
            
            if method == 'tools/list':
                tools = []
                # Manually create tools list since we can't easily call the decorated function
                tools = [
                    {
                        "name": "create_markdown_file",
                        "description": "Create a new markdown file with the given content",
                        "inputSchema": {
                            "type": "object",
                            "properties": {
                                "filename": {"type": "string", "description": "Name of the markdown file (without .md extension)"},
                                "content": {"type": "string", "description": "Markdown content to write to the file"},
                                "prefix": {"type": "string", "description": "Optional timestamp prefix", "default": ""}
                            },
                            "required": ["filename", "content"]
                        }
                    },
                    {
                        "name": "list_markdown_files",
                        "description": "List all markdown files in the directory",
                        "inputSchema": {"type": "object", "properties": {}, "additionalProperties": False}
                    },
                    {
                        "name": "read_markdown_file", 
                        "description": "Read the content of a specific markdown file",
                        "inputSchema": {
                            "type": "object",
                            "properties": {"filename": {"type": "string", "description": "Name of the markdown file"}},
                            "required": ["filename"]
                        }
                    },
                    {
                        "name": "update_markdown_file",
                        "description": "Update or append to an existing markdown file", 
                        "inputSchema": {
                            "type": "object",
                            "properties": {
                                "filename": {"type": "string", "description": "Name of the markdown file"},
                                "content": {"type": "string", "description": "Content to add to the file"},
                                "mode": {"type": "string", "enum": ["append", "replace"], "description": "Whether to append to or replace the file content", "default": "append"}
                            },
                            "required": ["filename", "content"]
                        }
                    },
                    {
                        "name": "delete_markdown_file",
                        "description": "Delete a markdown file",
                        "inputSchema": {
                            "type": "object", 
                            "properties": {"filename": {"type": "string", "description": "Name of the markdown file"}},
                            "required": ["filename"]
                        }
                    }
                ]
                
                response = {
                    "jsonrpc": "2.0",
                    "id": request_id,
                    "result": {"tools": tools}
                }
                
            elif method == 'tools/call':
                tool_name = params.get('name')
                arguments = params.get('arguments', {})
                
                # Call the appropriate tool method
                if tool_name == "create_markdown_file":
                    result = await self._create_markdown_file(
                        arguments.get("filename", ""),
                        arguments.get("content", ""),
                        arguments.get("prefix", "")
                    )
                elif tool_name == "list_markdown_files":
                    result = await self._list_markdown_files()
                elif tool_name == "read_markdown_file":
                    result = await self._read_markdown_file(arguments.get("filename", ""))
                elif tool_name == "update_markdown_file":
                    result = await self._update_markdown_file(
                        arguments.get("filename", ""),
                        arguments.get("content", ""),
                        arguments.get("mode", "append")
                    )
                elif tool_name == "delete_markdown_file":
                    result = await self._delete_markdown_file(arguments.get("filename", ""))
                else:
                    return web.json_response({
                        "jsonrpc": "2.0",
                        "id": request_id,
                        "error": {"code": -32601, "message": f"Unknown tool: {tool_name}"}
                    }, status=400)
                
                response = {
                    "jsonrpc": "2.0",
                    "id": request_id,
                    "result": {"content": [{"type": "text", "text": result.content[0].text}]}
                }
                
            else:
                return web.json_response({
                    "jsonrpc": "2.0",
                    "id": request_id,
                    "error": {"code": -32601, "message": f"Unknown method: {method}"}
                }, status=400)
            
            return web.json_response(response)
            
        except Exception as e:
            logger.error(f"Error in MCP HTTP handler: {e}")
            return web.json_response({
                "jsonrpc": "2.0",
                "id": data.get('id') if 'data' in locals() else None,
                "error": {"code": -32603, "message": f"Internal error: {e}"}
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
    
    async def run(self, enable_stdio_mcp: bool = False):
        """Run the unified server."""
        app = web.Application()
        
        # LiveView routes
        app.router.add_get('/', self.handle_index)
        app.router.add_get('/ws', self.handle_websocket)
        app.router.add_get('/api/content', self.handle_api_content)
        app.router.add_get('/raw', self.handle_raw_markdown)
        
        # MCP HTTP route (optional)
        if self.enable_mcp:
            app.router.add_post('/mcp', self.handle_mcp_http)
        
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