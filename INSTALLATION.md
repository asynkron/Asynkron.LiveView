# Installation Guide

This document explains how to install and run Asynkron.LiveView using the Node.js toolchain. The
Python backend has been removed, so the instructions below focus entirely on the Express-based
implementation contained in the monorepo.

## Requirements

- Node.js 18 or newer
- npm 9 or newer

If you use `nvm`, install the recommended version and run `nvm use` before continuing.

## Quick start

```bash
# Install workspace dependencies
npm install

# Build the browser bundle that the backend serves
npm run frontend:build

# Launch the backend in development mode
npm run backend:dev -- --path markdown --port 8080
```

Open `http://localhost:8080/?path=/absolute/path/to/your/logs` in a browser to start exploring your
markdown directory. The `--path` flag defaults to `markdown` inside the repository, and the `--port`
flag defaults to `8080`.

## Workspace layout

```
apps/
  backend/   Express server, shared file watcher logic and Vitest suites
  frontend/  Static assets built with esbuild and exercised via Node test runners
```

The backend automatically serves the files under `apps/backend/public`. When you run
`npm run frontend:build` the latest JavaScript and CSS bundles are emitted to
`apps/backend/public/static/dist`.

## Scripts

From the repository root you can run:

- `npm run backend:start` – start the backend using the production entry point
- `npm run backend:dev` – run the backend with watch-friendly logging
- `npm run frontend:build` – compile the frontend bundle
- `npm run lint` – execute ESLint in every workspace
- `npm test` – run Vitest suites for the backend and Node-based frontend utilities

Target a single workspace by passing the package name:

```bash
npm run lint --workspace asynkron-liveview-frontend
npm run test --workspace asynkron-liveview-backend
```

## Environment tips

- The backend watches the provided markdown directory using `chokidar`. Ensure the process has read
  and write access so file updates propagate to the browser.
- When deploying, build the frontend bundle and run `npm run backend:start` so the server boots from
  the compiled sources.
- The repository ships with an example `markdown/` directory that you can use to experiment with the
  UI before hooking it up to a real log folder.

With these steps you can work entirely within the Node.js stack without relying on legacy Python
artifacts.
