#!/usr/bin/env python3
"""Minimal CLI agent used for demonstrating ``clihost.py``."""

import sys


def main() -> None:
    print("🤖 Example CLI agent ready. Type locally or let the server inject chat!")
    print("   Tip: run `python clihost.py -- python example_ai_agent.py`.")

    for line in sys.stdin:
        message = line.strip()
        if not message:
            continue
        print(f"🤖 Echoing from agent: {message}")
        print("Enter more text or press Ctrl+D to exit.")


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\n👋 Agent shutting down.")
