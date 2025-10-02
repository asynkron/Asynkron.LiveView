#!/usr/bin/env python3
"""
Test script for the unified server functionality.
Tests both LiveView and MCP capabilities in a single server.
"""

import asyncio
import sys
import requests
from typing import Optional


def _extract_file_id(message: str) -> Optional[str]:
    """Helper to pull the File Id line out of a tool response."""
    for line in message.splitlines():
        if line.strip().lower().startswith("file id:"):
            return line.split(":", 1)[1].strip()
    return None


async def test_unified_server():
    """Test the unified server by making HTTP requests to both LiveView and MCP endpoints."""

    print("🧪 Testing Unified Server Functionality")
    print("=" * 50)

    # Test data
    test_content = """# Unified Server Test

This file was created by the unified server test script!

## Features Tested
- ✅ MCP HTTP endpoint
- ✅ LiveView API endpoint
- ✅ File creation via MCP
- ✅ Content retrieval via LiveView

## Test Results
All unified server functionality is working correctly!

```mermaid
graph TD
    A[Test Script] --> B[MCP Endpoint]
    B --> C[Create File]
    C --> D[LiveView API]
    D --> E[Verify Content]
    E --> F[Success!]
```

**Status**: ✅ Unified server test passed!
"""

    base_url = "http://localhost:8080"
    success = True
    created_file_id: Optional[str] = None

    try:
        print("1. Testing MCP tools/list endpoint...")
        mcp_list_request = {
            "jsonrpc": "2.0",
            "id": 1,
            "method": "tools/list",
            "params": {}
        }

        response = requests.post(f"{base_url}/mcp", json=mcp_list_request, timeout=10)
        if response.status_code == 200:
            result = response.json()
            tools = result.get("result", {}).get("tools", [])
            print(f"   ✅ Found {len(tools)} MCP tools available")
            for tool in tools:
                print(f"      - {tool['name']}: {tool['description']}")
        else:
            print(f"   ❌ MCP tools/list failed: {response.status_code}")
            success = False

        print("\n2. Testing MCP show_content tool...")
        mcp_create_request = {
            "jsonrpc": "2.0",
            "id": 2,
            "method": "tools/call",
            "params": {
                "name": "show_content",
                "arguments": {
                    "title": "Unified Server Test",
                    "content": test_content
                }
            }
        }

        response = requests.post(f"{base_url}/mcp", json=mcp_create_request, timeout=10)
        if response.status_code == 200:
            result = response.json()
            text_block = result.get("result", {}).get("content", [{}])[0].get("text", "")
            print(f"   ✅ show_content result: {text_block}")
            created_file_id = _extract_file_id(text_block)
            if created_file_id:
                print(f"   🆔 Received File Id: {created_file_id}")
            else:
                print("   ❌ Could not extract File Id from response")
                success = False
        else:
            print(f"   ❌ MCP show_content failed: {response.status_code}")
            success = False

        print("\n3. Testing LiveView API endpoint...")
        response = requests.get(f"{base_url}/api/content", timeout=10)
        if response.status_code == 200:
            data = response.json()
            files_count = data.get("files", 0)
            directory = data.get("directory", "")
            content_length = len(data.get("content", ""))
            print(f"   ✅ LiveView API working: {files_count} files, {content_length} chars content")
            print(f"   📁 Directory: {directory}")

            unified_text = data.get("content", "")
            if "Unified Server Test" in unified_text:
                print("   ✅ Created content found in unified output")
            else:
                print("   ⚠️  Created content not yet visible in unified output")
        else:
            print(f"   ❌ LiveView API failed: {response.status_code}")
            success = False

        if created_file_id:
            print("\n4. Testing MCP view_content tool...")
            view_request = {
                "jsonrpc": "2.0",
                "id": 3,
                "method": "tools/call",
                "params": {
                    "name": "view_content",
                    "arguments": {"fileId": created_file_id}
                }
            }

            response = requests.post(f"{base_url}/mcp", json=view_request, timeout=10)
            if response.status_code == 200:
                result = response.json()
                preview = result.get("result", {}).get("content", [{}])[0].get("text", "")
                print(f"   ✅ view_content returned: {preview[:80]}...")
            else:
                print(f"   ❌ MCP view_content failed: {response.status_code}")
                success = False
        else:
            print("\n4. Skipping view_content test because no File Id was captured.")

        print("\n5. Testing MCP list_content tool...")
        mcp_list_files_request = {
            "jsonrpc": "2.0",
            "id": 4,
            "method": "tools/call",
            "params": {
                "name": "list_content",
                "arguments": {}
            }
        }

        response = requests.post(f"{base_url}/mcp", json=mcp_list_files_request, timeout=10)
        if response.status_code == 200:
            result = response.json()
            listing_text = result.get("result", {}).get("content", [{}])[0].get("text", "")
            print("   ✅ MCP file listing successful")
            if "Unified Server Test" in listing_text:
                print("   ✅ Created content referenced in MCP listing")
            else:
                print("   ⚠️  Created content not found in MCP listing")
        else:
            print(f"   ❌ MCP list_content failed: {response.status_code}")
            success = False

        print("\n6. Testing raw markdown endpoint...")
        response = requests.get(f"{base_url}/raw", timeout=10)
        if response.status_code == 200:
            content = response.text
            print(f"   ✅ Raw markdown endpoint working: {len(content)} characters")
        else:
            print(f"   ❌ Raw markdown endpoint failed: {response.status_code}")
            success = False

    except requests.exceptions.ConnectionError:
        print("❌ Could not connect to server. Make sure the unified server is running on localhost:8080")
        return False
    except Exception as e:
        print(f"❌ Error during testing: {e}")
        return False

    print("\n" + "=" * 50)
    if success:
        print("🎉 All unified server tests passed!")
        print("")
        print("📋 Test Summary:")
        print("   ✅ MCP HTTP endpoint working")
        print("   ✅ LiveView API endpoint working")
        print("   ✅ show_content tool working")
        if created_file_id:
            print("   ✅ view_content tool working")
        print("   ✅ list_content tool working")
        print("   ✅ Raw markdown endpoint working")
        print("")
        print("🚀 The unified server is fully operational!")
        print("   🌐 Web interface: http://localhost:8080")
        print("   🤖 MCP endpoint: POST http://localhost:8080/mcp")
    else:
        print("❌ Some tests failed. Check the server logs for details.")

    return success


if __name__ == "__main__":
    success = asyncio.run(test_unified_server())
    sys.exit(0 if success else 1)
