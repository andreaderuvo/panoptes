"""Panoptes: one board over several machines running Argus.

The name is Argus's own epithet — Argus Panoptes, the herdsman of a hundred eyes. This
watches the watchmen, which is all it does: it asks each machine what is happening, draws
one board, and sends you to the machine itself when you pick something.

It deliberately does not proxy anything. Clicking a machine opens that Argus directly, in
its own origin, with the token your browser already holds for it. That is why this server
only ever needs the *watcher* tokens, which open one read-only door apiece: lose this box
and you have lost a list of session names, not the machines.
"""

from __future__ import annotations

import argparse
import asyncio
import contextlib
import hmac
import time
from pathlib import Path
from urllib.parse import parse_qs

import uvicorn
from fastapi import FastAPI, Request
from fastapi.responses import FileResponse, JSONResponse, PlainTextResponse, Response

from .config import Config, ConfigError, default_path
from .watch import Seen, round_of

VERSION = "0.1.0"
STATIC_DIR = Path(__file__).resolve().parent.parent / "static"
PROTECTED = ("/api",)


def presented_token(scope: dict) -> str | None:
    for key, value in scope.get("headers") or []:
        if key.lower() == b"authorization":
            text = value.decode("latin-1")
            if text.startswith("Bearer "):
                return text[len("Bearer ") :].strip()
    found = parse_qs((scope.get("query_string") or b"").decode("latin-1")).get("token")
    return found[0] if found else None


class TokenGate:
    """The same gate Argus uses, and for the same reason: this page says what is running
    on every machine you own, which is worth guarding even though it can start nothing."""

    def __init__(self, app, token: str):
        self.app = app
        self.token = token

    async def __call__(self, scope, receive, send):
        path = scope.get("path", "")
        if scope["type"] != "http" or not any(path == p or path.startswith(p + "/") for p in PROTECTED):
            return await self.app(scope, receive, send)
        given = presented_token(scope)
        if given is not None and hmac.compare_digest(given.encode(), self.token.encode()):
            return await self.app(scope, receive, send)
        response = PlainTextResponse("missing or invalid token", status_code=401)
        await response(scope, receive, send)


async def sweep(app: FastAPI) -> None:
    """One poller for the whole board, however many browsers are watching it: ten open
    tabs must not mean ten times the questions."""
    cfg = app.state.cfg
    while True:
        try:
            app.state.seen = await round_of(cfg, app.state.seen)
            app.state.swept = time.time()
        except Exception:
            # A board that dies because one round went wrong is worse than a stale one.
            pass
        await asyncio.sleep(cfg.every)


def create_app(cfg: Config) -> FastAPI:
    @contextlib.asynccontextmanager
    async def lifespan(app: FastAPI):
        app.state.sweeper = asyncio.create_task(sweep(app))
        try:
            yield
        finally:
            app.state.sweeper.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await app.state.sweeper

    app = FastAPI(title="Panoptes", version=VERSION, docs_url=None, redoc_url=None,
                  openapi_url="/api/openapi.json", lifespan=lifespan)
    app.state.cfg = cfg
    app.state.seen: dict[str, Seen] = {}
    app.state.swept = 0.0

    @app.get("/api/board", summary="Every machine, as of the last sweep")
    async def board() -> dict:
        """What the page draws. Note what is *not* in here: no tokens. The browser is told
        where each machine lives, never how to get in — it already knows that, per origin,
        or it does not and you go and let it know once."""
        machines = [app.state.seen[m.name].as_dict() if m.name in app.state.seen
                    else {"name": m.name, "url": m.url, "ok": False, "why": "not asked yet"}
                    for m in cfg.machines]
        # The ones wanting you first: a board is read top down and the top is the point.
        def urgency(m: dict) -> tuple:
            asking = any(s.get("bell") == "asking" for s in m.get("sessions") or [])
            done = any(s.get("bell") for s in m.get("sessions") or [])
            return (not asking, not done, m.get("ok") is not True, m["name"])
        return {
            "version": VERSION,
            "swept": app.state.swept,
            "every": cfg.every,
            "machines": sorted(machines, key=urgency),
        }

    @app.get("/api/health", summary="Is the board itself up")
    async def health() -> dict:
        return {"ok": True, "version": VERSION, "machines": len(cfg.machines)}

    @app.get("/{requested:path}", include_in_schema=False)
    async def static_handler(requested: str) -> Response:
        target = (STATIC_DIR / (requested or "index.html")).resolve()
        if not str(target).startswith(str(STATIC_DIR)) or not target.is_file():
            index = STATIC_DIR / "index.html"
            if index.is_file():
                return FileResponse(index)
            return JSONResponse({"error": "frontend missing"}, status_code=500)
        return FileResponse(target)

    app.add_middleware(TokenGate, token=cfg.token)
    return app


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="panoptes", description=__doc__)
    parser.add_argument("--config", type=Path, default=default_path())
    args = parser.parse_args(argv)

    try:
        cfg, fresh = Config.load_or_create(args.config)
    except ConfigError as e:
        print(f"panoptes: {e}")
        return 2

    host, _, port = cfg.listen.rpartition(":")
    print(f"\n  panoptes {VERSION} · {len(cfg.machines)} machine(s)")
    if fresh:
        print(f"  wrote {args.config} — add your machines to it")
    print(f"  open    http://{host or '127.0.0.1'}:{port}/?token={cfg.token}\n")
    uvicorn.run(create_app(cfg), host=host or "127.0.0.1", port=int(port), log_level="warning")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
