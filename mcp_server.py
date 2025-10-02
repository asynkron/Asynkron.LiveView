#!/usr/bin/env python3
"""
FastMCP Server for Markdown Live View

Provides Model Context Protocol (MCP) server functionality using FastMCP to allow AI assistants
to directly create and manage markdown files that will be displayed in the live view system.
"""

import asyncio
import logging
import secrets
import time
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional

from fastmcp import FastMCP
from mcp.types import (
    CallToolResult,
    TextContent,
    INTERNAL_ERROR,
    JSONRPCError
)

# Configure logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

class MarkdownMCPServer:
    """FastMCP Server for managing markdown files in the live view system."""
    
    def __init__(self, markdown_dir: str = "markdown"):
        """Initialize the FastMCP server.
        
        Args:
            markdown_dir: Directory where markdown files are stored
        """
        self.markdown_dir = Path(markdown_dir).resolve()
        self.server = FastMCP(
            name="markdown-liveview",
            version="1.0.0",
            instructions="FastMCP server for managing markdown files in the live view system"
        )
        
        # Ensure the markdown directory exists
        self.markdown_dir.mkdir(exist_ok=True)
        
        # Register tool handlers
        self._register_tools()
        
        logger.info(f"FastMCP Server initialized for directory: {self.markdown_dir}")
    
    def _register_tools(self):
        """Register all available tools with FastMCP."""
        
        @self.server.tool()
        async def show_content(content: str, title: str = None) -> str:
            """Create new markdown content that will appear in the live view."""
            result = await self._show_content(content, title)
            return result.content[0].text if result.content else "Created"
        
        @self.server.tool()
        async def list_content() -> str:
            """List all markdown entries currently available."""
            result = await self._list_content()
            return result.content[0].text if result.content else "No content"
        
        @self.server.tool()
        async def view_content(fileId: str) -> str:
            """Read the content of a markdown entry using its File Id."""
            result = await self._view_content(fileId)
            return result.content[0].text if result.content else "Not found"
        
        @self.server.tool()
        async def update_content(fileId: str, content: str, mode: str = "append") -> str:
            """Append to or replace an existing markdown entry."""
            result = await self._update_content(fileId, content, mode)
            return result.content[0].text if result.content else "Updated"
        
        @self.server.tool()
        async def remove_content(fileId: str) -> str:
            """Delete a markdown entry using its File Id."""
            result = await self._remove_content(fileId)
            return result.content[0].text if result.content else "Removed"

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
        """Run the FastMCP server using stdio."""
        logger.info("Starting FastMCP server...")
        await self.server.run_stdio_async()

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