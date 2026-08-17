<div align="center">

<img src="static/mark.svg" width="112" alt="Panoptes — nine eyes, one of them awake">

# Panoptes

**One page for every machine you run agents on: which are up, what is running on them, and
which one is waiting for you.**

![Six machines on one board: five working, one out of disk, one that has stopped calling in, and one asking for you](docs/img/board.png)

*Six machines, one screen. `vaporwave` is the one asking you something — it is at the top
and it is the only tile wearing the accent. `old-faithful` is at 96% on `/var/lib/archive`.
`shed` has stopped calling in. Clicking a session name opens that terminal, on that machine.*

[![python](https://img.shields.io/badge/python-3.11%2B-3776ab?logo=python&logoColor=white)](https://www.python.org/)
[![licence](https://img.shields.io/badge/licence-MIT-blue)](LICENSE)
[![no build step](https://img.shields.io/badge/build%20step-none-8fd6a0)](#running-it)
[![companion to argus](https://img.shields.io/badge/companion%20to-argus-8fd6a0)](https://github.com/andreaderuvo/argus)

</div>

## What it is for

[Argus](https://github.com/andreaderuvo/argus) puts a browser onto the tmux sessions on one
machine. The moment there are three machines, the question changes: not *what is this box
doing* but **which box needs me**.

Answering that by opening three tabs does not work, because the whole point is that you are
not looking. You want one page that is worth glancing at, that tells you the one thing you
cannot work out from anywhere else — an agent has stopped and is waiting for an answer — and
that gets you to the right terminal in one click when it does.

```bash
pip install -r requirements.txt
python3 -m app.main            # prints a URL with a token in it
python3 -m app.main --qr      # and a code to photograph
```

That is the board. Then tell it about your machines, or tell your machines about it — both
directions work, and [which one you want depends on your network](#how-a-machine-gets-onto-the-board).

> [!IMPORTANT]
> **Panoptes cannot get into anything.** It holds one read-only key per machine, never sends
> one to a browser, and has no shell, no filesystem and no terminal of its own. Clicking
> through to a machine opens that machine's Argus, in its own origin, with its own token.
> Losing this board loses a list of session names.

<div align="center"><sub><i>Argus Panoptes — "the all-seeing" — had a hundred eyes, and some
of them were always open.</i></sub></div>

## What a tile says

Everything on a tile is one glance's worth, ordered by how likely it is to be the reason you
looked:

| | |
|---|---|
| **Which one wants you** | The accent bar down the left edge, and that machine sorts to the top. It is the only thing that gets that bar — a machine's own colour never touches it. |
| **Sessions** | One chip each, with the window count. Green means it is asking you something; amber means it finished. Click one and you are in that terminal. |
| **Load, and the fullest disk** | Amber over 74%, red over 90%. Only the disk in the most trouble: a board wants to know there is a problem, not to inventory the filesystems. |
| **Two uptimes** | The machine's, and how long *this Argus* has been running. Three Argus instances on one box report the same machine uptime; the second number is the one that tells them apart. |
| **Its address, and a button to copy it** | Because the useful thing is often not "open it here" but the address itself, to paste into a terminal or send to somebody. |
| **A line of your own** | A note you write, kept per machine: what the box is for, what it was doing, why it looks like that. Everything else on the tile, the machine said. This is the part only you know. |

The footer counts what is actually there — `4 argus on 2 machines`, when three of them are on
one box.

<p align="center">
  <img src="docs/img/board-light.png" width="49%" alt="The same board in the light theme">
  <img src="docs/img/board-phone.png" width="24%" alt="The same board on a phone">
</p>

## How a machine gets onto the board

Two directions, and the network decides which one you can have.

### The board asks (pull)

Write the machine down and the board polls it. This is the better arrangement wherever it
works: a request that fails **is** the signal that a machine is down, and there is one file
that says what is being watched.

```yaml
# ~/.config/panoptes/config.yaml
listen: 0.0.0.0:8070
token: <the board's own token, generated on first run>

machines:
  - name: hetzner
    url: http://hetzner.internal:8090
    token: <a watcher token from that machine's Argus>
    # Where a *browser* should go, when that is not where this board asks.
    reach: http://hetzner.example.com:8090
    colour: 4                     # optional; otherwise from the name
    note: the one paying rent     # optional; a reader can write over it
```

On the Argus side, a **watcher** token is a key that opens `GET /api/overview` and nothing
else — no shell, no files, no writes, no proxy:

```yaml
# ~/.config/argus/config.yaml, on each machine
watchers:
  - name: panoptes
    token: <16+ characters, not the same as the main token>
```

### The machine calls in (push)

Some networks only go one way. Measured on the pair this was written for: two boxes on the
same wire, same /25, each with the other's MAC in its ARP table, and one of them refusing
everything inbound. A board on the reachable side will never poll the other, and no amount
of configuration on the board changes that.

So the machine opens the connection instead, in the direction that already works:

```yaml
# panoptes config: allow it
registration_token: <16+ characters, different from the board's token>
forget_after: 45          # seconds of silence before it stops being believed
```

```yaml
# argus config, on the machine that cannot be reached
report_to:
  url: http://board.internal:8070
  token: <the registration token>
  name: gpu2                        # what you want it called on the board
  reach: http://gpu2.internal:8090  # where a browser should go
  every: 10
```

What it sends is what `GET /api/overview` returns and nothing else: hostname, uptime, load,
memory, the fullest disk, and the session names with which of them is ringing. No file, no
path, no token, no command. Off unless configured.

This is not a workaround anybody invented here — it is what Prometheus does in agent mode,
and what every dial-out agent does: Tailscale, Cloudflare Tunnel, Teleport, the kubelet
registering with its API server. **Local pull, remote push.**

Three rules keep it honest:

- **Announcing and looking are different keys.** The registration token cannot read the
  board; the board's token cannot invent machines.
- **The list you wrote by hand wins.** A machine announcing a name you have configured is
  refused, so nothing holding the registration key can quietly replace a real machine with
  one of its own.
- **Silence is the only signal there is.** No request fails when nobody is asking, so a
  machine that stops calling in goes cold after `forget_after` rather than staying green
  for ever.

## Colours, tints and notes

A machine's colour comes from its name, hashed into Argus's palette — no configuration, and
the same colour on every device you open the board from. That is a good default and a bad
only-option: on a four-machine board here, two names landed on the same step.

So there are three answers, most personal first:

1. **A colour you picked**, in this browser — the ⋯ on any tile.
2. **A colour in the config**, the same for everyone who opens the board.
3. **The hash of the name**, which is what an unconfigured board shows.

The same ⋯ sets how strongly that colour tints the tile — five steps, kept as a multiplier
so it means the same thing in both themes — and holds the note.

## What it is not

- **Not a way in.** There is no terminal, no file browser and no command here. If you want
  those, that is [Argus](https://github.com/andreaderuvo/argus), on the machine itself.
- **Not a monitoring system.** No history, no graphs, no alert rules, nothing on disk. It
  says what is true now. If you need a year of metrics you want Prometheus, and the two are
  not in competition — this one exists to be glanced at.
- **Not a scheduler.** It starts nothing, stops nothing, and has no opinion about what
  should be running.
- **Not multi-user.** One token, one board, one person's machines.

## Running it

Python 3.11 or newer, three dependencies, no build step, no database.

```bash
git clone https://github.com/andreaderuvo/panoptes
cd panoptes
pip install -r requirements.txt
python3 -m app.main
```

The first run writes `~/.config/panoptes/config.yaml` with a fresh random token, at mode
600, and prints the URL to open. Add your machines to it and restart.

```
  panoptes 0.0.1 · 3 machine(s) · accepts announcements

  open    http://127.0.0.1:8070/?token=…
          (panoptes --qr prints a code to photograph)
```

Useful flags:

| | |
|---|---|
| `--config PATH` | somewhere other than the default |
| `--listen HOST:PORT` | default `127.0.0.1:8070` |
| `--qr` | print the URL as a QR code too, one per address it answers on |

To keep it running, a user unit is enough — and `loginctl enable-linger` so it survives your
logging out:

```ini
# ~/.config/systemd/user/panoptes.service
[Unit]
Description=Panoptes
[Service]
ExecStart=/usr/bin/python3 -m app.main
WorkingDirectory=%h/panoptes
Restart=on-failure
[Install]
WantedBy=default.target
```

```bash
systemctl --user enable --now panoptes
sudo loginctl enable-linger "$USER"
```

### Seeing it without any machines

There is a demo board that invents six of them, so you can look at the thing before wiring
anything up. It is also where every picture in this README comes from — a screenshot of a
real board publishes hostnames, ports and session names, and a made-up one stays identical
between releases, so a retaken picture shows the change and nothing else.

```bash
python3 scripts/demo.py        # a board on 127.0.0.1:8770, six machines that do not exist
```

## Security

The design is one idea: **the board is not a way in.**

- **It never sends a machine's token to a browser.** The page is told where a machine is,
  never how to get into it. There is a test whose only job is to fail if that ever changes.
- **The keys it holds are weak on purpose.** A watcher token opens one read-only endpoint on
  one machine. Losing the board's config loses a list of session names.
- **Its own token is compared in constant time**, and it is taken out of the address bar on
  arrival so it is not left in the history of every phone that has opened the board.
- **`Referrer-Policy: no-referrer`**, so clicking through to a machine does not tell it where
  you came from.
- **Two keys, two doors.** Announcing cannot read; reading cannot announce.
- **It refuses to start** with an empty or short token, with a watcher token that equals the
  main one, or with a registration token that equals the board's.

What it does **not** protect you from: this is plain HTTP by default, and the board still
lists every machine you own. Put it on a LAN, behind a VPN, or reach it through an SSH
tunnel:

```bash
ssh -N -L 8070:127.0.0.1:8070 you@board
```

## Development

```bash
pip install -r requirements.txt
python -m pytest -q
```

No build step and no bundler: the frontend is three files in `static/`, served as they are.

## Licence

MIT — see [LICENSE](LICENSE).

---

<div align="center">

**[Argus](https://github.com/andreaderuvo/argus)** — the same idea for one machine: tmux
sessions, files and documents in a browser.
**Panoptes** is what you open when there are several.

</div>
