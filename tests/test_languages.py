"""The catalogues, and whether they still match the source.

Every string in the page is wrapped in `t()`, whose key is the English text itself. That
makes a catalogue readable by whoever translates it and makes a missing entry fall back to
English rather than showing a code — but it also means the keys live in two places, and the
one that rots is always the catalogue.

So this reads the keys back out of `app.js` and insists every language has exactly those.
A translation that is merely missing is invisible: the page shows English and nobody
notices for months.
"""

from __future__ import annotations

import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
APP = ROOT / "static" / "app.js"
LANG = ROOT / "static" / "lang"

QUOTED = re.compile(r"'((?:[^'\\]|\\.)*)'")


def keys_in_source() -> set[str]:
    """Every literal that reaches `t()` as its first argument.

    Not a single regex, because the first argument is not always one literal: a plural is
    written `t(n === 1 ? '{n} machine' : '{n} machines', …)`, and a pattern that only matched
    a bare string silently skipped both branches — which is how a catalogue ends up with
    entries nothing asks for and no entry for what is actually shown.

    So the argument region is found by counting parentheses, and every literal inside it is
    a key. `t(theme)` and `t(pattern)` pass a variable and contribute nothing here; the
    literals those can hold are declared elsewhere and are covered separately below.
    """
    body = APP.read_text(encoding="utf-8")
    found: set[str] = set()
    for m in re.finditer(r"\bt\(", body):
        i, depth = m.end(), 1
        while i < len(body) and depth:
            if body[i] == "(":
                depth += 1
            elif body[i] == ")":
                depth -= 1
            elif body[i] == "," and depth == 1:
                break        # the variables come after the key
            i += 1
        found.update(QUOTED.findall(body[m.end():i]))
    return found


def reasons_in_source() -> set[str]:
    body = APP.read_text(encoding="utf-8")
    block = body[body.index("const REASONS = {"):body.index("function whyNot")]
    return set(re.findall(r":\s*'([^']+)'", block))


def modes() -> set[str]:
    """The theme names, which are passed to `t()` as a variable."""
    return {"dark", "light", "auto"}


def wanted() -> set[str]:
    return keys_in_source() | reasons_in_source() | modes()


def catalogues() -> dict[str, dict]:
    return {p.stem: json.loads(p.read_text(encoding="utf-8")) for p in sorted(LANG.glob("*.json"))}


def test_the_languages_argus_has_are_the_languages_here():
    """Two windows onto the same work should not offer different languages."""
    assert set(catalogues()) == {"en", "es", "fr", "it"}


def test_every_catalogue_covers_every_string_and_invents_none():
    need = wanted()
    for code, entry in catalogues().items():
        strings = entry["strings"]
        missing = sorted(need - set(strings))
        assert not missing, f"{code} is missing {len(missing)}: {missing[:8]}"
        extra = sorted(set(strings) - need)
        assert not extra, f"{code} translates strings nothing asks for: {extra[:8]}"


def test_a_translation_keeps_the_placeholders_it_was_given():
    """`{n}` dropped in translation is a sentence with a hole in it, and it only shows up on
    the screen of somebody reading in that language — which is to say, not here."""
    holes = re.compile(r"\{(\w+)\}")
    for code, entry in catalogues().items():
        for key, said in entry["strings"].items():
            assert set(holes.findall(key)) == set(holes.findall(said)), \
                f"{code}: {key!r} became {said!r}"


def test_each_catalogue_says_what_it_is():
    for code, entry in catalogues().items():
        assert entry["code"] == code
        assert entry["name"].strip()


def test_english_is_its_own_translation():
    """It exists so the set of keys is checkable and so a translator has something to copy;
    if a value ever differs from its key, one of the two is a typo."""
    english = catalogues()["en"]["strings"]
    wrong = {k: v for k, v in english.items() if k != v}
    assert not wrong, wrong


# --------------------------------------------------------------- catalogues from outside

from fastapi.testclient import TestClient      # noqa: E402

from app.config import Config                  # noqa: E402
from app.main import create_app                # noqa: E402
from app import languages                      # noqa: E402

BOARD = "board-0123456789abcdef0123456789"


def served(tmp_path):
    cfg = Config(token=BOARD)
    cfg.config_path = tmp_path / "config.yaml"
    return TestClient(create_app(cfg)), tmp_path / "lang"


def test_a_language_dropped_in_appears_without_anything_else_being_done(tmp_path):
    """The whole bar for translating this is meant to be "write one JSON file". If it then
    has to be registered somewhere, the file is loadable and invisible, which is worse than
    not supporting it at all."""
    client, folder = served(tmp_path)
    folder.mkdir()
    (folder / "de.json").write_text(
        json.dumps({"code": "de", "name": "Deutsch", "strings": {"Close": "Schließen"}}),
        encoding="utf-8")

    listed = client.get(f"/api/languages?token={BOARD}").json()
    assert {"code": "de", "name": "Deutsch"} in listed
    # English first, then by name: a picker is read, not parsed.
    assert listed[0]["code"] == "en"

    said = client.get(f"/api/language/de?token={BOARD}").json()
    assert said["strings"]["Close"] == "Schließen"


def test_a_local_file_beats_the_one_that_ships(tmp_path):
    """Which is how somebody fixes a wording they disagree with, without a fork."""
    client, folder = served(tmp_path)
    folder.mkdir()
    (folder / "it.json").write_text(
        json.dumps({"code": "it", "name": "Italiano (mine)", "strings": {"Close": "Via"}}),
        encoding="utf-8")
    assert client.get(f"/api/language/it?token={BOARD}").json()["name"] == "Italiano (mine)"
    names = {l["code"]: l["name"] for l in client.get(f"/api/languages?token={BOARD}").json()}
    assert names["it"] == "Italiano (mine)"


def test_a_half_written_file_does_not_stop_the_board(tmp_path):
    """A directory people put files in is a directory with a broken file in it eventually."""
    client, folder = served(tmp_path)
    folder.mkdir()
    (folder / "xx.json").write_text("{ this is not json", encoding="utf-8")
    (folder / "yy.json").write_text('{"strings": {"Close": 7}}', encoding="utf-8")
    (folder / "zz.json").write_text('"not even an object"', encoding="utf-8")

    listed = client.get(f"/api/languages?token={BOARD}").json()
    assert [l["code"] for l in listed] == ["en", "es", "fr", "it"]


def test_a_code_cannot_walk_out_of_the_folder(tmp_path):
    """It arrives in a URL, so it is somebody else's input.

    `../config` never even reaches the handler — the client normalises it away and it lands
    on a route that does not exist — which is worth asserting all the same, because what it
    must not do is come back 200 with a page of HTML.
    """
    client, _ = served(tmp_path)
    for bad in ("../config", "..%2fconfig", "en/../../etc/passwd", "EN;rm", "a" * 40):
        answer = client.get(f"/api/language/{bad}?token={BOARD}")
        assert answer.status_code in (404, 400), f"{bad} → {answer.status_code}"
        assert "<html" not in answer.text.lower(), bad


def test_a_catalogue_needs_a_token_like_everything_else(tmp_path):
    """It is not a secret, but it is under /api and the gate should not have exceptions
    nobody remembers."""
    client, _ = served(tmp_path)
    assert client.get("/api/languages").status_code == 401
    assert client.get("/api/language/it").status_code == 401


def test_an_enormous_file_is_not_read(tmp_path):
    folder = tmp_path / "lang"
    folder.mkdir()
    huge = folder / "de.json"
    huge.write_text(json.dumps({"strings": {str(i): "x" * 200 for i in range(4000)}}), encoding="utf-8")
    assert huge.stat().st_size > languages.MAX_BYTES
    assert languages.read(huge) is None
