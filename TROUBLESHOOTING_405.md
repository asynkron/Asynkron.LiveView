# Troubleshooting: 405 Method Not Allowed Error

## Problem Statement

When connecting to the MCP API at `http://localhost:8080//mcp`, the server returns a **405 Method Not Allowed** error.

## Root Cause Analysis

The 405 error occurred because the MCP endpoint initially only accepted **POST requests** for JSON-RPC operations. However, many AI agents first issue a **GET request** for discovery/capabilities.

**FIXED:** The server now supports both:

```
✅ GET  http://localhost:8080/mcp   → 200 OK (Discovery/Info)
✅ POST http://localhost:8080/mcp   → 200 OK (JSON-RPC Operations)
```

Additionally, the double slash in the URL (`//mcp`) causes a **404 Not Found** error:

```
❌ POST http://localhost:8080//mcp  → 404 Not Found
✅ POST http://localhost:8080/mcp   → 200 OK
```

## Solution

### Correct Connection Configuration

**URL:** `http://localhost:8080/mcp` (single slash)  
**Methods:** 
- `GET` - Discovery/capabilities endpoint (returns server info)
- `POST` - JSON-RPC 2.0 operations (requires Content-Type: application/json)

### Discovery Endpoint (GET)

AI agents can first query the server capabilities:

```bash
curl http://localhost:8080/mcp
```

Returns server information, available tools, and usage examples.

### Operations Endpoint (POST)

For actual MCP operations:

**Headers:** `Content-Type: application/json`  
**Body:** JSON-RPC 2.0 formatted request

### Example Request

```bash
curl -X POST http://localhost:8080/mcp \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "method": "ping",
    "id": 1
  }'
```

### Expected Response

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": {}
}
```

## Why This Design?

The MCP server uses **JSON-RPC 2.0 protocol**, which:

1. **Requires POST requests** - All JSON-RPC operations are performed via POST
2. **Uses structured messages** - Request/response format is standardized
3. **Supports bidirectional communication** - Client and server can both initiate requests

This is the standard approach for JSON-RPC over HTTP and aligns with the MCP specification.

## Code Reference

From `server.py`:

```python
if self.enable_mcp:
    app.router.add_post('/mcp', self.handle_mcp_http)

app.router.add_get('/agent-feed', self.handle_agent_feed)
```

The route is explicitly registered as **POST only** using `add_post()`, not `add_get()`.

## Verification Steps

### 1. Check Server Status

```bash
curl http://localhost:8080/
# Should return the LiveView HTML page
```

### 2. Test MCP Endpoint with Ping

```bash
curl -X POST http://localhost:8080/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"ping","id":1}'
# Should return: {"jsonrpc": "2.0", "id": 1, "result": {}}
```

### 3. Initialize MCP Session

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
# Should return initialization response with server capabilities
```

### 4. Create Test Content

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
        "content":"# Test\n\nThis is a test file."
      }
    }
  }'
# Should return success with a File Id
```

## AI Agent Configuration

### For HTTP-based MCP Clients

Configure your AI agent to connect to:

```json
{
  "url": "http://localhost:8080/mcp",
  "method": "POST",
  "headers": {
    "Content-Type": "application/json"
  },
  "protocol": "json-rpc-2.0"
}
```

### For Stdio-based MCP Clients

Use the traditional MCP configuration:

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

This spawns a separate process that communicates via stdin/stdout.

## Error Reference

| HTTP Status | Cause | Solution |
|-------------|-------|----------|
| **405 Method Not Allowed** | Using GET, PUT, DELETE, etc. | Use POST method |
| **404 Not Found** | Wrong URL path (e.g., `//mcp`) | Use `/mcp` (single slash) |
| **400 Bad Request** | Invalid JSON-RPC format | Check JSON structure |
| **500 Internal Server Error** | Server-side error | Check server logs |
| **Connection Refused** | Server not running | Start server: `./run_unified.sh` |

## Architecture Overview

```
┌──────────────┐
│  AI Agent    │
└──────┬───────┘
       │
       │ POST /mcp
       │ Content-Type: application/json
       │ {"jsonrpc":"2.0", "method":"...", ...}
       │
       ↓
┌────────────────────────────┐
│  Unified Server            │
│  localhost:8080            │
│                            │
│  Route: POST /mcp          │ ← Only POST accepted
│  Handler: handle_mcp_http  │
│                            │
│  ┌──────────────────────┐  │
│  │ JSON-RPC Parser     │  │
│  │ - initialize        │  │
│  │ - tools/list        │  │
│  │ - tools/call        │  │
│  │ - ping              │  │
│  └──────────────────────┘  │
│                            │
│  ┌──────────────────────┐  │
│  │ MCP Tools           │  │
│  │ - show_content      │  │
│  │ - list_content      │  │
│  │ - view_content      │  │
│  │ - update_content    │  │
│  │ - remove_content    │  │
│  └──────────────────────┘  │
│                            │
│  ┌──────────────────────┐  │
│  │ File System         │  │
│  │ markdown/*.md       │  │
│  └──────────────────────┘  │
└────────────────────────────┘
```

## Testing the Fix

A complete test has been performed and verified:

```bash
# All tests passed ✅
1. Ping test: OK
2. Initialize session: OK
3. Send initialized notification: OK (204 No Content)
4. List available tools: OK (7 tools found)
5. Test show_content tool: OK (File created: 1dbd2be7.md)
```

The created file is visible in:
- File system: `markdown/1dbd2be7.md`
- LiveView: `http://localhost:8080/`
- API: `http://localhost:8080/api/content`

## Summary

**The Issue:** Agent was using GET method or wrong URL path  
**The Fix:** Use `POST http://localhost:8080/mcp` with JSON-RPC 2.0 format  
**Verification:** Tested and working with all MCP operations  

## Related Documentation

- [MCP_CONNECTION_GUIDE.md](./MCP_CONNECTION_GUIDE.md) - Complete connection guide
- [MCP_QUICK_REFERENCE.md](./MCP_QUICK_REFERENCE.md) - Quick reference card
- [MCP_INTEGRATION.md](./MCP_INTEGRATION.md) - Integration details
- [README.md](./README.md) - Full system documentation

## Need Help?

If you're still experiencing issues:

1. **Check server is running:** `curl http://localhost:8080/`
2. **Verify MCP endpoint:** `curl -X POST http://localhost:8080/mcp -H "Content-Type: application/json" -d '{"jsonrpc":"2.0","method":"ping","id":1}'`
3. **Check server logs:** Look for error messages in the terminal running the server
4. **Verify port is available:** `lsof -i :8080` (should show Python process)
5. **Test with curl examples:** Copy-paste the examples above to verify basic connectivity

## Quick Commands Reference

```bash
# Start the server
./run_unified.sh

# Test connectivity
curl http://localhost:8080/

# Test MCP endpoint
curl -X POST http://localhost:8080/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"ping","id":1}'

# Create content via MCP
curl -X POST http://localhost:8080/mcp \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc":"2.0",
    "method":"tools/call",
    "id":1,
    "params":{
      "name":"show_content",
      "arguments":{
        "content":"# Hello from MCP!\n\nThis works!"
      }
    }
  }'

# View in browser
open http://localhost:8080/
```
