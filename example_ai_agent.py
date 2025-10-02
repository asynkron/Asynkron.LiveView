#!/usr/bin/env python3
"""
Example: How an AI agent would use the HTTP streaming chat endpoint.
This demonstrates the complete workflow for MCP chat streaming.
"""

import asyncio
import json
import httpx


class MCPChatAgent:
    """Example AI agent that subscribes to live chat messages."""
    
    def __init__(self, base_url: str = "http://localhost:8080"):
        self.base_url = base_url
        self.client = None
        
    async def initialize_mcp(self):
        """Initialize MCP connection."""
        payload = {
            "jsonrpc": "2.0",
            "method": "initialize",
            "id": 1,
            "params": {
                "protocolVersion": "2024-11-05",
                "capabilities": {}
            }
        }
        
        async with httpx.AsyncClient() as client:
            response = await client.post(f"{self.base_url}/mcp", json=payload)
            if response.status_code == 200:
                print("✅ MCP connection initialized")
                return True
            else:
                print(f"❌ MCP initialization failed: {response.status_code}")
                return False
    
    async def get_streaming_endpoint(self):
        """Get information about the streaming endpoint."""
        payload = {
            "jsonrpc": "2.0",
            "method": "tools/call",
            "id": 2,
            "params": {
                "name": "get_stream_chat_endpoint",
                "arguments": {}
            }
        }
        
        async with httpx.AsyncClient() as client:
            response = await client.post(f"{self.base_url}/mcp", json=payload)
            if response.status_code == 200:
                result = response.json()
                if "result" in result and "content" in result["result"]:
                    info = result["result"]["content"][0]["text"]
                    print(f"📡 Streaming info: {info}")
                    return True
            return False
    
    async def subscribe_to_chat_stream(self):
        """Subscribe to live chat messages using HTTP streaming."""
        print("🔗 Connecting to chat stream...")
        
        try:
            async with httpx.AsyncClient(timeout=None) as client:
                async with client.stream('POST', f'{self.base_url}/mcp/stream/chat') as response:
                    print(f"✅ Connected to stream! Status: {response.status_code}")
                    print("🎧 Listening for chat messages...")
                    print("-" * 50)
                    
                    async for line in response.aiter_lines():
                        if line.strip():
                            try:
                                data = json.loads(line)
                                await self.process_streaming_message(data)
                            except json.JSONDecodeError as e:
                                print(f"⚠️  JSON decode error: {e}")
                                
        except httpx.ConnectError:
            print("❌ Failed to connect to streaming endpoint")
        except Exception as e:
            print(f"❌ Streaming error: {e}")
    
    async def process_streaming_message(self, message: dict):
        """Process a received streaming message."""
        if "result" in message:
            result = message["result"]
            print(f"💬 Received: {result}")
            
            # Here's where your AI agent would process the message
            # For example, you might:
            # - Analyze the message content
            # - Generate a response
            # - Store it in a database
            # - Trigger other workflows
            
            if "💬" in result:  # It's a chat message
                await self.respond_to_chat_message(result)
                
        elif "error" in message:
            error = message["error"]
            print(f"❌ Stream error: {error['message']}")
    
    async def respond_to_chat_message(self, message: str):
        """Example: AI agent responds to a chat message."""
        # Extract the actual message content (this is a simplified example)
        if "] " in message:
            user_message = message.split("] ", 1)[1] if len(message.split("] ", 1)) > 1 else ""
            print(f"🤖 AI Agent analyzing: '{user_message}'")
            
            # Here you would typically:
            # 1. Process the message with your AI model
            # 2. Generate a response
            # 3. Send it back through another MCP tool or API
            
            # For demo purposes, just print what the agent would do
            if user_message.lower().strip():
                print(f"🤖 AI Agent would respond to: '{user_message}'")
                # You could use the show_content MCP tool to respond:
                # await self.send_response_via_mcp(f"AI Response to: {user_message}")
    
    async def send_response_via_mcp(self, response_content: str):
        """Send a response back through MCP."""
        payload = {
            "jsonrpc": "2.0",
            "method": "tools/call",
            "id": 999,
            "params": {
                "name": "show_content",
                "arguments": {
                    "content": response_content,
                    "title": "AI Agent Response"
                }
            }
        }
        
        async with httpx.AsyncClient() as client:
            response = await client.post(f"{self.base_url}/mcp", json=payload)
            if response.status_code == 200:
                print("🤖 AI response sent via MCP")
            else:
                print(f"❌ Failed to send AI response: {response.status_code}")


async def main():
    """Demonstrate the AI agent workflow."""
    print("🤖 AI Agent Chat Stream Demo")
    print("=" * 40)
    
    agent = MCPChatAgent()
    
    # Step 1: Initialize MCP
    if not await agent.initialize_mcp():
        return
    
    # Step 2: Get streaming endpoint info
    await agent.get_streaming_endpoint()
    
    print("\n🎬 Starting chat stream subscription...")
    print("💡 Now send messages from the UI at http://localhost:8080")
    print("   The AI agent will receive and process them in real-time!")
    print("-" * 40)
    
    # Step 3: Subscribe to chat stream (runs until interrupted)
    await agent.subscribe_to_chat_stream()


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("\n🛑 AI Agent stopped by user")