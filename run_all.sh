#!/usr/bin/env bash
# run_all.sh - Start the unified LiveView + MCP server.

set -euo pipefail

PORT="${PORT:-8080}"
MARKDOWN_DIR="${MARKDOWN_DIR:-markdown}"
ENABLE_STDIO="${ENABLE_STDIO:-false}"

choose_python() {
  if command -v python3 >/dev/null 2>&1; then
    printf '%s' "python3"
  elif command -v python >/dev/null 2>&1; then
    printf '%s' "python"
  else
    echo "Python 3.7+ is required." >&2
    exit 1
  fi
}

PYTHON_CMD="${PYTHON_CMD:-$(choose_python)}"

ensure_deps() {
  if ! "$PYTHON_CMD" -c "import aiohttp, watchdog, mcp" >/dev/null 2>&1; then
    echo "Installing required Python packages (non-destructive)..."
    if ! "$PYTHON_CMD" -m pip install --user -r requirements.txt; then
      "$PYTHON_CMD" -m pip install --break-system-packages -r requirements.txt
    fi
  fi
}

prepare_markdown_dir() {
  if [[ ! -d "$MARKDOWN_DIR" ]]; then
    mkdir -p "$MARKDOWN_DIR"
  fi
}

main() {
  echo "🚀 Starting unified LiveView + MCP server"
  echo "   Port:         $PORT"
  echo "   Markdown dir: $MARKDOWN_DIR"
  echo "   MCP stdio:    $ENABLE_STDIO"
  echo

  ensure_deps
  prepare_markdown_dir

  cmd=("$PYTHON_CMD" "unified_server.py" "--port" "$PORT" "--dir" "$MARKDOWN_DIR")
  if [[ "$ENABLE_STDIO" == "true" ]]; then
    cmd+=("--mcp-stdio")
  fi

  exec "${cmd[@]}"
}

main "$@"
