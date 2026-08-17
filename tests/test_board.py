"""The board itself: what it serves, what it guards, and what it refuses to hand over."""

from __future__ import annotations

from fastapi.testclient import TestClient

from app.config import Config, ConfigError, Machine
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


def test_a_colour_written_in_the_config_reaches_the_page():
    """The hash is readable but it is not always right: two machines can land on the same
    step, and then the board is prettier than it is useful. A colour set here is the same on
    every device that opens the board — a reader can still override it in their own browser,
    which the server has no business knowing about."""
    cfg = Config(token=BOARD, machines=[
        Machine(name="hetzner", url="http://hetzner:8090", token=WEAK, colour="5"),
        Machine(name="plain", url="http://plain:8090", token=WEAK + "1"),
    ])
    client = TestClient(create_app(cfg))
    board = {m["name"]: m for m in client.get(f"/api/board?token={BOARD}").json()["machines"]}
    assert board["hetzner"]["colour"] == "5"
    # Unset, the board says nothing and the page falls back to the name.
    assert "colour" not in board["plain"]


def test_a_colour_that_is_not_one_is_refused_at_startup():
    """A typo that silently paints nothing is a typo you hunt for."""
    import pytest

    for wrong in ("verde", "#12345", "rgb(1,2,3)"):
        cfg = Config(token=BOARD, machines=[
            Machine(name="a", url="http://a:8090", token=WEAK, colour=wrong)])
        with pytest.raises(ConfigError):
            cfg.validate()

    for right in ("0", "7", "#5fc9a3"):
        Config(token=BOARD, machines=[
            Machine(name="a", url="http://a:8090", token=WEAK, colour=right)]).validate()


def test_a_machine_keeps_the_hostname_it_answers_to():
    """Two questions that look like one. `name` is what you called it; `hostname` is what it
    calls itself, and several Argus instances on one box share the latter — which is the only
    way a board can say "4 argus on 2 machines" instead of claiming four boxes."""
    client, app = announcing()
    client.post("/api/report", headers={"Authorization": f"Bearer {REGISTER}"},
                json={**OVERVIEW, "name": "the-name-i-gave-it", "hostname": "realbox"})
    machine = client.get(f"/api/board?token={BOARD}").json()["machines"][0]
    assert machine["name"] == "the-name-i-gave-it"
    assert machine["hostname"] == "realbox"


def test_a_polled_machine_reports_its_hostname_in_the_only_field_it_has():
    """An older Argus, or any that is polled rather than announcing, says only `name`."""
    client, _ = boarded({
        "hetzner": Seen(name="hetzner", url="http://hetzner:8090", ok=True, at=1.0,
                        overview={"name": "realbox", "sessions": []}),
    })
    machine = client.get(f"/api/board?token={BOARD}").json()["machines"][0]
    assert machine["name"] == "hetzner" and machine["hostname"] == "realbox"


def test_a_note_written_in_the_config_reaches_the_page():
    """Everything else on a tile, a machine said about itself. A note is the part only the
    person who set the board up knows: what the box is for, and why it looks like that."""
    cfg = Config(token=BOARD, machines=[
        Machine(name="hetzner", url="http://hetzner:8090", token=WEAK,
                note="the one paying rent — nightly imports live here"),
    ])
    client = TestClient(create_app(cfg))
    machine = client.get(f"/api/board?token={BOARD}").json()["machines"][0]
    assert machine["note"].startswith("the one paying rent")


def test_a_note_cannot_be_a_paragraph():
    """A tile is a glance. Two hundred characters is already more than fits on one."""
    from app.config import Config as C
    cfg = C.from_dict({"token": BOARD, "machines": [
        {"name": "a", "url": "http://a:8090", "token": WEAK, "note": "x" * 500}]})
    assert len(cfg.machines[0].note) == 200


# ------------------------------------------------------ starting and stopping, both ways

def test_the_board_passes_an_action_through_with_its_own_weak_key(monkeypatch):
    """The page has no key for a machine — that is the whole design — so the board is what
    carries the request. It adds nothing and invents nothing: the name goes through as given
    and the machine refuses it if it is not one of its own."""
    sent = {}

    class Answer:
        status_code = 200

        @staticmethod
        def json():
            return {"name": "nightly", "did": "started"}

    async def pretend(url, **kw):
        sent.update(url=url, auth=kw["headers"]["Authorization"])
        return Answer()

    client, app = boarded()
    monkeypatch.setattr(app.state.http, "post", pretend)
    said = client.post(f"/api/do/hetzner/nightly/start?token={BOARD}")
    assert said.status_code == 200 and said.json()["did"] == "started"
    assert sent["url"] == "http://hetzner:8090/api/runnable/nightly/start"
    assert sent["auth"] == f"Bearer {WEAK}"


def test_only_start_and_stop_go_through():
    client, _ = boarded()
    for action in ("restart", "exec", "kill"):
        assert client.post(f"/api/do/hetzner/nightly/{action}?token={BOARD}").status_code == 400


def test_an_action_for_a_machine_nobody_configured_is_refused():
    client, _ = boarded()
    assert client.post(f"/api/do/nowhere/nightly/start?token={BOARD}").status_code == 404


def test_doing_anything_needs_the_boards_token():
    client, _ = boarded()
    assert client.post("/api/do/hetzner/nightly/start").status_code == 401
    assert client.post(f"/api/do/hetzner/nightly/start?token={REGISTER}").status_code == 401


def test_a_machine_the_board_cannot_reach_is_told_in_its_own_reply():
    """The case this exists for. There is no connection to open, so the instruction waits and
    travels back along the request the machine itself makes."""
    client, app = announcing()
    weak = {"Authorization": f"Bearer {REGISTER}"}
    client.post("/api/report", json=OVERVIEW, headers=weak)

    queued = client.post(f"/api/do/gpu2/nightly/stop?token={BOARD}")
    assert queued.status_code == 200 and queued.json()["queued"] is True

    # It comes back once, in the reply to the next announcement.
    said = client.post("/api/report", json=OVERVIEW, headers=weak).json()
    assert said["do"] == [{"name": "nightly", "action": "stop"}]

    # And once only: if it did not happen, the person presses the button again, which is
    # better than a board insisting at a machine that has already refused.
    again = client.post("/api/report", json=OVERVIEW, headers=weak).json()
    assert again["do"] == []


def test_pressing_the_same_button_twice_queues_one_thing():
    client, app = announcing()
    weak = {"Authorization": f"Bearer {REGISTER}"}
    client.post("/api/report", json=OVERVIEW, headers=weak)
    for _ in range(3):
        client.post(f"/api/do/gpu2/nightly/start?token={BOARD}")
    said = client.post("/api/report", json=OVERVIEW, headers=weak).json()
    assert said["do"] == [{"name": "nightly", "action": "start"}]


def test_a_reply_carries_nothing_when_nothing_was_asked():
    client, _ = announcing()
    said = client.post("/api/report", json=OVERVIEW,
                       headers={"Authorization": f"Bearer {REGISTER}"}).json()
    assert said["do"] == []


# ------------------------------------------------------------------------------- the journal

def journalled(tmp_path, **extra):
    from app import journal as J
    cfg = Config(token=BOARD, registration_token=REGISTER, **extra)
    cfg.journal_store = tmp_path / "journal.jsonl"
    app = create_app(cfg)
    app.state.journal = cfg.journal_store
    J._last_refusal.clear()
    return TestClient(app), cfg.journal_store


def test_a_machine_calling_in_is_not_an_event(tmp_path):
    """Every few seconds, from every machine. Recording it would bury the three things worth
    seeing under thousands of identical lines — which is the file nobody opens."""
    from app import journal as J

    client, store = journalled(tmp_path)
    for _ in range(5):
        client.post("/api/report", json=OVERVIEW, headers={"Authorization": f"Bearer {REGISTER}"})
    assert J.read(store) == []


def test_a_refused_announcement_is_an_event(tmp_path):
    """The registration key is the weakest one here, and a board full of machines that do not
    exist is the thing it could do. Refusals are the only warning of that."""
    from app import journal as J

    client, store = journalled(tmp_path, machines=[
        Machine(name="gpu2", url="http://real:8090", token=WEAK)])
    # A name that is configured cannot be announced over — refused, and worth seeing.
    client.post("/api/report", json=OVERVIEW, headers={"Authorization": f"Bearer {REGISTER}"})
    kept = J.read(store)
    assert kept and kept[0]["status"] == 409 and kept[0]["refused"] is True


def test_who_pressed_stop_is_recorded_here(tmp_path):
    """The machine records that "panoptes" did it, which is the truth from where it stands and
    is not enough: the board is the only thing that knows the click came from a browser."""
    from app import journal as J

    client, store = journalled(tmp_path)
    client.post("/api/report", json=OVERVIEW, headers={"Authorization": f"Bearer {REGISTER}"})
    client.post(f"/api/do/gpu2/argus/stop?token={BOARD}")

    said = [e for e in J.read(store) if "/api/do/" in e["did"]]
    assert said and said[0]["who"] == "the board token"
    assert "argus/stop" in said[0]["did"]


def test_someone_trying_to_get_into_the_board_is_recorded(tmp_path):
    """This page lists every machine you own. A run of 401s against it deserves seeing as much
    as one against a machine."""
    from app import journal as J

    client, store = journalled(tmp_path)
    client.get("/api/board?token=nonsense")
    kept = J.read(store)
    assert kept and kept[0]["refused"] is True and kept[0]["who"] == "someone"


def test_a_burst_is_collapsed_and_still_counted(tmp_path):
    from app import journal as J
    import time as clock

    client, store = journalled(tmp_path)
    for _ in range(9):
        client.get("/api/board?token=nonsense")
    J.flush_swallowed(store, clock.time() + J.QUIET_FOR + 1)
    assert sum(e.get("times", 1) for e in J.read(store) if e.get("refused")) == 9


def test_the_journal_needs_the_board_token(tmp_path):
    client, _ = journalled(tmp_path)
    assert client.get("/api/journal").status_code == 401
    assert client.get(f"/api/journal?token={REGISTER}").status_code == 401
    assert client.get(f"/api/journal?token={BOARD}").status_code == 200


# ------------------------------------------------- machines that announced themselves, kept

def with_memory(tmp_path, **extra):
    cfg = Config(token=BOARD, registration_token=REGISTER, **extra)
    cfg.remembered_store = tmp_path / "announced.json"
    app = create_app(cfg)
    app.state.remembered = cfg.remembered_store
    return TestClient(app), cfg


def test_a_machine_that_announced_itself_survives_a_restart(tmp_path):
    """It used to live only in memory, so restarting the board did not turn a stopped machine
    red — it made the tile vanish. For "is it alive", that is the worst answer there is: gone
    and never-existed look the same."""
    client, cfg = with_memory(tmp_path)
    client.post("/api/report", json=OVERVIEW, headers={"Authorization": f"Bearer {REGISTER}"})
    assert cfg.remembered_store.exists()

    again = create_app(cfg)
    again.state.remembered = cfg.remembered_store
    board = TestClient(again).get(f"/api/board?token={BOARD}").json()["machines"]
    assert [m["name"] for m in board] == ["gpu2"]
    # Believed to be *there*, not believed to be *up*: it has not called in since the restart.
    assert board[0]["ok"] is False and board[0]["reason"] == "silent"
    assert board[0]["url"] == "http://gpu2:8090"
    assert board[0]["sessions"]          # and what it was doing when it went


def test_the_remembered_file_holds_no_key(tmp_path):
    client, cfg = with_memory(tmp_path)
    client.post("/api/report", json=OVERVIEW, headers={"Authorization": f"Bearer {REGISTER}"})
    on_disk = cfg.remembered_store.read_text(encoding="utf-8")
    assert REGISTER not in on_disk and BOARD not in on_disk
    assert cfg.remembered_store.stat().st_mode & 0o077 == 0


def test_a_machine_can_be_forgotten_on_purpose(tmp_path):
    """The cost of remembering: a decommissioned machine would sit there red for ever. The
    board cannot tell "off for ten minutes" from "gone", so removing one is a person's job."""
    client, cfg = with_memory(tmp_path)
    client.post("/api/report", json=OVERVIEW, headers={"Authorization": f"Bearer {REGISTER}"})
    assert client.delete(f"/api/machines/gpu2?token={BOARD}").json() == {"forgot": "gpu2"}
    assert client.get(f"/api/board?token={BOARD}").json()["machines"] == []

    again = create_app(cfg)
    again.state.remembered = cfg.remembered_store
    assert TestClient(again).get(f"/api/board?token={BOARD}").json()["machines"] == []


def test_a_configured_machine_cannot_be_forgotten_from_the_board(tmp_path):
    """It would come straight back on the next sweep and the button would look broken."""
    client, _ = with_memory(tmp_path, machines=[
        Machine(name="hetzner", url="http://hetzner:8090", token=WEAK)])
    assert client.delete(f"/api/machines/hetzner?token={BOARD}").status_code == 409


def test_forgetting_needs_the_board_token(tmp_path):
    client, _ = with_memory(tmp_path)
    client.post("/api/report", json=OVERVIEW, headers={"Authorization": f"Bearer {REGISTER}"})
    assert client.delete("/api/machines/gpu2").status_code == 401
    assert client.delete(f"/api/machines/gpu2?token={REGISTER}").status_code == 401


def test_a_board_with_no_config_path_writes_nothing():
    """A board built without one is a test, or something embedding this. Neither should quietly
    write into the real ~/.config/panoptes — which is what happened, and which made one test's
    machines turn up in another test's board."""
    app = create_app(Config(token=BOARD, registration_token=REGISTER))
    assert app.state.remembered is None and app.state.journal is None
    client = TestClient(app)
    client.post("/api/report", json=OVERVIEW, headers={"Authorization": f"Bearer {REGISTER}"})
    assert client.get(f"/api/board?token={BOARD}").json()["machines"][0]["name"] == "gpu2"
