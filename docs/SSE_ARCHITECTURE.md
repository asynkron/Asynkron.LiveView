# SSE Chat Architecture

This document describes the Server-Sent Events (SSE) implementation for real-time chat message delivery.

## Overview

The SSE chat feature enables MCP clients to receive chat messages from the LiveView UI in real-time, without polling. This provides a push-based event stream that's more efficient and responsive than traditional polling.

## Architecture Diagram

```mermaid
sequenceDiagram
    participant Browser as Browser UI
    participant WS as WebSocket Handler
    participant Server as Unified Server
    participant SSE as SSE Handler
    participant MCP as MCP Client
    
    Note over MCP,SSE: MCP Client connects to SSE endpoint
    MCP->>SSE: GET /mcp/chat/subscribe
    SSE->>MCP: 200 OK (text/event-stream)
    SSE->>MCP: data: {"type":"connected",...}
    
    Note over Browser,WS: User sends chat message
    Browser->>WS: WebSocket: {"type":"chat","message":"Hello!"}
    WS->>Server: broadcast_chat_to_mcp("Hello!")
    
    Note over Server: Store message (for backward compatibility)
    Server->>Server: chat_messages.append(...)
    
    Note over Server,SSE: Push to all SSE clients
    Server->>SSE: Send SSE event
    SSE->>MCP: data: {"type":"chat","message":"Hello!","timestamp":...}
    
    Note over MCP: Process message in real-time
    
    Note over SSE,MCP: Heartbeat every 30s
    SSE->>MCP: : heartbeat
```

## Components

### 1. SSE Endpoint (`/mcp/chat/subscribe`)

**Location:** `server.py::handle_chat_sse()`

**Features:**
- Content-Type: `text/event-stream`
- Keep-alive with heartbeat comments every 30 seconds
- Automatic client tracking and cleanup
- Initial connection confirmation message

**Event Format:**
```
data: {"type": "chat", "message": "...", "timestamp": 1234567890.123}

```

### 2. WebSocket Handler

**Location:** `server.py::handle_websocket()`

Receives chat messages from the browser UI and forwards them to `broadcast_chat_to_mcp()`.

### 3. Broadcast Function

**Location:** `server.py::broadcast_chat_to_mcp()`

**Responsibilities:**
1. Store message in memory (backward compatibility with polling)
2. Send message to all connected SSE clients
3. Track disconnected clients and clean up

### 4. Client Tracking

**Location:** `server.py::sse_clients`

A set that tracks all active SSE connections for efficient broadcasting.

## Message Flow

### User sends message from browser:

1. **Browser** → Types message in chat input
2. **Browser** → Sends via WebSocket: `{"type":"chat","message":"..."}`
3. **Server** → Receives message in WebSocket handler
4. **Server** → Calls `broadcast_chat_to_mcp()`
5. **Server** → Stores message in `chat_messages` list
6. **Server** → Iterates through `chat_subscribers` list of asyncio queues
7. **Server** → Pushes the chat payload onto each subscriber queue
8. **MCP Client** → Receives the NDJSON message from the HTTP stream in real-time

### MCP Client subscribes:

1. **MCP Client** → Opens a streaming request to `POST /mcp/stream/chat`
2. **Server** → Creates an asyncio queue and stores it in `chat_subscribers`
3. **Server** → Streams a JSON-RPC confirmation message (NDJSON)
4. **Server** → Awaits new chat events and writes them to the stream
5. **MCP Client** → Iterates over each JSON line and processes the payload

## Backward Compatibility

The polling-based approach is still supported:

Legacy polling APIs have been removed in favor of streaming. Clients should
use the HTTP stream exclusively to avoid latency and resource overhead.

## Implementation Details

### Streaming Message Format

The HTTP stream emits newline-delimited JSON (NDJSON). Each line contains a
JSON-RPC result with the chat message. Because the stream stays open there is
no need for heartbeats or manual reconnection logic unless the network
disconnects.

### Error Handling

- **Connection Errors:** Automatically remove client from `chat_subscribers`
- **Disconnected Clients:** Detected during broadcast, removed from the subscriber list
- **Timeout:** Clients should reconnect if no data received for extended period

## Testing

### Manual Testing

1. Start server: `python server.py`
2. Run example client: `python examples/sse_chat_client.py`
3. Open browser to `http://localhost:8080`
4. Type message in chat input
5. See message appear in real-time in example client

### Automated Testing

```bash
pytest tests/test_unified_server.py::test_sse_chat_subscription -v
```

### Using curl

```bash
curl -N -X POST http://localhost:8080/mcp/stream/chat
```

## Performance Considerations

- **Memory:** Chat messages limited to last 100 entries
- **Connections:** Streaming uses one HTTP connection per client (lightweight)
- **Bandwidth:** Messages only sent when chat activity occurs
- **Heartbeat:** Not required because the NDJSON stream stays active until the client disconnects

## Security Considerations

- No authentication currently implemented (suitable for local development)
- Consider adding auth tokens for production use
- CORS may need configuration for cross-origin access

## Future Enhancements

- [ ] Add authentication/authorization
- [ ] Support filtering by message type
- [ ] Add message history on subscription
- [ ] Implement reconnection with last event ID
- [ ] Add rate limiting for message broadcasts
