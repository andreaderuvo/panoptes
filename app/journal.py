"""What was done on this board, and what was refused.

Argus has one of these for what happens *on a machine*. This one exists for three things that
happen only here, and that nothing else would ever see:

**Who pressed stop.** The board sends the instruction; the machine records that "panoptes" did
it. That is the truth from where the machine is standing and it is not enough — the board is
the only thing that knows which browser the click came from, and on the day there are two
people watching one board, "panoptes" names neither of them.

**Who tried to get in here.** This page lists every machine you own, what is running on each
and how full its disks are. That is reconnaissance served on a plate, and a run of 401s against
it deserves to be seen exactly as much as one against a machine.

**Who invented a machine.** The registration token is the weakest key in the arrangement, and
anything holding it can announce a machine that does not exist. It cannot overwrite one you
configured — that is refused — but it can fill a board with noise, and until now nothing said
so except the board looking wrong.

Smaller than Argus's because the board has three actions rather than twenty, and because there
is one reader: Argus keeps its journal for the master token alone, since a device token could
be in a stolen phone. Here, whoever can read the board can read this.
"""

from __future__ import annotations

import json
import os
import time
from pathlib import Path

KEEP = 3000
TRIM_AT = 4500
NOTE_LIMIT = 200
# A scanner can produce thousands of refusals a minute. Collapsed per address, with the count
# kept, because a board that rotates away its own history while being knocked on is worse than
# no record at all.
QUIET_FOR = 10.0
_last_refusal: dict[tuple, list] = {}


def default_store(config_path: Path) -> Path:
    return config_path.parent / "journal.jsonl"


def who_from(scope: dict) -> str:
    if scope.get("panoptes_board"):
        return "the board token"
    if scope.get("panoptes_machine"):
        return "a machine announcing itself"
    return "unknown"


def where_from(scope: dict) -> tuple[str, str]:
    """The peer, and what a proxy in front claims — kept apart, because the second is a header
    and a header is whatever the sender wrote."""
    client = scope.get("client") or ()
    peer = client[0] if client else "?"
    said = ""
    for key, value in scope.get("headers") or []:
        if key.lower() == b"x-forwarded-for":
            said = value.decode("latin-1").split(",")[0].strip()[:64]
            break
    return peer, said


def refused(status: int) -> bool:
    return status in (401, 403, 409)


def note(scope: dict, what: str) -> None:
    scope["panoptes_note"] = str(what)[:NOTE_LIMIT]


def write(store: Path, entry: dict) -> None:
    """Never raises: a read-only config directory costs the record, not the action."""
    try:
        store.parent.mkdir(parents=True, exist_ok=True)
        fresh = not store.exists()
        with store.open("a", encoding="utf-8") as f:
            f.write(json.dumps(entry, separators=(",", ":")) + "\n")
        if fresh:
            store.chmod(0o600)
        trim(store)
    except OSError:
        pass


def record(store: Path, scope: dict, status: int, took_ms: int) -> None:
    peer, claimed = where_from(scope)
    entry = {
        "at": round(time.time(), 1),
        "who": who_from(scope),
        "did": f'{scope.get("method", "?")} {scope.get("path", "?")}',
        "status": status,
        "ms": took_ms,
        "from": peer,
    }
    if claimed and claimed != peer:
        entry["via"] = claimed
    if scope.get("panoptes_note"):
        entry["what"] = scope["panoptes_note"]

    now = time.time()
    flush_swallowed(store, now)

    if refused(status):
        key = (peer, status, scope.get("path", ""))
        seen = _last_refusal.get(key)
        if seen and now - seen[0] < QUIET_FOR:
            seen[1] += 1
            return
        entry["refused"] = True
        # One field, one meaning: how many attempts this line stands for.
        entry["times"] = 1 + (seen[1] if seen else 0)
        entry["who"] = "someone"
        _last_refusal[key] = [now, 0]

    write(store, entry)


def flush_swallowed(store: Path, now: float | None = None) -> int:
    """Write out collapsed refusals once their burst has ended, so a burst that stops is still
    counted. Riding only on the next attempt from the same address loses the tail."""
    when = time.time() if now is None else now
    wrote = 0
    for key, seen in list(_last_refusal.items()):
        at, swallowed = seen
        if when - at < QUIET_FOR:
            continue
        if swallowed:
            peer, status, path = key
            write(store, {
                "at": round(at, 1), "who": "someone", "did": path, "status": status, "ms": 0,
                "from": peer, "refused": True, "times": swallowed, "summary": True,
            })
            wrote += 1
        del _last_refusal[key]
    return wrote


def trim(store: Path) -> None:
    try:
        with store.open(encoding="utf-8") as f:
            lines = f.readlines()
        if len(lines) <= TRIM_AT:
            return
        beside = store.with_suffix(".part")
        beside.write_text("".join(lines[-KEEP:]), encoding="utf-8")
        beside.chmod(0o600)
        os.replace(beside, store)
    except (OSError, ValueError):
        pass


def read(store: Path, limit: int = 200) -> list[dict]:
    """Most recent first, which is the order anybody reads this in."""
    try:
        with store.open(encoding="utf-8") as f:
            lines = f.readlines()
    except OSError:
        return []
    out = []
    for line in reversed(lines[-limit * 2:]):
        try:
            one = json.loads(line)
        except ValueError:
            continue
        if isinstance(one, dict):
            out.append(one)
        if len(out) >= limit:
            break
    return out
