#!/usr/bin/env python3
"""Minimal agent for testing clihost.

Reads stdin line-by-line, prints diagnostics, and exits when it receives "quit".
"""

import sys


def main() -> None:
    print("[simple-agent] booted", flush=True)
    for line in sys.stdin:
        text = line.rstrip("\n")
        print(f"[simple-agent] received: {text}", flush=True)
        if text.strip().lower() == "quit":
            print("[simple-agent] quitting", flush=True)
            break


if __name__ == "__main__":
    main()
