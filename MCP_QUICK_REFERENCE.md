# MCP Quick Reference

## The 405 Error Fix

**Problem:** `http://localhost:8080//mcp` returned 405 Method Not Allowed

**Solution:** The server now supports both GET (discovery) and POST (operations):

```bash
# ✅ Discovery - GET request for server info and capabilities
GET http://localhost:8080/mcp

# ✅ Operations - POST request for JSON-RPC operations
POST http://localhost:8080/mcp
```

## Quick Start

### 1. Discover Server Capabilities (NEW!)
```bash
curl http://localhost:8080/mcp
```

Returns server info, available tools, and usage examples.

### 2. Test Connection
```bash
curl -X POST http://localhost:8080/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"ping","id":1}'
```

Expected response:
```json
{"jsonrpc": "2.0", "id": 1, "result": {}}
```

### 2. Initialize Session
```bash
curl -X POST http://localhost:8080/mcp \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc":"2.0",
    "method":"initialize",
    "id":1,
    "params":{
      "protocolVersion":"2024-11-05",
      "capabilities":{}
    }
  }'
```

### 3. Create Content
```bash
curl -X POST http://localhost:8080/mcp \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc":"2.0",
    "method":"tools/call",
    "id":2,
    "params":{
      "name":"show_content",
      "arguments":{
        "title":"My Document",
        "content":"# Hello World\n\nThis is my content."
      }
    }
  }'
```

## Connection Requirements

| Requirement | Value |
|-------------|-------|
| **URL** | `http://localhost:8080/mcp` |
| **Methods** | `GET` (discovery), `POST` (operations) |
| **Content-Type** | `application/json` (for POST) |
| **Protocol** | JSON-RPC 2.0 (for POST) |

## Common Errors

| Error | Cause | Fix |
|-------|-------|-----|
| **405 Method Not Allowed** | Using unsupported method (e.g., PUT, DELETE) | Use `GET` or `POST` |
| **404 Not Found** | Double slash in URL (`//mcp`) | Use `/mcp` (single slash) |
| **Connection Refused** | Server not running | Start server: `./run_unified.sh` |
| **400 Bad Request** | Invalid JSON-RPC on POST | Check JSON format |

## Available Tools

1. **show_content** - Create new markdown file
   - `content` (required): Markdown text
   - `title` (optional): Display name

2. **list_content** - List all markdown files
   - No parameters

3. **view_content** - Read a file
   - `fileId` (required): File identifier

4. **update_content** - Modify existing file
   - `fileId` (required): File identifier
   - `content` (required): New content
   - `mode` (optional): "append" or "replace"

5. **remove_content** - Delete a file
   - `fileId` (required): File identifier

6. **get_chat_stream_info** - Streaming endpoint instructions
   - No parameters

7. **subscribe_chat_stream** - Quick reference for the streaming endpoint
   - No parameters

## Example Session

```bash
# 1. Initialize
curl -X POST http://localhost:8080/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"initialize","id":1,"params":{"protocolVersion":"2024-11-05","capabilities":{}}}'

# 2. Confirm initialization (notification - no response)
curl -X POST http://localhost:8080/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"notifications/initialized"}'

# 3. List tools
curl -X POST http://localhost:8080/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"tools/list","id":2}'

# 4. Create content
curl -X POST http://localhost:8080/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"tools/call","id":3,"params":{"name":"show_content","arguments":{"content":"# Test"}}}'

# Response will include File Id like: "File Id: abc123.md"

# 5. View content
curl -X POST http://localhost:8080/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"tools/call","id":4,"params":{"name":"view_content","arguments":{"fileId":"abc123.md"}}}'
```

## Configuration for AI Assistants

If your AI assistant uses MCP configuration files, use:

```json
{
  "mcpServers": {
    "markdown-liveview": {
      "url": "http://localhost:8080/mcp",
      "transport": "http"
    }
  }
}
```

Or for stdio transport (traditional MCP):

```json
{
  "mcpServers": {
    "markdown-liveview": {
      "command": "python",
      "args": ["mcp_server.py"],
      "cwd": "/path/to/Asynkron.LiveView"
    }
  }
}
```

## Verifying Server Status

```bash
# Check if server is running
curl http://localhost:8080/

# Quick MCP health check
curl -X POST http://localhost:8080/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"ping","id":1}'
```

## See Also

- [MCP_CONNECTION_GUIDE.md](./MCP_CONNECTION_GUIDE.md) - Comprehensive guide
- [MCP_INTEGRATION.md](./MCP_INTEGRATION.md) - Integration details
- [README.md](./README.md) - Full documentation
