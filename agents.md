# Agent Development Guidelines

## Live Chat Fan-out

The chat bridge no longer uses MCP or the HTTP streaming endpoint. Chat traffic
is delivered to CLI agents through a lightweight host process that connects to
`/agent-feed` via WebSocket and injects messages into the child agent's stdin.

### ✅ Required approach
- Use the `clihost.py` helper to run agents as child processes.
- The host connects to `ws://localhost:8080/agent-feed` and forwards JSON
  messages that look like `{ "type": "chat", "text": "..." }` to the agent.
- The host is responsible for keeping the terminal interactive for the user and
  relaying server-sent chat messages into the agent's stdin.

### ❌ Forbidden patterns
- Re-introducing MCP chat tooling or the `/mcp/stream/chat` endpoint.
- Polling the server for chat updates instead of using the WebSocket feed.
- Spawning additional network transports that duplicate the agent feed.

### Development tips
- Keep comments concise but clarify non-obvious decisions in code and tests.
- When extending the host or server, ensure chat messages remain push-based and
  that the terminal experience stays smooth for humans.
- If you need to fan chat messages back to the server, prefer WebSocket messages
  to match the existing push pipeline.

Following these conventions keeps the chat stack consistent and avoids the
flakiness that the old MCP streaming integration introduced.
