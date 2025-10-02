# Examples

This directory contains example scripts demonstrating various features of Asynkron.LiveView.

## SSE Chat Client

**File:** `sse_chat_client.py`

A simple Python client that connects to the SSE (Server-Sent Events) endpoint to receive real-time chat messages from the LiveView UI.

### Usage

1. Start the unified server:
   ```bash
   cd ..
   python server.py
   ```

2. Run the SSE chat client:
   ```bash
   python sse_chat_client.py
   ```

3. Open the browser to `http://localhost:8080` and type a message in the chat input

4. Watch the message appear in real-time in the SSE chat client!

### Options

```bash
# Connect to a different server
python sse_chat_client.py --url http://example.com:3000
```

### Example Output

```
SSE Chat Client Example
============================================================

🔌 Connecting to streaming endpoint: POST http://localhost:8080/mcp/stream/chat
============================================================
✅ Connected! Listening for chat messages...
   (Press Ctrl+C to exit)
============================================================

📡 Successfully subscribed to chat messages

💬 [16:26:29] Hello from the browser!
💬 [16:27:15] This is a real-time message!
```

## How It Works

1. The example client opens a streaming POST request to `/mcp/stream/chat`
2. The server responds with newline-delimited JSON (chunked transfer encoding)
3. When users type messages in the browser, they're sent via WebSocket
4. The server broadcasts these messages to all streaming subscribers
5. The client receives and displays the messages in real-time

This demonstrates the **push-based** streaming approach that replaces legacy polling patterns.
