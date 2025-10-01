#!/usr/bin/env python3
"""
MCP Server for Markdown Live View

Provides Model Context Protocol (MCP) server functionality to allow AI assistants
to directly create and manage markdown files that will be displayed in the live view system.
"""

import asyncio
import logging
import secrets
import time
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional

from mcp.server import Server
from mcp.server.stdio import stdio_server
from mcp.types import (
    CallToolResult,
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

class MarkdownMCPServer:
    """MCP Server for managing markdown files in the live view system."""
    
    def __init__(self, markdown_dir: str = "markdown"):
        """Initialize the MCP server.
        
        Args:
            markdown_dir: Directory where markdown files are stored
        """
        self.markdown_dir = Path(markdown_dir).resolve()
        self.server = Server("markdown-liveview")
        
        # Ensure the markdown directory exists
        self.markdown_dir.mkdir(exist_ok=True)
        
        # Register tool handlers
        self._register_tools()
        
        logger.info(f"MCP Server initialized for directory: {self.markdown_dir}")
    
    def _register_tools(self):
        """Register all available tools with the MCP server."""
        
        @self.server.list_tools()
        async def list_tools() -> ListToolsResult:
            """List all available tools."""
            tools = [
                Tool(
                    name="show_content",
                    description="Create new markdown content that will appear in the live view",
                    inputSchema={
                        "type": "object",
                        "properties": {
                            "content": {
                                "type": "string",
                                "description": "Markdown content to write to the live view"
                            },
                            "title": {
                                "type": "string",
                                "description": "Optional short title used only for readability in the response"
                            }
                        },
                        "required": ["content"]
                    }
                ),
                Tool(
                    name="list_content",
                    description="List all markdown entries currently available",
                    inputSchema={
                        "type": "object",
                        "properties": {},
                        "additionalProperties": False
                    }
                ),
                Tool(
                    name="view_content",
                    description="Read the content of a markdown entry using its File Id",
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
                    description="Append to or replace an existing markdown entry",
                    inputSchema={
                        "type": "object",
                        "properties": {
                            "fileId": {
                                "type": "string",
                                "description": "The File Id returned by show_content"
                            },
                            "content": {
                                "type": "string",
                                "description": "Content to append or new content to replace"
                            },
                            "mode": {
                                "type": "string",
                                "enum": ["append", "replace"],
                                "description": "Whether to append to existing content or replace it entirely",
                                "default": "append"
                            }
                        },
                        "required": ["fileId", "content"]
                    }
                ),
                Tool(
                    name="remove_content",
                    description="Delete a markdown entry using its File Id",
                    inputSchema={
                        "type": "object",
                        "properties": {
                            "fileId": {
                                "type": "string",
                                "description": "The File Id returned by show_content"
                            }
                        },
                        "required": ["fileId"]
                    }
                )
            ]
            return ListToolsResult(tools=tools)

        @self.server.call_tool()
        async def call_tool(name: str, arguments: Dict[str, Any]) -> CallToolResult:
            """Handle tool calls."""
            try:
                if name == "show_content":
                    return await self._show_content(
                        content=arguments.get("content", ""),
                        title=arguments.get("title")
                    )
                elif name == "list_content":
                    return await self._list_content()
                elif name == "view_content":
                    return await self._view_content(
                        fileId=arguments.get("fileId") or arguments.get("filename", "")
                    )
                elif name == "update_content":
                    return await self._update_content(
                        fileId=arguments.get("fileId") or arguments.get("filename", ""),
                        content=arguments.get("content", ""),
                        mode=arguments.get("mode", "append")
                    )
                elif name == "remove_content":
                    return await self._remove_content(
                        fileId=arguments.get("fileId") or arguments.get("filename", "")
                    )
                else:
                    raise JSONRPCError(METHOD_NOT_FOUND, f"Unknown tool: {name}")
            except JSONRPCError:
                raise
            except Exception as e:
                logger.error(f"Error calling tool {name}: {e}")
                raise JSONRPCError(INTERNAL_ERROR, str(e))

    def _generate_file_id(self) -> str:
        """Generate a unique File Id ending with .md."""
        for _ in range(10):  # Try a handful of random ids before giving up.
            candidate = f"{secrets.token_hex(4)}.md"
            if not (self.markdown_dir / candidate).exists():
                return candidate
        raise JSONRPCError(INTERNAL_ERROR, "Unable to allocate a unique File Id")

    def _sanitize_file_id(self, file_id: str) -> str:
        """Return a safe filename derived from the provided File Id."""
        sanitized = Path(file_id).name
        if not sanitized.endswith('.md'):
            sanitized += '.md'
        return sanitized

    async def _show_content(self, content: str, title: Optional[str] = None) -> CallToolResult:
        """Create a new markdown file with a random File Id."""
        try:
            file_id = self._generate_file_id()
            file_path = self.markdown_dir / file_id

            # Write the provided markdown content to disk.
            with open(file_path, 'w', encoding='utf-8') as handle:
                handle.write(content)

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
            files = []
            for file_path in sorted(self.markdown_dir.glob("*.md")):
                stat = file_path.stat()
                files.append({
                    "name": file_path.name,
                    "size": stat.st_size,
                    "modified": datetime.fromtimestamp(stat.st_mtime).isoformat(),
                    "created": datetime.fromtimestamp(stat.st_ctime).isoformat()
                })
            
            if not files:
                return CallToolResult(
                    content=[TextContent(
                        type="text",
                        text="No markdown files found in the directory."
                    )]
                )
            
            file_list = "\n".join([
                f"- {file['name']} ({file['size']} bytes, modified: {file['modified']})"
                for file in files
            ])
            
            return CallToolResult(
                content=[TextContent(
                    type="text",
                    text=f"Found {len(files)} markdown files:\n{file_list}"
                )]
            )

        except Exception as e:
            logger.error(f"Error listing files: {e}")
            raise JSONRPCError(INTERNAL_ERROR, f"Failed to list files: {e}")

    async def _view_content(self, fileId: str) -> CallToolResult:  # type: ignore[override]
        """Read the content for the provided File Id."""
        try:
            filename = self._sanitize_file_id(fileId)
            file_path = self.markdown_dir / filename

            if not file_path.exists():
                return CallToolResult(
                    content=[TextContent(
                        type="text",
                        text=f"Error: File '{filename}' not found."
                    )]
                )

            with open(file_path, 'r', encoding='utf-8') as handle:
                content = handle.read()

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
        try:
            filename = self._sanitize_file_id(fileId)
            file_path = self.markdown_dir / filename

            if not file_path.exists():
                return CallToolResult(
                    content=[TextContent(
                        type="text",
                        text=f"Error: File '{filename}' not found. Use show_content to create it."
                    )]
                )

            if mode == "append":
                with open(file_path, 'a', encoding='utf-8') as handle:
                    handle.write('\n\n' + content)
                action = "appended to"
            else:
                with open(file_path, 'w', encoding='utf-8') as handle:
                    handle.write(content)
                action = "replaced the contents of"

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
        """Delete a markdown file by File Id."""
        try:
            filename = self._sanitize_file_id(fileId)
            file_path = self.markdown_dir / filename

            if not file_path.exists():
                return CallToolResult(
                    content=[TextContent(
                        type="text",
                        text=f"Error: File '{filename}' not found."
                    )]
                )

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
    
    async def run(self):
        """Run the MCP server using stdio."""
        logger.info("Starting MCP server...")
        async with stdio_server() as streams:
            await self.server.run(streams[0], streams[1], self.server.create_initialization_options())

def main():
    """Main entry point for the MCP server."""
    import argparse
    
    parser = argparse.ArgumentParser(description='Markdown Live View MCP Server')
    parser.add_argument('--dir', default='markdown', help='Directory to manage markdown files in')
    
    args = parser.parse_args()
    
    # Create and run the MCP server
    mcp_server = MarkdownMCPServer(args.dir)
    
    try:
        asyncio.run(mcp_server.run())
    except KeyboardInterrupt:
        logger.info("MCP server stopped by user")
    except Exception as e:
        logger.error(f"MCP server error: {e}")
        raise

if __name__ == '__main__':
    main()