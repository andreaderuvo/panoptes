<div align="center">

<img src="static/mark.svg" width="104" alt="Panoptes — nine eyes, one awake">

# Argus Fleet

### Powered by Panoptes

**One board for every machine running your AI agents: what is working, what is unhealthy,
and which agent is waiting for you.**

[Argus](https://github.com/andreaderuvo/argus) gives one machine a workspace around its tmux
sessions. Panoptes is the fleet view that tells you which machine deserves your attention and
opens the right Argus in one click.

![Six machines on one board, reordered when an agent asks for help](docs/img/board.gif)

[![tests](https://github.com/andreaderuvo/panoptes/actions/workflows/tests.yml/badge.svg)](https://github.com/andreaderuvo/panoptes/actions/workflows/tests.yml)
[![install](https://github.com/andreaderuvo/panoptes/actions/workflows/install.yml/badge.svg)](https://github.com/andreaderuvo/panoptes/actions/workflows/install.yml)
[![Python 3.11+](https://img.shields.io/badge/python-3.11%2B-3776ab?logo=python&logoColor=white)](https://www.python.org/)
[![MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

**[See the product tour](https://andreaderuvo.github.io/panoptes/)** ·
**[Install](#install)** · **[Documentation](https://github.com/andreaderuvo/panoptes/wiki)**

</div>

## What the board answers

- Which machines are online, late or unreachable?
- Which sessions and agents are running on each?
- Which agent finished, failed or needs a person?
- Is a machine under load or running out of disk?
- Which pre-approved service may be started or stopped?

Tiles move by urgency, so a machine waiting for an answer rises above machines still working.
Colours and notes make a real fleet recognizable at a glance. The board has no terminal, file
browser or general command endpoint; those stay on the individual Argus machines.

## Install

Panoptes needs Python 3.11+ and runs on Linux, macOS and Windows. It does not need tmux.

```bash
curl -fsSLO https://raw.githubusercontent.com/andreaderuvo/panoptes/master/install.sh
less install.sh
bash install.sh
panoptes
```

Or run from source:

```bash
git clone https://github.com/andreaderuvo/panoptes.git
cd panoptes
python3 -m venv .venv
. .venv/bin/activate
pip install -r requirements.txt
python -m app.main
```

The first run creates `~/.config/panoptes/config.yaml`, prints a tokenized URL and shows a
demo board until a machine is configured. Add `--qr` to open it on a phone. Docker Compose is
also included; unlike Argus, the fleet board fits naturally in a container because it never
touches host tmux or files.

Connect machines by polling them from the board, or let machines announce themselves when
the network only opens in that direction. The
[machine guide](https://github.com/andreaderuvo/panoptes/wiki/Machines-on-the-board) covers
both arrangements.

## Deliberately limited authority

> [!IMPORTANT]
> Panoptes is a view over the fleet, not a gateway into it. It holds one restricted watcher
> key per Argus machine and never sends those keys to a browser.

A watcher key normally opens only the Argus overview endpoint. Optional start and stop
actions can name only commands pre-approved on that machine; arbitrary commands never cross
the board. The board token reads the board but cannot register machines, while the separate
registration token can announce a machine but cannot read the board.

Keep Panoptes on loopback, a trusted network, behind a VPN or an SSH tunnel. Read the
[security model](https://github.com/andreaderuvo/panoptes/wiki/Security) and
[vulnerability policy](SECURITY.md) before exposing it elsewhere.

## Project status

Panoptes is the optional fleet component of Argus and remains pre-1.0. Use Argus alone for a
single machine; add this board when multiple Argus tabs stop scaling.

- [Documentation](https://github.com/andreaderuvo/panoptes/wiki)
- [Changelog](CHANGELOG.md)
- [OpenAPI reference](https://andreaderuvo.github.io/panoptes/api.html)
- [Report a bug](https://github.com/andreaderuvo/panoptes/issues/new?template=bug_report.yml)
- [Contribute](CONTRIBUTING.md)

If the fleet view improves your workflow, star the main
[Argus repository](https://github.com/andreaderuvo/argus). Feedback and reproducible bug
reports are even more useful.

## License

MIT.
