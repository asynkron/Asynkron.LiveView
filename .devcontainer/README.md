# Dev Container

This configuration makes it easy to develop the Asynkron LiveView project inside a GitHub Codespaces or VS Code Dev Containers workspace.

- **Image**: Based on the official JavaScript/Node.js dev container image so the runtime matches the project's requirements.
- **Features**: Ensures Node.js 20 is present and installs the GitHub CLI for repository workflows.
- **Post-create command**: Runs `npm install --omit=optional` so workspaces are bootstrapped quickly without compiling optional native modules. If you need terminal emulation via `node-pty`, run `npm install` manually after the container is ready.
- **Forwarded port**: Exposes port 8080 which is used by the backend server.
- **VS Code customizations**: Adds ESLint and Prettier extensions and enables format-on-save for a consistent developer experience.
