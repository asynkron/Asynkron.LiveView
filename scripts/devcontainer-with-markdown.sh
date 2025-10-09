#!/usr/bin/env bash
# Launch the Asynkron.LiveView dev container with a host markdown directory mounted.
# The script expects the VS Code devcontainer CLI (`devcontainer`) to be installed locally.

set -euo pipefail

usage() {
  cat <<'USAGE'
Usage: scripts/devcontainer-with-markdown.sh -- /absolute/or/relative/path [-- command]

Examples
  scripts/devcontainer-with-markdown.sh -- ~/logs
  scripts/devcontainer-with-markdown.sh -- ./markdown -- npm run backend:dev -- --path /workspace/markdown/external

The first example starts the dev container and runs the default backend command.
The second example mounts ./markdown and runs a custom command inside the container.
USAGE
}

if [[ $# -lt 2 || "$1" != "--" ]]; then
  usage >&2
  exit 1
fi

shift
HOST_MARKDOWN_DIR="$1"
shift

if [[ ! -d "$HOST_MARKDOWN_DIR" ]]; then
  echo "error: '$HOST_MARKDOWN_DIR' is not a directory" >&2
  exit 1
fi

if ! command -v devcontainer >/dev/null 2>&1; then
  echo "error: the 'devcontainer' CLI is required. Install it via 'npm install -g @devcontainers/cli'." >&2
  exit 1
fi

# Resolve repo root relative to this script so the script works from any location.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

# Convert the host path to an absolute path so devcontainer receives a canonical path.
if command -v realpath >/dev/null 2>&1; then
  HOST_MARKDOWN_DIR="$(realpath "$HOST_MARKDOWN_DIR")"
else
  # POSIX-compliant fallback using Python when realpath is unavailable.
  HOST_MARKDOWN_DIR="$(python3 -c 'import os,sys; print(os.path.abspath(sys.argv[1]))' "$HOST_MARKDOWN_DIR")"
fi

CONTAINER_TARGET="/workspace/markdown/external"
CONTAINER_LABEL="asynkron.liveview.markdown"

# Ensure the container exists with the requested mount. The label lets us reuse the container.
devcontainer up \
  --workspace-folder "$REPO_ROOT" \
  --id-label "$CONTAINER_LABEL" \
  --mount "type=bind,source=${HOST_MARKDOWN_DIR},target=${CONTAINER_TARGET},consistency=cached"

# Decide which command to execute inside the container.
if [[ $# -gt 0 ]]; then
  if [[ "$1" == "--" ]]; then
    shift
  fi
  if [[ $# -eq 0 ]]; then
    COMMAND=("/bin/bash")
  else
    COMMAND=("$@")
  fi
else
  COMMAND=("npm" "run" "backend:dev" "--" "--path" "$CONTAINER_TARGET")
fi

# Run the chosen command with MARKDOWN_DIR pointing at the mounted path.
devcontainer exec \
  --workspace-folder "$REPO_ROOT" \
  --id-label "$CONTAINER_LABEL" \
  --env "MARKDOWN_DIR=${CONTAINER_TARGET}" \
  -- "${COMMAND[@]}"
