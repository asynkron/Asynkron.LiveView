#!/usr/bin/env python3
"""
MCP Server for Markdown Live View

Provides Model Context Protocol (MCP) server functionality to allow AI assistants
to directly create and manage markdown files that will be displayed in the live view system.
"""

import asyncio
import json
import logging
import os
import time
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional

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
                                "description": "Name of the markdown file to read (with or without .md extension)"
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
                                "description": "Name of the markdown file to update (with or without .md extension)"
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
                                "description": "Name of the markdown file to delete (with or without .md extension)"
                            }
                        },
                        "required": ["filename"]
                    }
                )
            ]
            return ListToolsResult(tools=tools)
        
        @self.server.call_tool()
        async def call_tool(name: str, arguments: Dict[str, Any]) -> CallToolResult:
            """Handle tool calls."""
            try:
                if name == "create_markdown_file":
                    return await self._create_markdown_file(**arguments)
                elif name == "list_markdown_files":
                    return await self._list_markdown_files()
                elif name == "read_markdown_file":
                    return await self._read_markdown_file(**arguments)
                elif name == "update_markdown_file":
                    return await self._update_markdown_file(**arguments)
                elif name == "delete_markdown_file":
                    return await self._delete_markdown_file(**arguments)
                else:
                    raise JSONRPCError(METHOD_NOT_FOUND, f"Unknown tool: {name}")
            except JSONRPCError:
                raise
            except Exception as e:
                logger.error(f"Error calling tool {name}: {e}")
                raise JSONRPCError(INTERNAL_ERROR, str(e))
    
    def _normalize_filename(self, filename: str) -> str:
        """Normalize filename to ensure it has .md extension."""
        if not filename.endswith('.md'):
            filename += '.md'
        return filename
    
    def _get_next_prefix(self) -> str:
        """Generate the next numbered prefix for files."""
        existing_files = list(self.markdown_dir.glob("*.md"))
        numbers = []
        
        for file_path in existing_files:
            name = file_path.stem
            if '-' in name:
                prefix = name.split('-')[0]
                if prefix.isdigit():
                    numbers.append(int(prefix))
        
        next_num = max(numbers) + 1 if numbers else 1
        return f"{next_num:02d}-"
    
    async def _create_markdown_file(self, filename: str, content: str, prefix: str = "") -> CallToolResult:
        """Create a new markdown file."""
        try:
            # Normalize filename
            filename = self._normalize_filename(filename)
            
            # Add prefix if not provided
            if not prefix:
                prefix = self._get_next_prefix()
            
            # Ensure prefix ends with dash if it doesn't already
            if prefix and not prefix.endswith('-'):
                prefix += '-'
            
            full_filename = f"{prefix}{filename}"
            file_path = self.markdown_dir / full_filename
            
            # Check if file already exists
            if file_path.exists():
                return CallToolResult(
                    content=[TextContent(
                        type="text",
                        text=f"Error: File '{full_filename}' already exists. Use update_markdown_file to modify it."
                    )]
                )
            
            # Create the file
            with open(file_path, 'w', encoding='utf-8') as f:
                f.write(content)
            
            logger.info(f"Created markdown file: {full_filename}")
            
            return CallToolResult(
                content=[TextContent(
                    type="text",
                    text=f"Successfully created file '{full_filename}' with {len(content)} characters."
                )]
            )
            
        except Exception as e:
            logger.error(f"Error creating file: {e}")
            raise JSONRPCError(INTERNAL_ERROR, f"Failed to create file: {e}")
    
    async def _list_markdown_files(self) -> CallToolResult:
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
    
    async def _read_markdown_file(self, filename: str) -> CallToolResult:
        """Read the content of a specific markdown file."""
        try:
            # Normalize filename
            filename = self._normalize_filename(filename)
            
            # Try to find the file (with or without prefix)
            file_path = None
            direct_path = self.markdown_dir / filename
            
            if direct_path.exists():
                file_path = direct_path
            else:
                # Look for files that end with the filename (in case prefix was omitted)
                for existing_file in self.markdown_dir.glob("*.md"):
                    if existing_file.name.endswith(filename) or existing_file.name == filename:
                        file_path = existing_file
                        break
            
            if not file_path:
                return CallToolResult(
                    content=[TextContent(
                        type="text",
                        text=f"Error: File '{filename}' not found."
                    )]
                )
            
            # Read the file content
            with open(file_path, 'r', encoding='utf-8') as f:
                content = f.read()
            
            return CallToolResult(
                content=[TextContent(
                    type="text",
                    text=f"Content of '{file_path.name}':\n\n{content}"
                )]
            )
            
        except Exception as e:
            logger.error(f"Error reading file: {e}")
            raise JSONRPCError(INTERNAL_ERROR, f"Failed to read file: {e}")
    
    async def _update_markdown_file(self, filename: str, content: str, mode: str = "append") -> CallToolResult:
        """Update or append to an existing markdown file."""
        try:
            # Normalize filename
            filename = self._normalize_filename(filename)
            
            # Try to find the file (with or without prefix)
            file_path = None
            direct_path = self.markdown_dir / filename
            
            if direct_path.exists():
                file_path = direct_path
            else:
                # Look for files that end with the filename (in case prefix was omitted)
                for existing_file in self.markdown_dir.glob("*.md"):
                    if existing_file.name.endswith(filename) or existing_file.name == filename:
                        file_path = existing_file
                        break
            
            if not file_path:
                return CallToolResult(
                    content=[TextContent(
                        type="text",
                        text=f"Error: File '{filename}' not found. Use create_markdown_file to create it."
                    )]
                )
            
            if mode == "append":
                # Append to existing content
                with open(file_path, 'a', encoding='utf-8') as f:
                    f.write('\n\n' + content)
                action = "appended to"
            else:  # replace
                # Replace entire content
                with open(file_path, 'w', encoding='utf-8') as f:
                    f.write(content)
                action = "replaced content of"
            
            logger.info(f"Updated markdown file: {file_path.name} ({mode} mode)")
            
            return CallToolResult(
                content=[TextContent(
                    type="text",
                    text=f"Successfully {action} file '{file_path.name}'."
                )]
            )
            
        except Exception as e:
            logger.error(f"Error updating file: {e}")
            raise JSONRPCError(INTERNAL_ERROR, f"Failed to update file: {e}")
    
    async def _delete_markdown_file(self, filename: str) -> CallToolResult:
        """Delete a markdown file."""
        try:
            # Normalize filename
            filename = self._normalize_filename(filename)
            
            # Try to find the file (with or without prefix)
            file_path = None
            direct_path = self.markdown_dir / filename
            
            if direct_path.exists():
                file_path = direct_path
            else:
                # Look for files that end with the filename (in case prefix was omitted)
                for existing_file in self.markdown_dir.glob("*.md"):
                    if existing_file.name.endswith(filename) or existing_file.name == filename:
                        file_path = existing_file
                        break
            
            if not file_path:
                return CallToolResult(
                    content=[TextContent(
                        type="text",
                        text=f"Error: File '{filename}' not found."
                    )]
                )
            
            # Delete the file
            file_path.unlink()
            
            logger.info(f"Deleted markdown file: {file_path.name}")
            
            return CallToolResult(
                content=[TextContent(
                    type="text",
                    text=f"Successfully deleted file '{file_path.name}'."
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