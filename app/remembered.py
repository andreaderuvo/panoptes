"""The machines that announced themselves, kept across a restart.

They used to live only in memory, and the reasoning was defensible: a board that restarts
should forget what it was told rather than show a list of machines that may have moved on.

Then somebody stopped a machine from the board and the tile did not go red — it **vanished**,
because the board had been restarted in between. For the one question this whole product
exists to answer, that is the worst possible answer: a machine that is gone and a machine that
never existed look identical, and you cannot tell which you are looking at by looking harder.

So they are written down. What that buys is that a stopped machine stays on the board, red,
saying when it last called in — and what it costs is that a machine you decommissioned would
sit there red for ever. Hence `forget`: removing one is an explicit act, which is the right
shape for it, because the board cannot know the difference between "off for ten minutes" and
"gone for good" and should not guess.

Only what a machine said about itself is kept. No token ever reaches this file: the board does
not hold one for an announcing machine — it holds the registration key, which is shared and
lives in the config.
"""

from __future__ import annotations

import json
import os
import time
from pathlib import Path

# A board with more machines than this is not a board any more, and the cap stops a leaked
# registration key from filling a disk with invented ones.
MAX_KEPT = 200


def default_store(config_path: Path) -> Path:
    return config_path.parent / "announced.json"


def load(store: Path | None) -> dict:
    """What was on disk, as `{name: Seen-shaped dict}`. Never raises: a board that will not
    start because this file is corrupt is worse than a board that has forgotten."""
    if store is None:
        return {}
    try:
        raw = json.loads(store.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}
    if not isinstance(raw, dict):
        return {}
    kept = {}
    for name, one in list(raw.items())[:MAX_KEPT]:
        if not isinstance(one, dict) or not isinstance(one.get("overview"), dict):
            continue
        kept[str(name)] = {
            "name": str(name),
            "url": str(one.get("url") or ""),
            "at": float(one.get("at") or 0),
            "overview": one["overview"],
        }
    return kept


def save(store: Path | None, told: dict) -> None:
    """Write the lot. Never raises, for the same reason as above."""
    if store is None:
        return
    try:
        store.parent.mkdir(parents=True, exist_ok=True)
        beside = store.with_suffix(".part")
        beside.write_text(json.dumps({
            name: {"name": seen.name, "url": seen.url, "at": seen.at, "overview": seen.overview}
            for name, seen in list(told.items())[:MAX_KEPT]
        }, indent=1), encoding="utf-8")
        beside.chmod(0o600)
        os.replace(beside, store)
    except OSError:
        pass


def restore(store: Path | None, seen_class) -> dict:
    """Back into `Seen` objects, with `ok` false whatever it was when we wrote it.

    A machine is believed because it called in recently, and "recently" does not survive the
    board being down for a week. It comes back as last-heard-from, and the first announcement
    after that puts it right — which takes one interval.
    """
    out = {}
    for name, one in load(store).items():
        out[name] = seen_class(
            name=name, url=one["url"], at=one["at"], ok=False,
            why="has not called in", reason="silent", overview=one["overview"],
        )
    return out


def stale(told: dict, older_than: float) -> list[str]:
    """Names nobody has heard from in a very long time.

    Not for the board — a machine that is off should stay visible and red, which is the point
    of all this. This is the far end of that: something that has said nothing for weeks is not
    news any more, and keeping it is how a board slowly fills with history.
    """
    cutoff = time.time() - older_than
    return [name for name, seen in told.items() if seen.at and seen.at < cutoff]
