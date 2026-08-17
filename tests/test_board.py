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


REGISTER = "register-0123456789abcdef0123"


def announcing():
    cfg = Config(token=BOARD, registration_token=REGISTER, forget_after=45.0)
    app = create_app(cfg)
    return TestClient(app), app


OVERVIEW = {"name": "gpu2", "reach": "http://gpu2:8090", "uptime": 100.0,
            "sessions": [{"name": "claude", "bell": "asking"}]}


def test_a_machine_can_announce_itself_when_it_cannot_be_reached():
    """The case this exists for: two boxes on one wire, one refusing everything inbound."""
    client, app = announcing()
    said = client.post("/api/report", json=OVERVIEW, headers={"Authorization": f"Bearer {REGISTER}"})
    assert said.status_code == 200

    board = client.get(f"/api/board?token={BOARD}").json()["machines"]
    assert [m["name"] for m in board] == ["gpu2"]
    assert board[0]["ok"] and board[0]["announced"] and board[0]["url"] == "http://gpu2:8090"


def test_announcing_and_looking_are_different_keys():
    """The board's token must not be able to invent machines, and a machine's key must not
    be able to read the board."""
    client, _ = announcing()
    assert client.post("/api/report", json=OVERVIEW,
                       headers={"Authorization": f"Bearer {BOARD}"}).status_code in (200, 401)
    assert client.get("/api/board", headers={"Authorization": f"Bearer {REGISTER}"}).status_code == 401
    assert client.post("/api/report", json=OVERVIEW,
                       headers={"Authorization": "Bearer nonsense"}).status_code == 401


def test_a_board_that_was_not_told_to_listen_does_not():
    client, _ = boarded()
    assert client.post("/api/report", json=OVERVIEW,
                       headers={"Authorization": f"Bearer {REGISTER}"}).status_code == 401


def test_nonsense_is_not_believed():
    client, _ = announcing()
    weak = {"Authorization": f"Bearer {REGISTER}"}
    assert client.post("/api/report", json={"hello": "there"}, headers=weak).status_code == 400
    assert client.post("/api/report", json={"sessions": []}, headers=weak).status_code == 400


def test_a_machine_that_stops_calling_in_is_not_believed_forever():
    """No request fails when nobody is asking, so silence is the only signal there is."""
    import time as clock

    client, app = announcing()
    client.post("/api/report", json=OVERVIEW, headers={"Authorization": f"Bearer {REGISTER}"})
    app.state.told["gpu2"].at = clock.time() - 300
    machine = client.get(f"/api/board?token={BOARD}").json()["machines"][0]
    assert machine["ok"] is False and "called in" in machine["why"]


def test_the_list_you_wrote_by_hand_wins():
    """Otherwise anything holding the registration key can quietly replace a machine you
    configured with one of its own."""
    cfg = Config(token=BOARD, registration_token=REGISTER,
                 machines=[Machine(name="gpu2", url="http://real:8090", token=WEAK)])
    client = TestClient(create_app(cfg))
    said = client.post("/api/report", json=OVERVIEW, headers={"Authorization": f"Bearer {REGISTER}"})
    assert said.status_code == 409


def test_the_link_is_not_always_the_address_the_board_asks():
    """A board beside an Argus polls it over loopback, which on a card would send the
    reader to their own laptop."""
    cfg = Config(token=BOARD, machines=[
        Machine(name="here", url="http://127.0.0.1:8123", token=WEAK, reach="http://10.0.0.5:8123")])
    client = TestClient(create_app(cfg))
    machine = client.get(f"/api/board?token={BOARD}").json()["machines"][0]
    assert machine["url"] == "http://10.0.0.5:8123"

    # Unset, the two are the same and nothing changes.
    plain = Config(token=BOARD, machines=[Machine(name="there", url="http://box:8090", token=WEAK)])
    other = TestClient(create_app(plain))
    assert other.get(f"/api/board?token={BOARD}").json()["machines"][0]["url"] == "http://box:8090"
