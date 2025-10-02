#!/usr/bin/env python3
"""Test the MCP get_chat_stream_info tool."""

import asyncio
import json
import httpx

async def test_mcp_tool():
    """Test the get_chat_stream_info MCP tool."""
    
    # Test the MCP tool
    mcp_request = {
        "jsonrpc": "2.0",
        "id": 1,
        "method": "tools/call",
        "params": {
            "name": "get_chat_stream_info",
            "arguments": {}
        }
    }
    
    print("🧪 Testing get_chat_stream_info MCP tool...")
    
    async with httpx.AsyncClient() as client:
        try:
            response = await client.post(
                "http://localhost:8080/mcp",
                json=mcp_request,
                headers={"Content-Type": "application/json"}
            )
            
            print(f"Status: {response.status_code}")
            if response.status_code == 200:
                result = response.json()
                print("✅ MCP Tool Response:")
                print(json.dumps(result, indent=2))
                
                # Extract and print the tool result nicely
                if "result" in result:
                    print("\n📋 Tool Output:")
                    print(result["result"])
            else:
                print(f"❌ Error: {response.text}")
                
        except Exception as e:
            print(f"❌ Request failed: {e}")

if __name__ == "__main__":
    asyncio.run(test_mcp_tool())