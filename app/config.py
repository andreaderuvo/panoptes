"""Configuration: one YAML file, listing the machines to watch."""

from __future__ import annotations

import os
import secrets
from dataclasses import dataclass, field
from pathlib import Path

import yaml

DEFAULT_LISTEN = "127.0.0.1:8070"
DEFAULT_EVERY = 5.0
DEFAULT_TIMEOUT = 3.0


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

    @property
    def overview(self) -> str:
        return f"{self.url.rstrip('/')}/api/overview"


@dataclass
class Config:
    token: str
    machines: list[Machine] = field(default_factory=list)
    listen: str = DEFAULT_LISTEN
    # How often every machine is asked, and how long any one of them may take. A board
    # that blocks because one box is down is a board nobody trusts.
    every: float = DEFAULT_EVERY
    timeout: float = DEFAULT_TIMEOUT

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
            machines.append(Machine(name=name, url=url, token=token))
        return cls(
            token=str(raw.get("token", "")),
            machines=machines,
            listen=str(raw.get("listen", DEFAULT_LISTEN)),
            every=float(raw.get("every", DEFAULT_EVERY)),
            timeout=float(raw.get("timeout", DEFAULT_TIMEOUT)),
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
            if m.token == self.token:
                # Then the board's own key is a machine's key, and a mistake here undoes
                # the reason for having two kinds.
                raise ConfigError(f"the token for {m.name!r} is the same as this board's token")
        if self.every < 1:
            raise ConfigError("`every` under a second would hammer the machines for nothing")

    def to_dict(self) -> dict:
        return {
            "listen": self.listen,
            "token": self.token,
            "every": self.every,
            "timeout": self.timeout,
            "machines": [{"name": m.name, "url": m.url, "token": m.token} for m in self.machines],
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
