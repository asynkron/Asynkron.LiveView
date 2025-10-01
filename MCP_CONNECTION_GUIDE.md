# MCP Connection Guide

This guide explains how AI agents should connect to the MCP API to avoid common errors like 405.

## Quick Answer

**❌ Wrong:** `http://localhost:8080//mcp` (double slash) → Returns 404 Not Found  
**✅ Correct:** `http://localhost:8080/mcp` → Works correctly

The server now supports both:
- **GET /mcp** → Server discovery and capabilities (JSON response)
- **POST /mcp** → JSON-RPC 2.0 operations

## Connection Methods

There are two ways to connect to the MCP server:

### 1. HTTP Endpoint (Recommended for HTTP-based Agents)

The unified server exposes an HTTP endpoint that supports both discovery and operations.

**Configuration:**
- **URL:** `http://localhost:8080/mcp`
- **Methods:** 
  - `GET` - Discovery endpoint (returns server info and capabilities)
  - `POST` - JSON-RPC 2.0 operations
- **Content-Type:** `application/json` (for POST requests)
- **Protocol:** JSON-RPC 2.0 (for POST requests)

**Discovery (GET):**
```bash
curl http://localhost:8080/mcp
```

Returns JSON with server information, available tools, usage examples, and documentation links.

**Example - Initialize Session:**
```bash
curl -X POST http://localhost:8080/mcp \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "method": "initialize",
    "id": 1,
    "params": {
      "protocolVersion": "2024-11-05",
      "capabilities": {}
    }
  }'
```

**Example - List Tools:**
```bash
curl -X POST http://localhost:8080/mcp \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "method": "tools/list",
    "id": 2
  }'
```

**Example - Call a Tool:**
```bash
curl -X POST http://localhost:8080/mcp \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "method": "tools/call",
    "id": 3,
    "params": {
      "name": "show_content",
      "arguments": {
        "title": "My Document",
        "content": "# Hello World\n\nThis is a test."
      }
    }
  }'
```

### 2. Stdio Protocol (Standard MCP)

The traditional MCP approach uses stdin/stdout for communication.

**Configuration:**
- **Command:** `python mcp_server.py`
- **Communication:** JSON-RPC over stdin/stdout
- **Working Directory:** Repository root

This is what `mcp_config.json` is configured for:
```json
{
  "mcpServers": {
    "markdown-liveview": {
      "command": "python",
      "args": ["mcp_server.py"],
      "cwd": ".",
      "description": "MCP server for managing markdown files"
    }
  }
}
```

## Common Errors and Solutions

### Error: 405 Method Not Allowed

**Cause:** Using GET instead of POST, or incorrect URL path

**Solutions:**
1. ✅ Use `POST` method, not GET
2. ✅ Use `/mcp` (single slash), not `//mcp` (double slash)
3. ✅ Ensure Content-Type is `application/json`

**Example Fix:**
```bash
# ❌ Wrong
curl http://localhost:8080/mcp

# ✅ Correct
curl -X POST http://localhost:8080/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"ping","id":1}'
```

### Error: 404 Not Found

**Cause:** Double slash in URL or MCP not enabled

**Solutions:**
1. ✅ Use `/mcp` not `//mcp`
2. ✅ Ensure unified server is running with MCP enabled (default)
3. ✅ Check server is running: `curl http://localhost:8080/`

### Error: Connection Refused

**Cause:** Server not running

**Solutions:**
1. ✅ Start the unified server: `./run_unified.sh`
2. ✅ Or manually: `python unified_server.py`
3. ✅ Check port 8080 is available: `lsof -i :8080`

## Complete Connection Flow

### 0. Discover Server Capabilities (Optional but Recommended)

First, query the server to discover available tools:

```bash
GET /mcp
```

Response includes:
```json
{
  "protocol": "MCP (Model Context Protocol)",
  "version": "1.15.0",
  "name": "markdown-liveview",
  "capabilities": {...},
  "tools": [...],
  "usage": {...},
  "documentation": {...}
}
```

### 1. Initialize the Session

First request after connection:

```json
POST /mcp
{
  "jsonrpc": "2.0",
  "method": "initialize",
  "id": 1,
  "params": {
    "protocolVersion": "2024-11-05",
    "capabilities": {}
  }
}
```

### 2. Send Initialized Notification

After receiving initialize response:

```json
POST /mcp
{
  "jsonrpc": "2.0",
  "method": "notifications/initialized"
}
```

Note: This is a notification (no id field), server responds with 204 No Content.

### 3. List Available Tools

```json
POST /mcp
{
  "jsonrpc": "2.0",
  "method": "tools/list",
  "id": 2
}
```

Response includes all available tools:
- `show_content` - Create new markdown content
- `list_content` - List all markdown files
- `view_content` - Read a specific file
- `update_content` - Modify existing content
- `remove_content` - Delete a file
- `subscribe_chat` - Subscribe to chat messages
- `get_chat_messages` - Poll for chat messages

### 4. Call Tools

Example - Create content:

```json
POST /mcp
{
  "jsonrpc": "2.0",
  "method": "tools/call",
  "id": 3,
  "params": {
    "name": "show_content",
    "arguments": {
      "title": "Sprint Plan",
      "content": "# Sprint Plan\n\n- Task 1\n- Task 2"
    }
  }
}
```

## Server Status Check

Before connecting, verify the server is running:

```bash
# Check if server is responding
curl http://localhost:8080/

# Check MCP endpoint with ping
curl -X POST http://localhost:8080/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"ping","id":1}'

# Expected response:
# {"jsonrpc": "2.0", "id": 1, "result": {}}
```

## Available MCP Methods

The server supports these JSON-RPC methods:

### Core Methods
- `initialize` - Initialize MCP session (required first)
- `notifications/initialized` - Confirm initialization (notification)
- `ping` - Health check

### Tool Methods
- `tools/list` - Get available tools
- `tools/call` - Execute a tool

### Supported Tools
- `show_content` - Create markdown file with auto-generated File Id
- `list_content` - List all markdown files with metadata
- `view_content` - Read content of a specific File Id
- `update_content` - Append to or replace content
- `remove_content` - Delete a file by File Id
- `subscribe_chat` - Subscribe to chat messages (returns confirmation)
- `get_chat_messages` - Poll for new chat messages since timestamp

## Chat Integration

### Option A: Server-Sent Events (SSE) - Recommended

Connect to the SSE endpoint for push-based chat notifications:

```bash
curl -N http://localhost:8080/mcp/chat/subscribe
```

This returns a Server-Sent Events stream with chat messages from the UI.

### Option B: Polling with get_chat_messages

Use the MCP tool to poll for messages:

```json
POST /mcp
{
  "jsonrpc": "2.0",
  "method": "tools/call",
  "id": 4,
  "params": {
    "name": "get_chat_messages",
    "arguments": {
      "since": 1234567890.0
    }
  }
}
```

## Python Example

```python
import requests
import json

class MCPClient:
    def __init__(self, url="http://localhost:8080/mcp"):
        self.url = url
        self.request_id = 0
    
    def _send_request(self, method, params=None):
        self.request_id += 1
        request = {
            "jsonrpc": "2.0",
            "method": method,
            "id": self.request_id
        }
        if params:
            request["params"] = params
        
        response = requests.post(
            self.url,
            json=request,
            headers={"Content-Type": "application/json"}
        )
        response.raise_for_status()
        return response.json()
    
    def initialize(self):
        return self._send_request("initialize", {
            "protocolVersion": "2024-11-05",
            "capabilities": {}
        })
    
    def list_tools(self):
        return self._send_request("tools/list")
    
    def show_content(self, content, title=None):
        args = {"content": content}
        if title:
            args["title"] = title
        return self._send_request("tools/call", {
            "name": "show_content",
            "arguments": args
        })

# Usage
client = MCPClient()
client.initialize()
print(client.list_tools())
result = client.show_content("# Test\n\nHello from Python!", "Test Doc")
print(result)
```

## Troubleshooting Checklist

- [ ] Server is running on port 8080
- [ ] Using POST method (not GET)
- [ ] URL is `/mcp` (single slash)
- [ ] Content-Type header is `application/json`
- [ ] Request body is valid JSON-RPC 2.0
- [ ] Method name is correct (e.g., `tools/list`, not `list_tools`)
- [ ] Initialized session before calling tools (if required)

## Starting the Server

```bash
# Unified server (HTTP + MCP)
./run_unified.sh

# Or manually
python unified_server.py

# With custom port
python unified_server.py --port 8080

# Disable MCP (LiveView only)
python unified_server.py --disable-mcp
```

## Architecture Diagram

```
┌─────────────┐
│  AI Agent   │
└──────┬──────┘
       │ POST /mcp
       │ (JSON-RPC 2.0)
       ↓
┌──────────────────────┐
│  Unified Server      │
│  localhost:8080      │
│  ┌────────────────┐  │
│  │ MCP Handler    │  │
│  │ - initialize   │  │
│  │ - tools/list   │  │
│  │ - tools/call   │  │
│  └────────┬───────┘  │
│           ↓          │
│  ┌────────────────┐  │
│  │ File Manager   │  │
│  │ (markdown/)    │  │
│  └────────┬───────┘  │
│           ↓          │
│  ┌────────────────┐  │
│  │ File Watcher   │  │
│  └────────┬───────┘  │
│           ↓          │
│  ┌────────────────┐  │
│  │ WebSocket      │  │
│  └────────┬───────┘  │
└───────────┼──────────┘
            ↓
    ┌───────────────┐
    │   Browser     │
    │ (Live View)   │
    └───────────────┘
```

## Summary

**To connect an AI agent to the MCP API:**

1. ✅ Use `POST http://localhost:8080/mcp`
2. ✅ Send JSON-RPC 2.0 formatted requests
3. ✅ Initialize the session first
4. ✅ Use `tools/call` to execute MCP tools
5. ✅ Files created will automatically appear in the LiveView

**Common mistakes to avoid:**
- ❌ Using GET instead of POST
- ❌ Using `//mcp` (double slash)
- ❌ Missing Content-Type header
- ❌ Invalid JSON-RPC format
- ❌ Calling tools before initialization
