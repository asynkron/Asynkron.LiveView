#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VENV="$ROOT/.venv"
PYTHON="$VENV/bin/python"
REQ_FILE="$ROOT/requirements.txt"
HASH_FILE="$VENV/.requirements.sha256"

if [[ ! -d "$VENV" ]]; then
  echo "[setup] creating virtual environment at $VENV"
  python3 -m venv "$VENV"
fi

if [[ ! -x "$PYTHON" ]]; then
  echo "Virtual environment seems broken; remove $VENV and rerun" >&2
  exit 1
fi

current_hash="$(shasum -a 256 "$REQ_FILE" | awk '{print $1}')"
stored_hash=""
if [[ -f "$HASH_FILE" ]]; then
  stored_hash="$(cat "$HASH_FILE")"
fi

if [[ "$current_hash" != "$stored_hash" ]]; then
  echo "[setup] syncing Python dependencies"
  "$PYTHON" -m pip install --upgrade pip >/dev/null
  "$PYTHON" -m pip install -r "$REQ_FILE"
  printf "%s" "$current_hash" > "$HASH_FILE"
fi

if [[ $# -eq 0 ]]; then
  echo "Usage: $0 -- <child command>" >&2
  echo "Example: $0 -- python example_ai_agent.py" >&2
  exit 1
fi

exec "$PYTHON" "$ROOT/clihost.py" "$@"
