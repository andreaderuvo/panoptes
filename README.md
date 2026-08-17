<div align="center">

# Panoptes

**One board over several machines running [Argus](https://github.com/andreaderuvo/argus).**

*Which box has an agent waiting for you, and one click to go there.*

</div>

Argus gives you the tmux sessions on one machine. Once there are three or four machines,
the question changes: not *what is this box doing* but *which box wants me*. Panoptes
answers that one, and nothing else.

It shows every machine, the sessions on it, which of them has finished or is asking you
something, the load, and the disk in the most trouble. Machines with something waiting sort
to the top. Click a session and you land on that machine's own Argus.

## What it deliberately does not do

**It does not proxy anything.** Clicking through opens that Argus directly, in its own
origin, with the token your browser already keeps for it. The terminal never travels
through here, so there is no extra hop and no extra latency.

**It never holds a key worth stealing.** Argus can issue a *watcher* token that opens one
read-only door — `GET /api/overview` — and nothing else: no shell, no files, no writes.
Those are the only tokens on this box, they live server-side, and they are never sent to a
browser. Lose this machine and you have lost a list of session names.

**Argus does not depend on it.** Turn Panoptes off and every machine carries on exactly as
before. This is a convenience for people with several boxes, not a component.

## Running it

On each machine, in the Argus config:

```yaml
watchers:
  - name: panoptes
    token: <at least 16 characters, and not your real one>
```

Then here:

```bash
pip install -r requirements.txt
python3 -m app.main            # writes a config on first run, prints a URL with a token
```

```yaml
listen: 127.0.0.1:8070
token: <this board's own token>
every: 5                       # seconds between sweeps
timeout: 3                     # how long any one machine may take
machines:
  - name: hetzner
    url: https://hetzner.example:8090
    token: <that machine's watcher token>
  - name: lab-gpu
    url: http://10.0.0.7:8090
    token: <that machine's watcher token>
```

The name is yours, not the machine's: you called it `lab-gpu` for a reason, and two boxes
can answer to the same hostname. What it calls itself is shown beside it.

`reach` is where a **browser** should go, and it matters more than it looks. A board beside
an Argus polls it over loopback, which on a card would send the reader to their own laptop.
And a browser keeps its keys per origin: `http://box:8090` and `http://10.0.0.7:8090` are
two different places to it, so a link to the address you never use will ask for a token you
have already given. Put the one you actually type.

## Notes

- One sweep serves every open tab. Ten browsers do not mean ten times the questions.
- A machine that stops answering keeps what it last said, with *when*, because the useful
  fact about a box that dropped off is what it was running when it did.
- The same warning as Argus: this page says what is running on every machine you own. It
  wants its own token, and it belongs on a LAN or behind a VPN.

MIT.
