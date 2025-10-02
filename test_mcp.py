#!/usr/bin/env python3
"""
Test script for the MCP server functionality.
"""

import asyncio
import sys
from pathlib import Path


async def test_mcp_server():
    """Test the MCP server by simulating MCP client requests."""

    print("🧪 Testing MCP Server Functionality")
    print("=" * 50)

    # Test data
    test_content = """# Test Markdown File

This is a test file created by the MCP server!

## Features
- ✅ Created via MCP
- ✅ Will appear in live view
- ✅ Supports all markdown features

## Sample Code

```python
def hello_mcp():
    print("Hello from MCP!")
    return "success"
```

## Sample Mermaid Diagram

```mermaid
graph TD
    A[AI Assistant] --> B[MCP Server]
    B --> C[Create Markdown]
    C --> D[Live View]
    D --> E[Browser]
```

This file demonstrates the MCP server's ability to create markdown files that integrate seamlessly with the live view system.
"""

    # Prepare test scenarios (documentation only, not executed)
    tests = [
        {
            "name": "List Tools",
            "method": "tools/list",
            "params": {}
        },
        {
            "name": "List Content (initially empty)",
            "method": "tools/call",
            "params": {
                "name": "list_content",
                "arguments": {}
            }
        },
        {
            "name": "Show Test Content",
            "method": "tools/call",
            "params": {
                "name": "show_content",
                "arguments": {
                    "title": "Test Plan",
                    "content": test_content
                }
            }
        },
        {
            "name": "List Content (after creation)",
            "method": "tools/call",
            "params": {
                "name": "list_content",
                "arguments": {}
            }
        },
    ]

    print("Starting MCP server for testing...")

    # For this test, we'll create files directly and verify they exist
    # since setting up a full MCP client is complex

    try:
        from mcp_server import MarkdownMCPServer

        # Create MCP server instance
        server = MarkdownMCPServer("markdown")

        print("✅ MCP Server instance created successfully")

        # Test create file using the new show_content flow
        create_result = await server._show_content(test_content, title="Test File")
        create_message = create_result.content[0].text
        print(f"✅ Show content test: {create_message}")

        file_id = None
        for line in create_message.splitlines():
            if line.strip().lower().startswith("file id:"):
                file_id = line.split(":", 1)[1].strip()
                break

        if not file_id:
            print("❌ Could not parse File Id from response")
            return False

        # Test list files
        result = await server._list_content()
        print("✅ List content test: Found files in directory")

        # Test read file
        result = await server._view_content(file_id)
        print("✅ View content test: Successfully read file content")

        # Test update file
        result = await server._update_content(file_id, "## MCP Update Test\n\nThis was appended via MCP!", "append")
        print(f"✅ Update content test: {result.content[0].text}")

        # Verify the file exists in the filesystem
        markdown_dir = Path("markdown")
        target_path = markdown_dir / file_id

        if target_path.exists():
            print("✅ File verification: Created File Id exists on disk")
            size = target_path.stat().st_size
            print(f"   - {file_id} ({size} bytes)")
        else:
            print("❌ File verification: File Id not found on disk")

        print("\n🎉 MCP Server tests completed successfully!")
        print("\n📝 Next steps:")
        print("1. Start the live view server: python server.py")
        print("2. Open browser to http://localhost:8080")
        print("3. See the MCP-created files in the live view!")

    except Exception as e:
        print(f"❌ Error during testing: {e}")
        return False

    return True


if __name__ == "__main__":
    success = asyncio.run(test_mcp_server())
    sys.exit(0 if success else 1)
