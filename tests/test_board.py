"""The board itself: what it serves, what it guards, and what it refuses to hand over."""

from __future__ import annotations

from fastapi.testclient import TestClient

from app.config import Config, Machine
from app.main import create_app
from app.watch import Seen

BOARD = "board-0123456789abcdef0123456789"
WEAK = "watch-0123456789abcdef0123456789"


def boarded(seen=None):
    cfg = Config(token=BOARD, machines=[Machine(name="hetzner", url="http://hetzner:8090", token=WEAK)])
    app = create_app(cfg)
    client = TestClient(app)
    if seen is not None:
        app.state.seen = seen
    return client, app


def test_the_board_never_hands_a_machine_token_to_the_browser():
    """The whole arrangement rests on this. The page is told where a machine is, never
    how to get into it."""
    client, app = boarded({
        "hetzner": Seen(name="hetzner", url="http://hetzner:8090", ok=True, at=1.0,
                        overview={"sessions": [], "uptime": 10.0}),
    })
    answer = client.get("/api/board", headers={"Authorization": f"Bearer {BOARD}"})
    assert answer.status_code == 200
    assert WEAK not in answer.text
    assert "token" not in answer.text


def test_the_board_needs_its_own_token():
    client, _ = boarded()
    assert client.get("/api/board").status_code == 401
    assert client.get("/api/board?token=nonsense").status_code == 401
    assert client.get(f"/api/board?token={BOARD}").status_code == 200


def test_machines_wanting_you_come_first():
    """A board is read from the top, so the top has to be the reason to look at it."""
    quiet = Seen(name="quiet", url="http://quiet:8090", ok=True, at=1.0,
                 overview={"sessions": [{"name": "a", "bell": None}]})
    asking = Seen(name="asking", url="http://asking:8090", ok=True, at=1.0,
                  overview={"sessions": [{"name": "b", "bell": "asking"}]})
    cfg = Config(token=BOARD, machines=[
        Machine(name="quiet", url="http://quiet:8090", token=WEAK + "1"),
        Machine(name="asking", url="http://asking:8090", token=WEAK + "2"),
    ])
    app = create_app(cfg)
    app.state.seen = {"quiet": quiet, "asking": asking}
    client = TestClient(app)
    names = [m["name"] for m in client.get(f"/api/board?token={BOARD}").json()["machines"]]
    assert names[0] == "asking"


def test_a_machine_not_yet_asked_still_appears():
    """Between starting up and the first sweep there is a moment, and an empty board in
    that moment looks like a broken one."""
    client, _ = boarded({})
    machines = client.get(f"/api/board?token={BOARD}").json()["machines"]
    assert machines[0]["name"] == "hetzner"
    assert machines[0]["ok"] is False


def test_the_page_is_served_without_a_token():
    """The page itself carries no secrets; it is useless until it is given one."""
    client, _ = boarded()
    assert client.get("/").status_code == 200
