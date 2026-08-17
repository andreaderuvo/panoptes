"""What the board does when a machine answers, lies, or says nothing at all."""

from __future__ import annotations

import asyncio

import httpx
import pytest

from app.config import Config, ConfigError, Machine
from app.watch import Seen, ask, round_of


def one(**kw) -> Machine:
    return Machine(name=kw.get("name", "box"), url=kw.get("url", "http://box:8090"),
                   token=kw.get("token", "watch-0123456789abcdef"))


OVERVIEW = {
    "name": "box", "version": "0.1.0", "uptime": 3600.0, "cores": 8,
    "load": [0.4, 0.3, 0.2], "load_pct": 5.0, "memory_pct": 22.0, "swap_pct": 0.0,
    "disk": {"path": "/home", "pct": 41.0, "level": "ok"},
    "sessions": [{"name": "claude", "windows": 1, "attached": True, "bell": "asking"}],
}


async def answered(status: int, body, *, machine=None, timeout=1.0) -> Seen:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(status, json=body) if not isinstance(body, str) \
            else httpx.Response(status, text=body)

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        return await ask(client, machine or one(), timeout)


def test_a_machine_that_answers_is_reported_whole():
    seen = asyncio.run(answered(200, OVERVIEW))
    assert seen.ok
    assert seen.overview["sessions"][0]["bell"] == "asking"
    assert seen.as_dict()["name"] == "box"
    assert seen.as_dict()["ago"] is not None


def test_the_weak_token_being_refused_says_so():
    """The commonest mistake when adding a machine, and it deserves its own sentence
    rather than a bare number."""
    assert asyncio.run(answered(401, {})).why == "the token was refused"
    assert asyncio.run(answered(403, {})).why == "that token may not ask this"


def test_something_that_is_not_an_overview_is_not_believed():
    """A login page answering 200 is the classic way a board fills with nonsense."""
    seen = asyncio.run(answered(200, "<html>please log in</html>"))
    assert not seen.ok and "not an overview" in seen.why

    seen = asyncio.run(answered(200, {"hello": "there"}))
    assert not seen.ok and "not an overview" in seen.why


def test_a_machine_that_never_answers_does_not_take_the_board_with_it():
    async def go():
        def handler(request: httpx.Request) -> httpx.Response:
            raise httpx.TimeoutException("too slow", request=request)

        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            return await ask(client, one(), 0.5)

    seen = asyncio.run(go())
    assert not seen.ok and "no answer within" in seen.why


def test_a_machine_that_goes_quiet_keeps_what_it_last_said():
    """The fact you most want when a box drops off is what it was doing when it did."""
    was = Seen(name="box", url="http://box:8090", ok=True, at=1000.0, overview=OVERVIEW)
    cfg = Config(token="board-0123456789abcdef", machines=[one()], timeout=0.2)

    async def go():
        # No transport to reach, so every machine fails: exactly the case under test.
        return await round_of(cfg, {"box": was})

    now = asyncio.run(go())["box"]
    assert not now.ok
    assert now.overview["sessions"][0]["name"] == "claude"
    assert now.at == 1000.0


def test_a_board_with_no_machines_is_not_an_error():
    cfg = Config(token="board-0123456789abcdef")
    assert asyncio.run(round_of(cfg)) == {}


def test_a_board_refuses_a_configuration_that_gives_itself_away():
    same = "board-0123456789abcdef"
    with pytest.raises(ConfigError, match="same as this board"):
        Config(token=same, machines=[one(token=same)]).validate()

    with pytest.raises(ConfigError, match="two machines"):
        Config(token=same, machines=[one(), one()]).validate()

    with pytest.raises(ConfigError, match="http"):
        Config(token=same, machines=[one(url="box:8090")]).validate()

    with pytest.raises(ConfigError, match="hammer"):
        Config(token=same, every=0.1).validate()
