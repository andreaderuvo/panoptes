"""Asking every machine what is happening, without any one of them holding up the rest."""

from __future__ import annotations

import asyncio
import time
from dataclasses import dataclass, field
from typing import Any

import httpx

from .config import Config, Machine


@dataclass
class Seen:
    """The last thing a machine said, and when. Kept even after it stops answering: a
    board that blanks a machine the moment it goes quiet loses the one fact you want,
    which is what it was doing when it went."""

    name: str
    url: str
    at: float = 0.0
    ok: bool = False
    why: str = ""
    overview: dict[str, Any] = field(default_factory=dict)

    def as_dict(self) -> dict:
        # The overview goes in first and the board's own facts overwrite it. A machine
        # reports its hostname as `name`, and that is not what you called it: you named it
        # `lab-gpu` for a reason, and two boxes can perfectly well answer to the same
        # hostname. What it calls itself is kept, one key over.
        return {
            **self.overview,
            "name": self.name,
            # A machine that announces itself has already said both: the name you gave it
            # and the hostname it answers to. One that is polled has only said the hostname,
            # in `name`, which this is about to overwrite.
            "hostname": self.overview.get("hostname") or self.overview.get("name"),
            "url": self.url,
            "ok": self.ok,
            "why": self.why,
            "at": self.at,
            "ago": round(time.time() - self.at, 1) if self.at else None,
        }


async def ask(client: httpx.AsyncClient, machine: Machine, timeout: float) -> Seen:
    """One machine. Never raises: a board is a thing you look at when something is wrong,
    so the failure has to arrive as information rather than as an exception."""
    seen = Seen(name=machine.name, url=machine.link)
    try:
        answer = await client.get(
            machine.overview,
            headers={"Authorization": f"Bearer {machine.token}"},
            timeout=timeout,
        )
    except httpx.TimeoutException:
        seen.why = f"no answer within {timeout:g}s"
        return seen
    except httpx.ConnectError:
        seen.why = "nothing listening there"
        return seen
    except httpx.HTTPError as e:
        # Whatever else httpx has to say, said in words rather than in a class name.
        seen.why = f"unreachable ({type(e).__name__.replace('Error', '').lower()})"
        return seen

    seen.at = time.time()
    if answer.status_code == 401:
        seen.why = "the token was refused"
        return seen
    if answer.status_code == 403:
        # Almost always the same mistake: a watcher token was expected and something
        # weaker or older was given, or the machine has not been told about this board.
        seen.why = "that token may not ask this"
        return seen
    if answer.status_code != 200:
        seen.why = f"answered {answer.status_code}"
        return seen
    try:
        body = answer.json()
    except ValueError:
        seen.why = "answered something that was not an overview"
        return seen
    if not isinstance(body, dict) or "sessions" not in body:
        seen.why = "answered something that was not an overview"
        return seen

    seen.ok = True
    seen.overview = body
    return seen


async def round_of(cfg: Config, previous: dict[str, Seen] | None = None) -> dict[str, Seen]:
    """Every machine at once. The slowest one sets the pace, not the sum of them."""
    if not cfg.machines:
        return {}
    async with httpx.AsyncClient(follow_redirects=False) as client:
        answers = await asyncio.gather(
            *(ask(client, m, cfg.timeout) for m in cfg.machines),
            return_exceptions=True,
        )

    out: dict[str, Seen] = {}
    for machine, answer in zip(cfg.machines, answers):
        if isinstance(answer, Seen):
            fresh = answer
        else:
            fresh = Seen(name=machine.name, url=machine.link, why="asking it went wrong here")
        # A machine that has gone quiet keeps whatever it last told us, so the board can
        # still say what it was running an hour ago.
        was = (previous or {}).get(machine.name)
        if not fresh.ok and was and was.overview:
            fresh.overview = was.overview
            fresh.at = was.at
        out[machine.name] = fresh
    return out
