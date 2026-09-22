#!/usr/bin/env python3
"""Inject one owner.json replace failure, then repeat the same adoption."""

import importlib.util
import json
from pathlib import Path
import sys


lifecycle_path, root = sys.argv[1:]
spec = importlib.util.spec_from_file_location("agent_wiki_lifecycle", lifecycle_path)
lifecycle = importlib.util.module_from_spec(spec)
assert spec.loader
sys.dont_write_bytecode = True
spec.loader.exec_module(lifecycle)

original_replace = lifecycle.os.replace
failed = False


def replace_once(source, destination):
    global failed
    if not failed and Path(destination).name == "owner.json":
        failed = True
        raise OSError("synthetic interrupted owner metadata replacement")
    return original_replace(source, destination)


arguments = [
    "lifecycle.py",
    "adopt",
    "--root",
    root,
    "--origin",
    "https://wiki.example.test",
]
lifecycle.os.replace = replace_once
sys.argv = arguments
first = lifecycle.main()
lifecycle.os.replace = original_replace
leftovers = sorted(
    entry.name
    for entry in (Path(root) / ".lifecycle").iterdir()
    if entry.name.startswith(".owner.json.")
)
sys.argv = arguments
second = lifecycle.main()
remaining = sorted(
    entry.name
    for entry in (Path(root) / ".lifecycle").iterdir()
    if entry.name.startswith(".owner.json.")
)
print(
    json.dumps(
        {
            "first": first,
            "leftovers": leftovers,
            "second": second,
            "remaining": remaining,
        }
    )
)
