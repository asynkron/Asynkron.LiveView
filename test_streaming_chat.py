#!/usr/bin/env python3
"""
Test script for the streaming chat subscription MCP tool.
This demonstrates how to use the new subscribe_chat_stream tool.
"""

import asyncio
import json
import httpx


async def test_streaming_chat():
    """Test the streaming chat subscription."""
    print("🧪 Testing the streaming chat subscription...")
    
    # Test the new streaming chat tool
    payload = {
        "jsonrpc": "2.0",
        "method": "tools/call",
        "id": 1,
        "params": {
            "name": "subscribe_chat_stream",
            "arguments": {}
        }
    }
    
    try:
        async with httpx.AsyncClient() as client:
            print("📡 Calling subscribe_chat_stream tool...")
            response = await client.post("http://localhost:8081/mcp", json=payload)
            
            if response.status_code == 200:
                result = response.json()
                print("✅ Response received:")
                print(json.dumps(result, indent=2))
            else:
                print(f"❌ HTTP Error: {response.status_code}")
                print(response.text)
                
    except Exception as e:
        print(f"❌ Error: {e}")


async def test_list_tools():
    """Test listing available tools to see our new tool."""
    print("🔍 Listing available MCP tools...")
    
    payload = {
        "jsonrpc": "2.0",
        "method": "tools/list",
        "id": 2
    }
    
    try:
        async with httpx.AsyncClient() as client:
            response = await client.post("http://localhost:8081/mcp", json=payload)
            
            if response.status_code == 200:
                result = response.json()
                print("📋 Available tools:")
                if "result" in result and "tools" in result["result"]:
                    for tool in result["result"]["tools"]:
                        name = tool.get("name", "unknown")
                        desc = tool.get("description", "no description")
                        print(f"  🔧 {name}: {desc}")
                else:
                    print(json.dumps(result, indent=2))
            else:
                print(f"❌ HTTP Error: {response.status_code}")
                print(response.text)
                
    except Exception as e:
        print(f"❌ Error: {e}")


async def main():
    """Main test function."""
    print("🚀 Starting MCP streaming chat tests...")
    print("-" * 50)
    
    # First list available tools
    await test_list_tools()
    print("-" * 50)
    
    # Test the streaming chat subscription
    await test_streaming_chat()
    
    print("-" * 50)
    print("✨ Tests completed!")
    print("\n💡 To test the streaming functionality:")
    print("   1. Open http://localhost:8081 in your browser")
    print("   2. Send a chat message from the UI")
    print("   3. The message should be streamed to any MCP client using subscribe_chat_stream")


if __name__ == "__main__":
    asyncio.run(main())