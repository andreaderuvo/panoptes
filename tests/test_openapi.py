"""The published API description must match the routes it claims to describe.

A spec that has gone stale is worse than none: it tells a stranger to call something that is
not there. This is the check that keeps it honest — and it is also the thing that noticed,
every time an endpoint was added today, that the description had not been regenerated.
"""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def test_the_published_spec_matches_the_code():
    done = subprocess.run(
        [sys.executable, "scripts/openapi.py", "--check"],
        cwd=ROOT, capture_output=True, text=True,
    )
    assert done.returncode == 0, done.stdout + done.stderr


def test_every_route_says_what_it_is_for():
    """A summary is what a reader sees in a list of endpoints. One without it is a line of
    punctuation."""
    spec = json.loads((ROOT / "docs" / "openapi.json").read_text(encoding="utf-8"))
    mute = [
        f"{method.upper()} {path}"
        for path, ways in spec["paths"].items()
        for method, one in ways.items()
        if not one.get("summary")
    ]
    assert not mute, mute


def test_no_token_is_anywhere_in_it(tmp_path):
    """It is generated from a throwaway config, and the day that stops being true is the day
    a real token is published to a website."""
    text = (ROOT / "docs" / "openapi.json").read_text(encoding="utf-8")
    assert "xxxxxxxx" not in text and "yyyyyyyy" not in text
