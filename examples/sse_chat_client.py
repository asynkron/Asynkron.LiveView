#!/usr/bin/env python3
"""
Example SSE Chat Client

This script demonstrates how to connect to the SSE chat endpoint
and receive real-time chat messages from the LiveView UI.

Usage:
    python sse_chat_client.py [--url http://localhost:8080]
"""

import asyncio
import aiohttp
import json
import sys
from datetime import datetime

async def listen_to_chat(base_url: str = "http://localhost:8080"):
    """
    Connect to the SSE chat endpoint and listen for messages.
    
    Args:
        base_url: Base URL of the server (default: http://localhost:8080)
    """
    sse_url = f"{base_url}/mcp/chat/subscribe"
    
    print(f"🔌 Connecting to SSE endpoint: {sse_url}")
    print("=" * 60)
    
    try:
        async with aiohttp.ClientSession() as session:
            async with session.get(sse_url) as response:
                if response.status != 200:
                    print(f"❌ Failed to connect: HTTP {response.status}")
                    return
                
                print("✅ Connected! Listening for chat messages...")
                print("   (Press Ctrl+C to exit)")
                print("=" * 60)
                print()
                
                # Read SSE stream line by line
                async for line in response.content:
                    line_str = line.decode('utf-8').strip()
                    
                    # Skip empty lines
                    if not line_str:
                        continue
                    
                    # Handle heartbeat comments
                    if line_str.startswith(':'):
                        print("💓 [heartbeat]", flush=True)
                        continue
                    
                    # Handle data lines
                    if line_str.startswith('data: '):
                        data_json = line_str[6:]  # Remove 'data: ' prefix
                        try:
                            data = json.loads(data_json)
                            
                            if data.get('type') == 'connected':
                                print(f"📡 {data.get('message')}")
                                print()
                            elif data.get('type') == 'chat':
                                timestamp = data.get('timestamp', 0)
                                time_str = datetime.fromtimestamp(timestamp).strftime('%H:%M:%S')
                                message = data.get('message', '')
                                print(f"💬 [{time_str}] {message}")
                            else:
                                print(f"📨 Received: {data}")
                        except json.JSONDecodeError as e:
                            print(f"⚠️  Failed to parse JSON: {e}")
                            print(f"   Raw data: {data_json}")
    
    except aiohttp.ClientError as e:
        print(f"❌ Connection error: {e}")
        print(f"   Make sure the server is running at {base_url}")
    except KeyboardInterrupt:
        print("\n\n👋 Disconnected by user")
    except Exception as e:
        print(f"❌ Unexpected error: {e}")
        import traceback
        traceback.print_exc()

def main():
    """Main entry point."""
    import argparse
    
    parser = argparse.ArgumentParser(
        description='Connect to SSE chat endpoint and listen for messages'
    )
    parser.add_argument(
        '--url',
        default='http://localhost:8080',
        help='Base URL of the server (default: http://localhost:8080)'
    )
    
    args = parser.parse_args()
    
    print("SSE Chat Client Example")
    print("=" * 60)
    print()
    
    # Run the async function
    asyncio.run(listen_to_chat(args.url))

if __name__ == "__main__":
    main()
