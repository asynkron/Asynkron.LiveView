"""MCP tools handling for markdown content management."""

import logging
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional

from mcp.types import (
    CallToolResult,
    Tool,
    TextContent,
    INTERNAL_ERROR,
    JSONRPCError
)

logger = logging.getLogger(__name__)


class MCPTools:
    """Handles MCP tool definitions and operations."""

    def __init__(self, markdown_dir: Path, file_manager, chat_messages: List[Dict[str, Any]]):
        """Initialize MCP tools handler.
        
        Args:
            markdown_dir: Path to the markdown directory
            file_manager: FileManager instance for file operations
            chat_messages: Reference to chat messages list
        """
        self.markdown_dir = markdown_dir
        self.file_manager = file_manager
        self.chat_messages = chat_messages

    def build_tool_definitions(self) -> List[Tool]:
        """Return the MCP tool definitions."""
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

    async def show_content(self, content: str, title: Optional[str] = None) -> CallToolResult:
        """Create a new markdown file using a generated File Id."""
        if not content:
            raise JSONRPCError(INTERNAL_ERROR, "Content cannot be empty")

        file_id = self.file_manager.generate_file_id()
        file_path = self.markdown_dir / file_id

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

    async def list_content(self) -> CallToolResult:
        """List all markdown files in the directory."""
        try:
            md_files = sorted(self.markdown_dir.glob('*.md'))
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

    async def view_content(self, fileId: str) -> CallToolResult:
        """Read the content of a specific markdown file."""
        if not fileId:
            raise JSONRPCError(INTERNAL_ERROR, "File Id cannot be empty")

        filename = self.file_manager.sanitize_file_id(fileId)
        file_path = self.markdown_dir / filename

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

    async def update_content(self, fileId: str, content: str, mode: str = "append") -> CallToolResult:
        """Update or append to an existing markdown file."""
        if not fileId:
            raise JSONRPCError(INTERNAL_ERROR, "File Id cannot be empty")

        filename = self.file_manager.sanitize_file_id(fileId)
        file_path = self.markdown_dir / filename

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

    async def remove_content(self, fileId: str) -> CallToolResult:
        """Delete a markdown file."""
        if not fileId:
            raise JSONRPCError(INTERNAL_ERROR, "File Id cannot be empty")

        filename = self.file_manager.sanitize_file_id(fileId)
        file_path = self.markdown_dir / filename

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

    async def subscribe_chat(self) -> CallToolResult:
        """Subscribe to chat messages from the UI."""
        return CallToolResult(
            content=[TextContent(
                type="text",
                text="Successfully subscribed to chat messages. Use the 'get_chat_messages' tool to poll for new messages from the UI. Messages are stored with timestamps, so you can track which ones you've already processed."
            )]
        )

    async def get_chat_messages(self, since: Optional[float] = None) -> CallToolResult:
        """Get chat messages since a given timestamp."""
        try:
            if since is None:
                messages = self.chat_messages
            else:
                messages = [msg for msg in self.chat_messages if msg['timestamp'] > since]
            
            if not messages:
                return CallToolResult(
                    content=[TextContent(
                        type="text",
                        text="No new chat messages."
                    )]
                )
            
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
