"""Interface languages, including ones nobody here wrote.

Four ship with the board. Anyone can add a fifth, and the bar for doing it is deliberately
as low as it goes: a catalogue is one flat JSON file whose keys are the English strings.
No gettext, no `.po`, no extraction step, no build, and nothing to register — drop the file
in and it appears in the picker.

    ~/.config/panoptes/lang/de.json

    {"code": "de", "name": "Deutsch", "strings": {"Close": "Schließen", …}}

A bare mapping works too, if the filename is the code. A missing entry falls back to
English rather than showing a blank or a code, so a half-finished translation is useful on
the day it is started.

A file here overrides one that ships with the board, which is how you fix a wording you
disagree with without touching the repository.
"""

from __future__ import annotations

import json
import re
from pathlib import Path

CODE = re.compile(r"^[a-z]{2}(-[a-z]{2})?$")
# A catalogue this size is a mistake, not a translation, and reading it into memory on every
# request would be somebody's afternoon gone.
MAX_BYTES = 512 * 1024


def lang_dir(config: Path) -> Path:
    """Beside the config file, since that is the one path the reader already knows."""
    return config.parent / "lang"


def valid_code(code: str) -> bool:
    return bool(CODE.match((code or "").strip().lower()))


def read(path: Path) -> dict | None:
    """One catalogue, or None if it is not one. Never raises: a board must not fail to start
    because somebody left a half-written file in a directory."""
    try:
        if path.stat().st_size > MAX_BYTES:
            return None
        raw = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
    if not isinstance(raw, dict):
        return None

    strings = raw.get("strings") if isinstance(raw.get("strings"), dict) else raw
    if not isinstance(strings, dict):
        return None
    # Values must be text. A nested object here would reach the page and be rendered as
    # "[object Object]" in the middle of a sentence.
    strings = {str(k): v for k, v in strings.items() if isinstance(v, str)}
    if not strings:
        return None

    code = str(raw.get("code") or path.stem).strip().lower()
    if not valid_code(code):
        return None
    return {"code": code, "name": str(raw.get("name") or code).strip() or code, "strings": strings}


def available(builtin: Path, extra: Path | None) -> list[dict]:
    """Every language the board can offer, in the order a picker should show them.

    English first because it is the source, then the rest by name. Only the code and the
    name: the picker needs no strings, and sending four catalogues to draw a list of four
    words is four times the page.
    """
    found: dict[str, str] = {}
    for folder in (builtin, extra):
        if not folder or not folder.is_dir():
            continue
        for path in sorted(folder.glob("*.json")):
            entry = read(path)
            if entry:
                # Later wins, and `extra` comes second on purpose: a file you dropped in
                # replaces the one that ships, which is how a wording gets fixed locally.
                found[entry["code"]] = entry["name"]
    listed = [{"code": c, "name": n} for c, n in found.items()]
    listed.sort(key=lambda l: (l["code"] != "en", l["name"].lower()))
    return listed


def locate(code: str, builtin: Path, extra: Path | None) -> Path | None:
    """The file for a code, preferring a local one. Returns None rather than a path outside
    either folder: the code arrives in a URL."""
    if not valid_code(code):
        return None
    code = code.strip().lower()
    for folder in (extra, builtin):
        if not folder or not folder.is_dir():
            continue
        path = folder / f"{code}.json"
        try:
            resolved = path.resolve()
        except OSError:
            continue
        if not str(resolved).startswith(str(folder.resolve())):
            continue
        if resolved.is_file():
            return resolved
    return None
