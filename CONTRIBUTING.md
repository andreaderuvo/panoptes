# Contributing to Argus Fleet (Panoptes)

Panoptes is the fleet view for Argus. Bug reports, support for unusual network topologies and
small improvements to glanceability are welcome.

Participation in this project is governed by the [Code of Conduct](CODE_OF_CONDUCT.md).

```bash
git clone https://github.com/andreaderuvo/panoptes.git
cd panoptes
python3 -m venv .venv
. .venv/bin/activate
pip install -r requirements.txt
python -m pytest -q
python -m app.main
```

Open an issue before a substantial change. Keep watcher keys on the server, preserve the
separation between board and registration tokens, and use private vulnerability reporting
for security problems. Pull requests should explain the problem, list verification performed
and include a screenshot for visible changes.

Contributions are licensed under the MIT License.
