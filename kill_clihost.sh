#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TARGET="$ROOT/clihost.py"

mapfile -t PIDS < <(pgrep -f "$TARGET" || true)

if [[ ${#PIDS[@]} -eq 0 ]]; then
  echo "[kill] no clihost.py processes found"
  exit 0
fi

terminate_pid() {
  local pid="$1"
  local name
  name="$(ps -o command= -p "$pid" 2>/dev/null | head -n 1 || true)"
  if [[ -z "$name" ]]; then
    return
  fi

  echo "[kill] sending SIGTERM to PID $pid :: $name"
  kill -TERM "$pid" 2>/dev/null || true

  for attempt in {1..5}; do
    if ! kill -0 "$pid" 2>/dev/null; then
      echo "[kill] PID $pid exited after SIGTERM"
      return
    fi
    sleep 1
  done

  echo "[kill] escalating to SIGKILL for PID $pid"
  kill -KILL "$pid" 2>/dev/null || true
}

for pid in "${PIDS[@]}"; do
  echo "[kill] processing clihost PID $pid"

  mapfile -t CHILDREN < <(pgrep -P "$pid" || true)
  if [[ ${#CHILDREN[@]} -gt 0 ]]; then
    for child in "${CHILDREN[@]}"; do
      echo "[kill] ├─ child PID $child"
      terminate_pid "$child"
    done
  fi

  terminate_pid "$pid"
  echo "[kill] finished PID $pid"
  echo
done

echo "[kill] cleanup complete"
