#!/usr/bin/env python3
"""A board full of machines that do not exist.

Every picture in the README comes from here rather than from somebody's real fleet. That is
not only about privacy — though it is about that too: a screenshot of a real board publishes
hostnames, ports, session names and how full a disk is. It is also the only way the pictures
stay honest. A demo board shows the same six machines in the same states every time, so a
picture can be retaken after a change and the difference in it is the change.

Nothing here talks to tmux, and no Argus is started. The board's own announcement endpoint is
what fills it: each machine below is POSTed exactly as a real one would announce itself.

    python3 scripts/demo.py                 # start a board on 127.0.0.1:8770 and fill it
    python3 scripts/demo.py --port 9000
    python3 scripts/demo.py --once          # fill a board that is already running

The token is printed. It is a throwaway on loopback, so it is not secret and does not need
to be.
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent.parent
BOARD_TOKEN = "demo-board-token-not-a-secret-0001"
REGISTER = "demo-register-token-not-a-secret-01"

DAY = 86400
HOUR = 3600

# Six machines with the spread a real fleet has: one asking for you, one that finished
# something, one nearly out of disk, one that has gone quiet, and two simply working. The
# names are invented and deliberately unlike anyone's naming scheme.
FLEET = [
    {
        "name": "vaporwave",
        "reach": "http://vaporwave.example:8090",
        "hostname": "vaporwave",
        "uptime": 41 * DAY + 5 * HOUR,
        "serving": 6 * HOUR,
        "cores": 16,
        "load": [3.2, 2.8, 2.4],
        "load_pct": 20.0,
        "memory_pct": 44.0,
        "swap_pct": 0.0,
        "disk": {"path": "/srv/work", "pct": 61.0, "level": "ok"},
        "sessions": [
            {"name": "claude", "bell": "asking", "windows": 3, "attached": False},
            {"name": "notebook", "bell": None, "windows": 1, "attached": False},
            {"name": "shell", "bell": None, "windows": 2, "attached": True},
        ],
    },
    {
        "name": "tinderbox",
        "reach": "http://tinderbox.example:8090",
        "hostname": "tinderbox",
        "uptime": 12 * DAY + 19 * HOUR,
        "serving": 12 * DAY + 18 * HOUR,
        "cores": 8,
        "load": [0.4, 0.6, 0.7],
        "load_pct": 5.0,
        "memory_pct": 22.0,
        "swap_pct": 0.0,
        "disk": {"path": "/data", "pct": 38.0, "level": "ok"},
        # An orchestration halfway through, because a board that only ever shows sessions
        # cannot show what it looks like when one machine is running four agents on one job.
        "runs": [
            {"id": "d1", "name": "referee", "state": "running",
             "done": 2, "agents": 5, "asking": 0, "lost": 0},
        ],
        "sessions": [
            {"name": "codex", "bell": "done", "windows": 1, "attached": False},
            {"name": "build", "bell": None, "windows": 4, "attached": False},
        ],
    },
    {
        "name": "old-faithful",
        "reach": "http://old-faithful.example:8090",
        "hostname": "old-faithful",
        "uptime": 213 * DAY + 2 * HOUR,
        "serving": 3 * DAY,
        "cores": 4,
        "load": [1.1, 1.0, 0.9],
        "load_pct": 28.0,
        "memory_pct": 71.0,
        "swap_pct": 4.0,
        "disk": {"path": "/var/lib/archive", "pct": 96.0, "level": "critical"},
        "sessions": [
            {"name": "rsync", "bell": None, "windows": 1, "attached": False},
        ],
    },
    {
        "name": "brick",
        "reach": "http://brick.example:8090",
        "hostname": "brick",
        "uptime": 88 * DAY,
        "serving": 88 * DAY,
        "cores": 32,
        "load": [11.4, 10.9, 9.8],
        "load_pct": 36.0,
        "memory_pct": 83.0,
        "swap_pct": 12.0,
        "disk": {"path": "/scratch", "pct": 74.0, "level": "high"},
        "sessions": [
            {"name": "train", "bell": None, "windows": 2, "attached": True},
            {"name": "tensorboard", "bell": None, "windows": 1, "attached": False},
            {"name": "claude", "bell": None, "windows": 5, "attached": False},
            {"name": "shell", "bell": None, "windows": 1, "attached": False},
        ],
    },
    {
        "name": "lighthouse",
        # A second Argus on the same box as `tinderbox`, which is a thing people do and the
        # only way the footer's "6 argus on 5 machines" appears in a picture at all.
        "reach": "http://tinderbox.example:8091",
        "hostname": "tinderbox",
        "uptime": 4 * HOUR,
        "serving": 4 * HOUR,
        "cores": 2,
        "load": [0.1, 0.1, 0.0],
        "load_pct": 5.0,
        "memory_pct": 17.0,
        "swap_pct": 0.0,
        "disk": {"path": "/", "pct": 29.0, "level": "ok"},
        "sessions": [],
    },
]

# One that stopped calling in a while ago. It is announced with a stale timestamp, so the
# board shows it as gone rather than as missing — which is the state that matters.
QUIET = {
    "name": "shed",
    "reach": "http://shed.example:8090",
    "hostname": "shed",
    "uptime": 9 * DAY,
    "serving": 9 * DAY,
    "cores": 4,
    "load": [0.0, 0.0, 0.0],
    "load_pct": 0.0,
    "memory_pct": 9.0,
    "swap_pct": 0.0,
    "sessions": [{"name": "shell", "bell": None, "windows": 1, "attached": False}],
}


def announce(port: int, body: dict) -> None:
    request = urllib.request.Request(
        f"http://127.0.0.1:{port}/api/report",
        data=json.dumps(body).encode(),
        headers={"content-type": "application/json", "authorization": f"Bearer {REGISTER}"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=5) as answer:
            answer.read()
    except urllib.error.HTTPError as e:
        print(f"  {body['name']}: refused — {e.code} {e.read().decode()[:120]}", file=sys.stderr)


def fill(port: int) -> None:
    for machine in FLEET:
        announce(port, machine)
    announce(port, QUIET)
    print(f"  {len(FLEET) + 1} machines announced")


def write_config(path: Path, port: int) -> None:
    """A directory of its own, and this is not fussiness.

    A board remembers what announced itself in `announced.json`, *beside its config file* — so
    two boards whose configs sit in the same directory share the machines they have been told
    about. Put this one's config straight in `/tmp` and the demo board comes up holding
    whatever real machine reported to the board you already run there, under its real name,
    with its real sessions and its real disks. That is how a hostname gets into a picture on
    a public README: measured, once, in a clip that had to be thrown away.
    """
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        f"listen: 127.0.0.1:{port}\n"
        f"token: {BOARD_TOKEN}\n"
        f"registration_token: {REGISTER}\n"
        "every: 5\n"
        # Long enough that `shed` stays visible-but-gone for as long as a screenshot takes,
        # rather than flipping back to ok on the next announcement.
        "forget_after: 20\n"
        "machines: []\n",
        encoding="utf-8",
    )
    path.chmod(0o600)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    # 8099 and its neighbours are common enough to be taken; this one rarely is.
    ap.add_argument("--port", type=int, default=8770)
    ap.add_argument("--once", action="store_true", help="only announce, into a board already running")
    ap.add_argument("--config", type=Path, default=Path("/tmp/panoptes-demo/panoptes.yaml"))
    args = ap.parse_args()

    if args.once:
        fill(args.port)
        return 0

    write_config(args.config, args.port)
    board = subprocess.Popen(
        [sys.executable, "-m", "app.main", "--config", str(args.config)],
        cwd=HERE, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
    )
    try:
        for _ in range(40):
            time.sleep(0.25)
            try:
                urllib.request.urlopen(f"http://127.0.0.1:{args.port}/api/health?token={BOARD_TOKEN}", timeout=1).read()
                break
            except Exception:
                continue
        else:
            print("the board did not come up", file=sys.stderr)
            return 1

        fill(args.port)
        print(f"\n  http://127.0.0.1:{args.port}/?token={BOARD_TOKEN}\n")
        print("  Ctrl-C to stop. `shed` goes quiet after 20s, which is the point of it.")

        # Keep the five live ones alive so only `shed` ever goes stale.
        while True:
            time.sleep(8)
            for machine in FLEET:
                announce(args.port, machine)
    except KeyboardInterrupt:
        return 0
    finally:
        board.terminate()
        board.wait(timeout=5)


if __name__ == "__main__":
    raise SystemExit(main())
