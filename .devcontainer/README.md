# Dev Container

This configuration makes it easy to develop the Asynkron LiveView project inside a GitHub Codespaces or VS Code Dev Containers workspace.

- **Image**: Based on the official JavaScript/Node.js dev container image so the runtime matches the project's requirements.
- **Features**: Ensures Node.js 20 is present and installs the GitHub CLI for repository workflows.
- **Post-create command**: Runs `npm install --omit=optional` so workspaces are bootstrapped quickly without compiling optional native modules. If you need terminal emulation via `node-pty`, run `npm install` manually after the container is ready.
- **Forwarded port**: Exposes port 8080 which is used by the backend server.
- **VS Code customizations**: Adds ESLint and Prettier extensions and enables format-on-save for a consistent developer experience.

## Mount a local markdown directory

LiveView is most useful when it can see the markdown logs that your agents create on the host. You can
share a host folder with the dev container in two ways, depending on whether you prefer the CLI or
the VS Code UI.

### Option 1: Use the helper script (CLI)

1. Install the [Dev Container CLI](https://github.com/devcontainers/cli) if you have not already:

   ```bash
   npm install -g @devcontainers/cli
   ```

2. Run the helper from the repository root. The script mounts the host directory and starts the
   backend pointed at the mounted path. A custom command can be supplied after a second `--`.

   ```bash
   ./scripts/devcontainer-with-markdown.sh -- ~/logs
   ```

   ```bash
   ./scripts/devcontainer-with-markdown.sh -- ~/logs -- npm run backend:dev -- --path /workspace/markdown/external
   ```

   The script always exports `MARKDOWN_DIR=/workspace/markdown/external` inside the container so other
   tooling can reuse the mounted location.

### Option 2: Create a local override for VS Code

VS Code automatically merges `.devcontainer/devcontainer.local.json` into the main configuration if the
file exists. Copy the provided example, update the `source` path to the folder you want to share, and
reload the container.

```bash
cp .devcontainer/devcontainer.local.example.json .devcontainer/devcontainer.local.json
```

```jsonc
{
  // Replace the path below with the directory that contains your markdown logs.
  "mounts": [
    "source=/absolute/path/to/logs,target=/workspace/markdown/external,type=bind,consistency=cached"
  ],
  "remoteEnv": {
    "MARKDOWN_DIR": "/workspace/markdown/external"
  }
}
```

Restart the container (or run “Dev Containers: Rebuild Container” from the VS Code command palette)
after saving the override.
