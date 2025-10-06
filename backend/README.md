# Node.js Backend (Experimental)

This directory contains the initial Node.js port of the LiveView backend.
The goal is to mirror the behaviour of the existing Python server without
removing any of the original implementation.  The port provides the same
HTTP routes, websocket feeds and terminal bridge as the aiohttp version,
although additional polish will be required before it is production ready.

## Quick start

```bash
cd backend
npm install
npm run dev -- --path ../markdown --port 8080
```

The command above keeps the CLI identical to `python server.py`.  The
`--path` argument selects the markdown directory while `--port` controls the
listening address for both HTTP and websocket traffic.

## Feature parity notes

- File discovery and metadata are handled by `FileManager`, closely matching
  the recursive tree builder found in `components/file_manager.py`.
- REST endpoints offer the same contract as the Python server and reuse the
  shared templates from the repository root to render the initial HTML.
- A `ws` powered broadcast channel emits directory updates that are triggered
  by a `chokidar` watcher, replicating the watchdog integration from the
  original backend.
- Terminal support is implemented with `node-pty`.  The plumbing mirrors the
  behaviour of the asyncio variant but still needs robustness and security
  hardening before deployment.

This code is meant as a starting point for further iteration; expect gaps
and TODO items as we expand the Node.js implementation.
