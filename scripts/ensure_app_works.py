#!/usr/bin/env python3
"""Run a set of quick health checks to confirm the LiveView app still works."""

from __future__ import annotations

import argparse
import subprocess
import sys
from pathlib import Path

# Resolve the repository root so the commands always run from a predictable place.
ROOT = Path(__file__).resolve().parents[1]


def run_step(command: list[str], description: str) -> None:
    """Execute a shell command and stream its output."""

    print(f"\n==> {description}")
    # Using `sys.executable` keeps us inside the same Python environment when needed.
    result = subprocess.run(command, cwd=ROOT)
    if result.returncode != 0:
        raise SystemExit(result.returncode)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description=(
            "Run syntax checks and the pytest suite so we can be confident the "
            "application still behaves correctly."
        )
    )
    parser.add_argument(
        "--skip-tests",
        action="store_true",
        help="Skip running pytest (useful when you only want the lightweight checks).",
    )
    args = parser.parse_args(argv)

    # First make sure all Python modules still compile after recent edits.
    run_step([sys.executable, "-m", "compileall", "server.py", "components", "tests"], "Checking for syntax errors")

    if not args.skip_tests:
        # Pytest exercises the HTTP endpoints and verifies the web UI JSON payloads.
        run_step([sys.executable, "-m", "pytest"], "Running pytest suite")

    print("\n✅ All health checks passed!")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
