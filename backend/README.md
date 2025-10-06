# Node.js Backend (Experimental)

This directory contains the initial Node.js port of the LiveView backend.
The goal is to mirror the behaviour of the existing Python server without
removing any of the original implementation. The port provides the same
HTTP routes, websocket feeds and terminal bridge as the aiohttp version,
although additional polish will be required before it is production ready.

## Quick start

Install dependencies from the repository root so shared tooling such as
ESLint and Prettier stay consistent across the workspaces:

```bash
npm install
```

You can then launch the development server with the same CLI flags exposed by
the Python entrypoint:

```bash
npm run backend:dev -- --path ../markdown --port 8080
```

The `--path` argument selects the markdown directory while `--port` controls
the listening address for both HTTP and websocket traffic. The server mirrors
the Python behaviour by lazily creating the markdown directory and warning
when the frontend bundle is missing.

### Running tests

```bash
npm test --workspace backend
```

Vitest exercises the file manager helpers and the HTTP routes so changes to
the Node backend surface regressions quickly. Additional scripts are
available for linting and formatting:

```bash
npm run lint --workspace backend
npm run format --workspace backend
```

Both commands rely on the shared ESLint and Prettier configuration defined at
the repository root.

## Feature parity notes

- File discovery and metadata are handled by `FileManager`, closely matching
  the recursive tree builder found in `components/file_manager.py`.
- REST endpoints offer the same contract as the Python server and reuse the
  shared templates from the repository root to render the initial HTML.
- A `ws` powered broadcast channel emits directory updates that are triggered
  by a `chokidar` watcher, replicating the watchdog integration from the
  original backend. Watchers are reference counted so they are released when
  the last websocket subscriber disconnects.
- Terminal support is implemented with `node-pty`. The plumbing mirrors the
  behaviour of the asyncio variant but still needs robustness and security
  hardening before deployment.
- Path resolution now handles encoded inputs and `~`-prefixed home directories,
  keeping the CLI flags compatible with the Python implementation.

This code is meant as a starting point for further iteration; expect gaps
and TODO items as we expand the Node.js implementation.
