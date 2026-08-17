"""Configuration: one YAML file, listing the machines to watch."""

from __future__ import annotations

import os
import re
import secrets
from dataclasses import dataclass, field
from pathlib import Path

import yaml

DEFAULT_LISTEN = "127.0.0.1:8070"
DEFAULT_EVERY = 5.0
DEFAULT_TIMEOUT = 3.0


# A colour written by hand, checked before it reaches a stylesheet. Anything else is a
# typo, and a typo that silently paints nothing is a typo you hunt for.
PAINT = re.compile(r"#[0-9a-fA-F]{6}")


class ConfigError(Exception):
    """The config exists but cannot be used as written."""


def generate_token() -> str:
    return secrets.token_hex(32)


def default_path() -> Path:
    base = os.environ.get("XDG_CONFIG_HOME")
    root = Path(base) if base else Path(os.environ.get("HOME") or "/") / ".config"
    return root / "panoptes" / "config.yaml"


@dataclass
class Machine:
    """One Argus, and the weak key that asks it what is happening.

    `token` is a *watcher* token: on the Argus side it opens `GET /api/overview` and
    nothing else. It is held here, on the server, and never sent to a browser. What the
    browser gets is the summary; when you click through to a machine you reach that Argus
    directly, with the real token already in that origin's storage.
    """

    name: str
    url: str
    token: str
    # A colour for this machine's tile, for when the one its name happens to hash to is not
    # the one you want. Either an index into the board's palette (0-7) or a literal
    # `#rrggbb`. Set here it is the same on every device that opens the board; a reader can
    # still override it for themselves in their own browser, which is where a preference
    # about how something looks belongs.
    colour: str = ""
    # Where a *browser* should go, which is not always where this board asks.
    #
    # A board running on the same machine as an Argus polls it over loopback, because that
    # is the shortest and safest way to ask. Putting that address on the card sends the
    # reader to their own laptop. The two are different questions and they get different
    # answers; unset, they are the same.
    reach: str = ""

    @property
    def overview(self) -> str:
        return f"{self.url.rstrip('/')}/api/overview"

    @property
    def link(self) -> str:
        return (self.reach or self.url).rstrip("/")


@dataclass
class Config:
    token: str
    machines: list[Machine] = field(default_factory=list)
    listen: str = DEFAULT_LISTEN
    # How often every machine is asked, and how long any one of them may take. A board
    # that blocks because one box is down is a board nobody trusts.
    every: float = DEFAULT_EVERY
    timeout: float = DEFAULT_TIMEOUT
    # A machine that cannot be reached from here can announce itself instead, with this
    # key. Empty means nobody may: a board that accepts anything it is told is a board
    # anyone can fill with machines that do not exist.
    registration_token: str = ""
    # How long an announced machine stays believed after it goes quiet. It says nothing
    # about how often it speaks, so this is a plain grace period rather than a multiple.
    forget_after: float = 45.0

    @classmethod
    def from_dict(cls, raw: dict) -> Config:
        if not isinstance(raw, dict):
            raise ConfigError("the config file must contain a YAML mapping")
        machines = []
        for entry in raw.get("machines") or []:
            if not isinstance(entry, dict):
                raise ConfigError("every entry under `machines` must be a mapping")
            name = str(entry.get("name") or "").strip()
            url = str(entry.get("url") or "").strip()
            token = str(entry.get("token") or "").strip()
            if not (name and url and token):
                raise ConfigError("a machine needs a name, a url and a token")
            machines.append(Machine(name=name, url=url, token=token,
                                    reach=str(entry.get("reach") or "").strip(),
                                    colour=str(entry.get("colour") or entry.get("color") or "").strip()))
        return cls(
            token=str(raw.get("token", "")),
            machines=machines,
            listen=str(raw.get("listen", DEFAULT_LISTEN)),
            every=float(raw.get("every", DEFAULT_EVERY)),
            timeout=float(raw.get("timeout", DEFAULT_TIMEOUT)),
            registration_token=str(raw.get("registration_token") or ""),
            forget_after=float(raw.get("forget_after", 45.0)),
        )

    def validate(self) -> None:
        if not self.token.strip():
            raise ConfigError("`token` is empty — refusing to start without authentication")
        if len(self.token) < 16:
            raise ConfigError("`token` is shorter than 16 characters — pick something unguessable")
        seen = set()
        for m in self.machines:
            if m.name in seen:
                raise ConfigError(f"two machines are both called {m.name!r}")
            seen.add(m.name)
            if not m.url.startswith(("http://", "https://")):
                raise ConfigError(f"the url for {m.name!r} must start with http:// or https://")
            if m.colour and not (m.colour.isdigit() or PAINT.fullmatch(m.colour)):
                raise ConfigError(
                    f"the colour for {m.name!r} must be a palette index (0-7) or a #rrggbb value"
                )
            if m.token == self.token:
                # Then the board's own key is a machine's key, and a mistake here undoes
                # the reason for having two kinds.
                raise ConfigError(f"the token for {m.name!r} is the same as this board's token")
        if self.registration_token:
            if len(self.registration_token) < 16:
                raise ConfigError("`registration_token` is shorter than 16 characters")
            if self.registration_token == self.token:
                raise ConfigError("`registration_token` is the same as this board's token")
        if self.every < 1:
            raise ConfigError("`every` under a second would hammer the machines for nothing")

    def to_dict(self) -> dict:
        return {
            "listen": self.listen,
            "token": self.token,
            "every": self.every,
            "timeout": self.timeout,
            "registration_token": self.registration_token,
            "forget_after": self.forget_after,
            "machines": [
                {"name": m.name, "url": m.url, "token": m.token,
                 **({"reach": m.reach} if m.reach else {}),
                 **({"colour": m.colour} if m.colour else {})}
                for m in self.machines
            ],
        }

    def write_to(self, path: Path) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(yaml.safe_dump(self.to_dict(), sort_keys=False), encoding="utf-8")
        path.chmod(0o600)   # it holds a key to every machine on it, weak ones or not

    @classmethod
    def load_or_create(cls, path: Path) -> tuple[Config, bool]:
        if path.exists():
            try:
                raw = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
            except yaml.YAMLError as e:
                raise ConfigError(f"parsing {path}: {e}") from e
            cfg = cls.from_dict(raw)
            cfg.validate()
            return cfg, False

        cfg = cls(token=generate_token())
        cfg.write_to(path)
        return cfg, True
