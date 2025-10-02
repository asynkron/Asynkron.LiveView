"""Minimal CLI agent that simply echoes incoming chat lines.

Run it through `clihost.py` to see the end-to-end flow:

    python clihost.py --url ws://localhost:8080/agent-feed -- python example_ai_agent.py

Type in the terminal as usual; when the Live View UI sends chat messages they
will also appear here.
"""

import sys


def main() -> int:
    print("🤖 Example agent ready. Type messages or wait for server injections.")
    try:
        for line in sys.stdin:
            text = line.rstrip("\n")
            if not text:
                continue
            print(f"🤖 received: {text}")
            sys.stdout.flush()
    except KeyboardInterrupt:
        return 0
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
