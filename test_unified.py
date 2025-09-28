#!/usr/bin/env python3
"""
Test script for the unified server functionality.
Tests both LiveView and MCP capabilities in a single server.
"""

import asyncio
import json
import subprocess
import sys
import time
import requests
from pathlib import Path

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
        
        print("\n2. Testing MCP file creation...")
        mcp_create_request = {
            "jsonrpc": "2.0",
            "id": 2,
            "method": "tools/call",
            "params": {
                "name": "create_markdown_file",
                "arguments": {
                    "filename": "unified-server-test",
                    "content": test_content
                }
            }
        }
        
        response = requests.post(f"{base_url}/mcp", json=mcp_create_request, timeout=10)
        if response.status_code == 200:
            result = response.json()
            content = result.get("result", {}).get("content", [{}])[0].get("text", "")
            print(f"   ✅ File creation result: {content}")
        else:
            print(f"   ❌ MCP file creation failed: {response.status_code}")
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
            
            # Check if our created file is in the content
            if "unified-server-test" in data.get("content", ""):
                print("   ✅ Created file found in unified content")
            else:
                print("   ⚠️  Created file not yet visible in unified content")
        else:
            print(f"   ❌ LiveView API failed: {response.status_code}")
            success = False
        
        print("\n4. Testing MCP file listing...")
        mcp_list_files_request = {
            "jsonrpc": "2.0", 
            "id": 3,
            "method": "tools/call",
            "params": {
                "name": "list_markdown_files",
                "arguments": {}
            }
        }
        
        response = requests.post(f"{base_url}/mcp", json=mcp_list_files_request, timeout=10)
        if response.status_code == 200:
            result = response.json()
            content = result.get("result", {}).get("content", [{}])[0].get("text", "")
            print(f"   ✅ MCP file listing successful")
            if "unified-server-test" in content:
                print("   ✅ Created file found in MCP listing")
            else:
                print("   ⚠️  Created file not found in MCP listing")
        else:
            print(f"   ❌ MCP file listing failed: {response.status_code}")
            success = False
        
        print("\n5. Testing raw markdown endpoint...")
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
        print("   ✅ File creation via MCP working")
        print("   ✅ Content retrieval via LiveView working")
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