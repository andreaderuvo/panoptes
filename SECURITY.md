# Security policy

Panoptes holds a restricted watcher key for every Argus machine it displays. It is designed
not to turn those keys into shell or file access, but it still publishes useful reconnaissance
about a fleet. Please report vulnerabilities privately through GitHub's **Report a
vulnerability** button rather than opening a public issue.

Only the latest release and current `master` branch receive security fixes. Include the
affected version, topology, reproduction steps and expected impact. You should receive an
acknowledgement within 72 hours.

Panoptes binds to loopback by default. Keep it behind a trusted network, VPN or SSH tunnel;
use TLS whenever it crosses an untrusted network. Machine watcher keys remain on the server
and must never be sent to the browser. The board token cannot register a machine, and the
registration token cannot read the board.

See the [full security model](https://github.com/andreaderuvo/panoptes/wiki/Security).
