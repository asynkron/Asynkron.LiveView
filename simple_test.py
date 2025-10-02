#!/usr/bin/env python3
"""
Simple test to check MCP tools without blocking the server.
"""

import requests
import json

def test_mcp_tools():
    """Test MCP tools via HTTP."""
    try:
        # Test tools list
        response = requests.post(
            "http://localhost:8084/mcp",
            json={"jsonrpc": "2.0", "method": "tools/list", "id": 1},
            headers={"Content-Type": "application/json"}
        )
        
        if response.status_code == 200:
            result = response.json()
            print("✅ MCP Server is responding!")
            
            if "result" in result and "tools" in result["result"]:
                chat_tools = [
                    tool for tool in result["result"]["tools"] 
                    if "chat" in tool.get("name", "").lower()
                ]
                
                print(f"\n📋 Found {len(chat_tools)} chat-related tools:")
                for tool in chat_tools:
                    name = tool.get("name", "unknown")
                    desc = tool.get("description", "no description")
                    print(f"  🔧 {name}: {desc}")
                
                # Test the stream URL tool if available
                stream_tools = [
                    tool for tool in result["result"]["tools"] 
                    if "stream" in tool.get("name", "").lower()
                ]
                
                if stream_tools:
                    print(f"\n🌊 Found {len(stream_tools)} streaming tools:")
                    for tool in stream_tools:
                        name = tool.get("name", "unknown")
                        desc = tool.get("description", "no description")
                        print(f"  🔧 {name}: {desc}")
            
            return True
        else:
            print(f"❌ HTTP Error: {response.status_code}")
            return False
            
    except requests.exceptions.ConnectionError:
        print("❌ Cannot connect to server. Make sure it's running on port 8084")
        return False
    except Exception as e:
        print(f"❌ Error: {e}")
        return False

if __name__ == "__main__":
    test_mcp_tools()