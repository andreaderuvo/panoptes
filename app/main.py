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
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import FileResponse, JSONResponse, PlainTextResponse, Response

import httpx

from . import languages
from .config import Config, ConfigError, DEFAULT_LISTEN, default_path
from .watch import Seen, round_of

VERSION = "0.0.1"
STATIC_DIR = Path(__file__).resolve().parent.parent / "static"
BUILTIN_LANG = STATIC_DIR / "lang"
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

    def __init__(self, app, token: str, registration: str = ""):
        self.app = app
        self.token = token
        self.registration = registration

    async def __call__(self, scope, receive, send):
        path = scope.get("path", "")
        if scope["type"] != "http" or not any(path == p or path.startswith(p + "/") for p in PROTECTED):
            return await self.app(scope, receive, send)
        given = presented_token(scope)
        if given is not None and hmac.compare_digest(given.encode(), self.token.encode()):
            return await self.app(scope, receive, send)
        # Announcing is not looking. A machine's key opens one door and cannot read the
        # board; the board's token cannot be used to invent machines.
        if (path == "/api/report" and given is not None and self.registration
                and hmac.compare_digest(given.encode(), self.registration.encode())):
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
        # One client for the passing-through, kept open: a new connection per button press is
        # a handshake nobody needs, and the sweeper has its own for the same reason.
        app.state.http = httpx.AsyncClient(follow_redirects=False)
        app.state.sweeper = asyncio.create_task(sweep(app))
        try:
            yield
        finally:
            app.state.sweeper.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await app.state.sweeper
            await app.state.http.aclose()

    app = FastAPI(title="Panoptes", version=VERSION, docs_url=None, redoc_url=None,
                  openapi_url="/api/openapi.json", lifespan=lifespan)
    app.state.cfg = cfg
    app.state.seen: dict[str, Seen] = {}
    # Machines that announce themselves, kept apart from the ones this board polls: the
    # two are believed for different reasons and go stale differently.
    app.state.told: dict[str, Seen] = {}
    app.state.swept = 0.0
    # Instructions for machines this board cannot reach, waiting for them to call in. In
    # memory on purpose: a board that restarts should forget what it was about to say rather
    # than replay it at a machine that has moved on.
    app.state.queued: dict[str, list[dict]] = {}
    # Replaced by the lifespan's own, and present before it so a TestClient — which does run
    # the lifespan — and a bare create_app both work.
    app.state.http = httpx.AsyncClient(follow_redirects=False)
    # Where a reader's own catalogues live. Set from the config path so it moves with it.
    app.state.lang = languages.lang_dir(getattr(cfg, "config_path", None) or default_path())

    @app.get("/api/board", summary="Every machine, as of the last sweep")
    async def board() -> dict:
        """What the page draws. Note what is *not* in here: no tokens. The browser is told
        where each machine lives, never how to get in — it already knows that, per origin,
        or it does not and you go and let it know once."""
        painted = {m.name: m.colour for m in cfg.machines if m.colour}
        noted = {m.name: m.note for m in cfg.machines if m.note}
        machines = [app.state.seen[m.name].as_dict() if m.name in app.state.seen
                    else {"name": m.name, "url": m.link, "ok": False,
                          "why": "not asked yet", "reason": "not-asked"}
                    for m in cfg.machines]
        for said in machines:
            if said["name"] in painted:
                said["colour"] = painted[said["name"]]
            if said["name"] in noted:
                said["note"] = noted[said["name"]]
        # An announced machine is believed until it has been quiet too long. There is no
        # request to fail here, so silence is the only signal there is.
        now = time.time()
        for told in app.state.told.values():
            said = told.as_dict()
            if now - told.at > cfg.forget_after:
                said["ok"] = False
                said["why"] = "has not called in"
                said["reason"] = "silent"
            said["announced"] = True
            machines.append(said)
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

    @app.post("/api/report", summary="A machine announcing what it is doing")
    async def report(request: Request) -> dict:
        """For machines this board cannot reach.

        The usual arrangement is the other way round and it is the better one where it
        works: the board polls, and a request that fails *is* the signal that a machine is
        down. It stops working the moment the network only goes one way — two boxes on one
        wire, one refusing everything inbound — and then the only thing that can work is
        the machine opening the connection itself, in the direction that already does.

        What arrives is what that machine's own /api/overview would have said, plus the
        name it goes by and where a browser can reach it. Nothing here is executed and
        nothing is stored on disk.
        """
        if not cfg.registration_token:
            raise HTTPException(status_code=403, detail="this board does not accept announcements")
        body = await request.json()
        if not isinstance(body, dict) or "sessions" not in body:
            raise HTTPException(status_code=400, detail="that is not an overview")
        name = str(body.get("name") or "").strip()
        if not name:
            raise HTTPException(status_code=400, detail="an announcement needs a name")
        # A machine that is also in the config does not get to overwrite it: the list you
        # wrote by hand is the one you meant.
        if any(m.name == name for m in cfg.machines):
            raise HTTPException(status_code=409, detail="a machine of that name is already configured here")
        app.state.told[name] = Seen(
            name=name,
            url=str(body.get("reach") or ""),
            at=time.time(),
            ok=True,
            overview={k: v for k, v in body.items() if k not in ("reach",)},
        )
        # The reply is the only way to say anything to a machine on the far side of a
        # one-way network, so it carries whatever was asked for while it was away. Handed
        # over once: if it does not happen, the person presses the button again — better than
        # a board that keeps insisting at a machine that has already refused.
        waiting = app.state.queued.pop(name, [])
        return {"heard": name, "do": waiting}

    @app.post("/api/do/{name}/{what}/{action}", summary="Start or stop something on a machine")
    async def do_one(name: str, what: str, action: str) -> dict:
        """Passed straight through to that machine, with the weak key this board holds.

        The board adds nothing and invents nothing: `what` has to be a name that machine
        published, and if it is not, that machine says so. This exists rather than letting
        the page call the machine directly because the page has no key for it — which is the
        whole design, and the reason clicking a tile opens a new origin instead.

        For a machine that announces itself, the board cannot reach it at all. Then the
        request is written down and handed over the next time it calls in, and the answer
        here says `queued` rather than pretending it happened.
        """
        if action not in ("start", "stop"):
            raise HTTPException(status_code=400, detail="start or stop")

        machine = next((m for m in cfg.machines if m.name == name), None)
        if machine is None:
            if name not in app.state.told:
                raise HTTPException(status_code=404, detail=f"no machine called {name}")
            # Nothing here can reach it. Leave the instruction where its own next
            # announcement will find it.
            queue = app.state.queued.setdefault(name, [])
            if not any(q["name"] == what and q["action"] == action for q in queue):
                queue.append({"name": what, "action": action})
            return {"queued": True, "machine": name, "name": what, "action": action}

        # The reserved name. `argus` is the server itself, which has its own door — and only
        # `stop`, because nothing that is off can be asked to come back on.
        if what == "argus":
            if action != "stop":
                raise HTTPException(status_code=400, detail="argus can only be stopped")
            where = f"{machine.url.rstrip('/')}/api/shutdown"
        else:
            where = f"{machine.url.rstrip('/')}/api/runnable/{what}/{action}"

        try:
            answer = await app.state.http.post(
                where,
                headers={"Authorization": f"Bearer {machine.token}"},
                timeout=cfg.timeout + 5,
            )
        except Exception as e:
            raise HTTPException(status_code=502, detail=f"{name}: {type(e).__name__}") from e
        if answer.status_code >= 400:
            raise HTTPException(status_code=answer.status_code,
                                detail=f"{name}: {answer.text[:200]}")
        return {"machine": name, **answer.json()}

    @app.get("/api/languages", summary="The interface languages available")
    async def list_languages() -> list[dict]:
        """Whatever is in `static/lang/` plus whatever is in `<config>/lang/`, so adding a
        language is dropping a JSON file in and nothing else."""
        return languages.available(BUILTIN_LANG, app.state.lang)

    @app.get("/api/language/{code}", summary="One language catalogue")
    async def one_language(code: str) -> dict:
        path = languages.locate(code, BUILTIN_LANG, app.state.lang)
        entry = languages.read(path) if path else None
        if not entry:
            raise HTTPException(status_code=404, detail=f"no language called {code}")
        return entry

    @app.get("/api/health", summary="Is the board itself up")
    async def health() -> dict:
        return {"ok": True, "version": VERSION, "machines": len(cfg.machines)}

    @app.get("/{requested:path}", include_in_schema=False)
    async def static_handler(requested: str) -> Response:
        # Anything under /api that got this far is a route that does not exist. Handing it
        # index.html means an API client reads 200 and a page of HTML where it asked a
        # question — and a mistyped endpoint looks like it worked.
        if requested == "api" or requested.startswith("api/"):
            raise HTTPException(status_code=404, detail=f"no such endpoint: /{requested}")
        target = (STATIC_DIR / (requested or "index.html")).resolve()
        if not str(target).startswith(str(STATIC_DIR)) or not target.is_file():
            index = STATIC_DIR / "index.html"
            if index.is_file():
                return FileResponse(index, headers={"cache-control": "no-cache"})
            return JSONResponse({"error": "frontend missing"}, status_code=500)
        # Always revalidated. There is no service worker here and no version in the file
        # names, so without this a browser keeps yesterday's page and you debug a fix that
        # is already deployed — which is exactly what happened.
        return FileResponse(target, headers={"cache-control": "no-cache"})

    app.add_middleware(TokenGate, token=cfg.token, registration=cfg.registration_token)
    return app


def addresses() -> list[str]:
    """The addresses a phone could actually dial. Loopback and Docker bridges are not
    among them, however truthfully the kernel lists them."""
    found = []
    try:
        import subprocess
        out = subprocess.run(["hostname", "-I"], capture_output=True, text=True, timeout=2).stdout
        for ip in out.split():
            if ip.startswith("127.") or ":" in ip:
                continue
            # Docker's own range is 172.16-31, and listing one of its bridges as somewhere
            # to point a phone is worse than listing nothing.
            bits = ip.split(".")
            if bits[0] == "172" and 16 <= int(bits[1]) <= 31:
                continue
            found.append(ip)
    except Exception:
        pass
    return found or ["127.0.0.1"]


def print_qr(url: str) -> None:
    """A code you can photograph. The board needs its token before it shows anything, and
    typing sixty-four hex characters into a phone is not a thing anybody should do."""
    try:
        import segno
    except ImportError:
        print("  (pip install segno for a scannable code)")
        return
    segno.make(url, error="m").terminal(compact=True)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="panoptes", description=__doc__)
    parser.add_argument("--config", type=Path, default=default_path())
    parser.add_argument("--qr", action="store_true",
                        help="print a code you can photograph, for each address it answers on")
    # Overrides the config for this run only. The usual reason is a port already taken, and
    # editing a file to find that out is a slow way to try the next one.
    parser.add_argument("--listen", metavar="HOST:PORT",
                        help=f"where to answer (default {DEFAULT_LISTEN}, or whatever the config says)")
    args = parser.parse_args(argv)

    try:
        cfg, fresh = Config.load_or_create(args.config)
    except ConfigError as e:
        print(f"panoptes: {e}")
        return 2

    if args.listen:
        cfg.listen = args.listen
    host, _, port = cfg.listen.rpartition(":")
    print(f"\n  panoptes {VERSION} · {len(cfg.machines)} machine(s)"
          f"{' · accepts announcements' if cfg.registration_token else ''}")
    if fresh:
        print(f"  wrote {args.config} — add your machines to it")

    # Every address it can actually be reached on, not just the one it was told to bind.
    # 0.0.0.0 is not somewhere you can type into a phone.
    # The scheme has to match what it will really answer on, or the printed link — and the QR
    # code made from it — sends a browser to a port that speaks the other protocol.
    scheme = "https" if cfg.tls() else "http"
    where = addresses() if host in ("", "0.0.0.0", "::") else [host]
    for address in where:
        url = f"{scheme}://{address}:{port}/?token={cfg.token}"
        print(f"  open    {url}")
        if args.qr:
            print()
            print_qr(url)
            print()
    if not args.qr:
        print("          (panoptes --qr prints a code to photograph)")
    if cfg.tls():
        print("          (serving https — a self-signed certificate will make the browser ask)")
    # Flushed explicitly: when the output is a log file rather than a terminal, the banner sits
    # in the buffer until the process exits — so the address you need is missing from the log
    # for exactly as long as the board is useful. Argus learned this the same way.
    print(flush=True)
    tls = cfg.tls()
    uvicorn.run(
        create_app(cfg),
        host=host or "127.0.0.1",
        port=int(port),
        log_level="warning",
        ssl_certfile=str(tls[0]) if tls else None,
        ssl_keyfile=str(tls[1]) if tls else None,
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
