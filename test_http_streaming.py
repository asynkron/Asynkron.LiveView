#!/usr/bin/env python3
"""
Test script for HTTP streaming chat subscription - STREAMING ONLY APPROACH.
This demonstrates the HTTP streaming endpoint that uses chunked transfer encoding.

⚠️  NO POLLING: This test uses real-time streaming, never polling.
See agents.md for the strict no-polling requirement.
"""

import asyncio
import json
import httpx


async def test_http_streaming_chat():
    """Test the HTTP streaming chat endpoint."""
    print("🚀 Testing HTTP streaming chat endpoint...")
    print("📡 Connecting to: POST http://localhost:8080/mcp/stream/chat")
    
    try:
        async with httpx.AsyncClient() as client:
            async with client.stream('POST', 'http://localhost:8080/mcp/stream/chat') as response:
                print(f"✅ Connected! Status: {response.status_code}")
                print("🔄 Waiting for streaming messages...")
                print("💡 Send a chat message from the UI at http://localhost:8080 to see it here!")
                print("-" * 60)
                
                async for line in response.aiter_lines():
                    if line.strip():  # Skip empty lines
                        try:
                            data = json.loads(line)
                            if "result" in data:
                                print(f"📨 {data['result']}")
                            elif "error" in data:
                                print(f"❌ Error: {data['error']['message']}")
                        except json.JSONDecodeError:
                            print(f"⚠️  Invalid JSON: {line}")
                            
    except httpx.ConnectError:
        print("❌ Connection failed. Make sure the server is running on http://localhost:8080")
    except KeyboardInterrupt:
        print("\n🛑 Stopped by user")
    except Exception as e:
        print(f"❌ Error: {e}")


async def test_list_tools():
    """List available MCP tools."""
    print("🔍 Listing available MCP tools...")
    
    payload = {
        "jsonrpc": "2.0",
        "method": "tools/list",
        "id": 1
    }
    
    try:
        async with httpx.AsyncClient() as client:
            response = await client.post("http://localhost:8080/mcp", json=payload)
            
            if response.status_code == 200:
                result = response.json()
                if "result" in result and "tools" in result["result"]:
                    print("📋 Available MCP tools:")
                    for tool in result["result"]["tools"]:
                        name = tool.get("name", "unknown")
                        desc = tool.get("description", "no description")
                        print(f"  🔧 {name}: {desc}")
                else:
                    print("⚠️  Unexpected response format")
            else:
                print(f"❌ HTTP Error: {response.status_code}")
                
    except Exception as e:
        print(f"❌ Error: {e}")


async def test_stream_endpoint_info():
    """Test the tool that provides streaming endpoint info."""
    print("🔍 Getting streaming endpoint info...")
    
    payload = {
        "jsonrpc": "2.0",
        "method": "tools/call",
        "id": 2,
        "params": {
            "name": "get_stream_chat_endpoint",
            "arguments": {}
        }
    }
    
    try:
        async with httpx.AsyncClient() as client:
            response = await client.post("http://localhost:8080/mcp", json=payload)
            
            if response.status_code == 200:
                result = response.json()
                if "result" in result:
                    print("📡 Streaming endpoint info:")
                    print(f"   {result['result']}")
                else:
                    print("⚠️  Unexpected response format")
            else:
                print(f"❌ HTTP Error: {response.status_code}")
                
    except Exception as e:
        print(f"❌ Error: {e}")


async def main():
    """Main test function."""
    print("🧪 Testing HTTP Streaming Chat MCP Implementation")
    print("=" * 60)
    
    # First list available tools
    await test_list_tools()
    print("-" * 60)
    
    # Get streaming endpoint info
    await test_stream_endpoint_info()
    print("-" * 60)
    
    # Start streaming (this will run until interrupted)
    await test_http_streaming_chat()


if __name__ == "__main__":
    asyncio.run(main())