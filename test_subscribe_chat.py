#!/usr/bin/env python3
"""Quick test of the subscribe_chat_stream MCP tool."""

import asyncio
import json
import httpx

async def test_subscribe_chat():
    """Test the subscribe_chat_stream MCP tool."""
    
    mcp_request = {
        "jsonrpc": "2.0",
        "id": 1,
        "method": "tools/call",
        "params": {
            "name": "subscribe_chat_stream",
            "arguments": {}
        }
    }
    
    print("🧪 Testing subscribe_chat_stream MCP tool...")
    
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
            else:
                print(f"❌ Error: {response.text}")
                
        except Exception as e:
            print(f"❌ Request failed: {e}")

if __name__ == "__main__":
    asyncio.run(test_subscribe_chat())