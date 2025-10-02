#!/usr/bin/env python3
"""Test FastMCP tools directly using stdio interface."""

import asyncio
import json
import subprocess
import os

async def test_fastmcp_tools():
    """Test FastMCP tools via stdio."""
    
    # Start the server in stdio mode
    process = subprocess.Popen(
        ['venv/bin/python', 'server.py', '--mcp-stdio'],
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        cwd='/Users/rogerjohansson/git/asynkron/Asynkron.LiveView'
    )
    
    try:
        # Send initialize request
        init_request = {
            "jsonrpc": "2.0",
            "id": 1,
            "method": "initialize",
            "params": {
                "protocolVersion": "2024-11-05",
                "capabilities": {}
            }
        }
        
        print("🧪 Testing FastMCP stdio interface...")
        print("📤 Sending initialize request...")
        
        process.stdin.write(json.dumps(init_request) + '\n')
        process.stdin.flush()
        
        # Read response
        response_line = process.stdout.readline()
        if response_line:
            response = json.loads(response_line.strip())
            print("✅ Initialize response:")
            print(json.dumps(response, indent=2))
        
        # List tools
        list_request = {
            "jsonrpc": "2.0", 
            "id": 2,
            "method": "tools/list"
        }
        
        print("\n📤 Listing FastMCP tools...")
        process.stdin.write(json.dumps(list_request) + '\n')
        process.stdin.flush()
        
        response_line = process.stdout.readline()
        if response_line:
            response = json.loads(response_line.strip())
            print("✅ Tools list:")
            print(json.dumps(response, indent=2))
            
            # Show tools nicely
            if 'result' in response and 'tools' in response['result']:
                print("\n🛠️  Available FastMCP Tools:")
                for tool in response['result']['tools']:
                    print(f"  - {tool['name']}: {tool['description']}")
        
        # Test show_content tool
        content_request = {
            "jsonrpc": "2.0",
            "id": 3, 
            "method": "tools/call",
            "params": {
                "name": "show_content",
                "arguments": {
                    "content": "# FastMCP Test\n\nThis content was created via FastMCP!",
                    "title": "FastMCP Test"
                }
            }
        }
        
        print("\n📤 Testing show_content tool...")
        process.stdin.write(json.dumps(content_request) + '\n')
        process.stdin.flush()
        
        response_line = process.stdout.readline()
        if response_line:
            response = json.loads(response_line.strip())
            print("✅ Content creation result:")
            print(json.dumps(response, indent=2))
        
    except Exception as e:
        print(f"❌ Error: {e}")
    finally:
        process.terminate()
        try:
            process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            process.kill()

if __name__ == "__main__":
    asyncio.run(test_fastmcp_tools())