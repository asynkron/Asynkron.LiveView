#!/usr/bin/env bash
# run.sh - Start the Markdown Live View server.

set -euo pipefail

PORT="${PORT:-8080}"
MARKDOWN_DIR="${MARKDOWN_DIR:-markdown}"

choose_python() {
  # Check if virtual environment exists and use it
  if [[ -f "venv/bin/python" ]]; then
    printf '%s' "venv/bin/python"
  elif command -v python3 >/dev/null 2>&1; then
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
  if ! "$PYTHON_CMD" -c "import aiohttp, watchdog" >/dev/null 2>&1; then
    echo "Installing required Python packages..."
    if [[ "$PYTHON_CMD" == "venv/bin/python" ]]; then
      # Use virtual environment pip
      venv/bin/pip install -r requirements.txt
    elif ! "$PYTHON_CMD" -m pip install --user -r requirements.txt; then
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
  echo "🚀 Starting Markdown Live View server"
  echo "   Port:         $PORT"
  echo "   Markdown dir: $MARKDOWN_DIR"
  echo

  ensure_deps
  prepare_markdown_dir

  cmd=("$PYTHON_CMD" "server.py" "--port" "$PORT" "--dir" "$MARKDOWN_DIR")
  exec "${cmd[@]}"
}

main "$@"
