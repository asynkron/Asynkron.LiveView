# Markdown Live View

Markdown Live View renders markdown files in real time, keeps the browser in sync
with file system changes, and now delivers chat prompts to local CLI agents
through a lightweight host process.

## What's new?

* ❌ **No MCP dependency** – the chat bridge no longer relies on MCP or the
  `/mcp/stream/chat` HTTP endpoint.
* 🌐 **WebSocket agent feed** – CLI host processes connect to
  `ws://localhost:8080/agent-feed` and receive chat lines pushed by the server.
* 🖥️ **Terminal-friendly agent host** – the new `clihost.py` wrapper keeps the
  user's terminal interactive while piping server messages into the child agent's
  stdin.

## Project layout

```
Asynkron.LiveView/
├── components/              # Shared modules for file handling and templates
├── markdown/                # Sample markdown files used by the UI
├── templates/unified_index.html  # The Live View HTML shell
├── server.py                # aiohttp server (Live View + agent feed)
├── clihost.py               # CLI agent host helper
└── tests/                   # pytest suite for the web server
```

## Requirements

* Python 3.9+
* `pip install -r requirements.txt`

The dependency list is short: aiohttp for HTTP/WebSocket handling, watchdog for
file change notifications, and websockets for the CLI host utility.

## Running the server

```bash
python server.py --dir markdown --port 8080
```

Key flags:

* `--dir` – directory to watch for markdown content (defaults to `markdown/`).
* `--port` – HTTP port for the Live View UI and agent feed (defaults to `8080`).

### Switching directories at runtime

The server can watch a different directory without restarting:

1. **Query parameter** – `http://localhost:8080/?path=/tmp/notes`
2. **Environment variable** – `LIVEVIEW_PATH=/tmp/notes python server.py`
3. **`--dir` argument** – `python server.py --dir /tmp/notes`

If a directory is empty or missing, the UI shows a helpful placeholder
explaining how to point it at real content.

## Hosting a CLI agent

Run the new host wrapper to keep your agent interactive:

```bash
python clihost.py --url ws://localhost:8080/agent-feed -- python my_agent.py
```

How it works:

1. The host launches `python my_agent.py` as a child process with stdin/stdout
   pipes.
2. Keyboard input from the user is forwarded directly to the child.
3. Messages pushed by the server are displayed with a prefix (optional) and then
   injected into the child's stdin as if the user had typed them.
4. The host automatically reconnects to the WebSocket feed if the connection is
   interrupted.

Useful host flags:

* `--url` – WebSocket endpoint (defaults to `ws://localhost:8080/agent-feed`).
* `--echo-injections` – show a prefix (default `[server] `) before injected
  lines so humans can tell they came from the server.
* `--no-user-stdin` – disable forwarding of keyboard input, turning the host
  into a one-way injector.
* `--newline` – override the newline appended to chat messages before they are
  written to stdin.

## Chat message flow

1. The Live View UI posts chat messages over the existing `/ws` WebSocket.
2. `server.py` fans each message out to every connected CLI host via
   `/agent-feed`.
3. `clihost.py` writes the message to the agent's stdin, preserving the normal
   interactive terminal feel.

There is no polling and no MCP transport in the loop. If you extend the system,
keep chat delivery push-based so agents remain responsive.

## Development workflow

### Install dependencies

```bash
python -m pip install -r requirements.txt
```

### Run the server during development

```bash
python server.py --dir markdown --port 8080
```

### Run the agent host (optional)

```bash
python clihost.py --url ws://localhost:8080/agent-feed -- your-agent --flag
```

### Run tests

```bash
pytest
```

The test suite focuses on the aiohttp routes and the new agent feed to ensure
chat messages reach connected hosts.

## Troubleshooting

* **WebSocket disconnects** – `clihost.py` automatically reconnects. Use
  `--no-reconnect` if you prefer it to fail fast.
* **Agent requires a TTY** – enable PTY mode inside `clihost.py` (see the inline
  comments) if your agent depends on terminal detection.
* **No chat delivery** – confirm the browser is sending chat messages, and check
  the server logs to ensure a host is connected. The log lines include host
  counts whenever a connection joins or leaves.

## Contributing

* Keep comments informative but brief.
* Do not reintroduce the old MCP endpoints.
* Prefer async, push-based communication for anything related to chat.

Enjoy building against the streamlined Live View stack! 🚀
