#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VENV="$ROOT/.venv"
PYTHON="$VENV/bin/python"

if [[ ! -d "$VENV" ]]; then
  echo "[setup] creating virtual environment at $VENV"
  python3 -m venv "$VENV"
fi

if [[ ! -x "$PYTHON" ]]; then
  echo "Virtual environment seems broken; remove $VENV and rerun" >&2
  exit 1
fi

"$PYTHON" -m pip install --upgrade pip >/dev/null
"$PYTHON" -m pip install -r "$ROOT/requirements.txt"

if [[ $# -eq 0 ]]; then
  echo "Usage: $0 -- <child command>" >&2
  echo "Example: $0 -- python example_ai_agent.py" >&2
  exit 1
fi

exec "$PYTHON" "$ROOT/clihost.py" "$@"
