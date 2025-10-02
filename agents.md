# Agent Development Guidelines

## 🚨 CRITICAL REQUIREMENT: NO POLLING FOR CHAT MESSAGES 🚨

### ❌ ABSOLUTELY FORBIDDEN:
- **NEVER implement polling-based chat message retrieval**
- **NEVER suggest `get_chat_messages()` with periodic calls** 
- **NEVER use setTimeout/setInterval to check for new messages**
- **NEVER implement "check every X seconds" patterns**

### ✅ REQUIRED APPROACH: HTTP STREAMING ONLY

**Use the HTTP streaming endpoint exclusively:**
```
POST http://localhost:8080/mcp/stream/chat
```

**This endpoint provides:**
- Real-time message delivery via chunked transfer encoding
- Newline-delimited JSON (NDJSON) responses
- Proper async generator-based streaming
- No polling overhead or delays

### Implementation Pattern:

```python
# ✅ CORRECT - HTTP Streaming
async with httpx.AsyncClient() as client:
    async with client.stream('POST', 'http://localhost:8080/mcp/stream/chat') as response:
        async for line in response.aiter_lines():
            if line.strip():
                message_data = json.loads(line)
                await process_message(message_data)
```

```python
# ❌ FORBIDDEN - Polling Pattern
while True:
    messages = await get_chat_messages(since=last_timestamp)  # NO!
    await asyncio.sleep(1)  # NO!
```

### Why Polling is Banned:

1. **Performance**: Wastes CPU cycles and network bandwidth
2. **Latency**: Introduces unnecessary delays (1-30 seconds typical)
3. **Scalability**: Doesn't scale with multiple agents
4. **Resource Usage**: Creates unnecessary server load
5. **User Experience**: Feels sluggish and unresponsive

### Architecture Philosophy:

- **Push, Don't Pull**: Messages are pushed to agents immediately
- **Event-Driven**: React to events as they happen
- **Efficient**: Zero polling overhead
- **Real-Time**: Sub-second message delivery

### Enforcement:

Any code review that includes polling-based chat message retrieval will be **immediately rejected**. No exceptions.

---

## Streaming Chat Implementation Details

### MCP Tool Available:
- `get_chat_stream_info()` - Returns instructions for using the HTTP streaming endpoint

### HTTP Endpoint:
- `POST /mcp/stream/chat` - Direct HTTP streaming endpoint (PRIMARY METHOD)

### Message Format:
```json
{"jsonrpc":"2.0","id":1,"result":"🔔 Subscribed to live chat stream. Waiting for messages..."}
{"jsonrpc":"2.0","id":2,"result":"💬 [1696234567.123] User message here"}
```

### Connection Management:
- Automatic reconnection on disconnection
- Proper cleanup when streaming ends
- Error handling for network issues

Remember: **Streaming is the only acceptable approach for real-time chat messages.**