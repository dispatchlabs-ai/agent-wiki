#!/usr/bin/env python3
"""Probe the running Wiki through its unauthenticated loopback liveness route."""
import os
import sys
import urllib.error
import urllib.request


def main() -> int:
    try:
        port = int(os.environ.get("PORT", "4317"))
        if not 1 <= port <= 65535:
            return 1
        # Ignore proxy environment variables for this task-local probe.
        opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
        with opener.open(f"http://127.0.0.1:{port}/healthz", timeout=4) as response:
            return 0 if response.status == 200 else 1
    except (ValueError, OSError, urllib.error.URLError):
        return 1


if __name__ == "__main__":
    sys.exit(main())
