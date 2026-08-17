"""The config file: what it accepts, and what it refuses to start with.

A board that starts having quietly ignored something is worse than one that will not start:
the first is a wrong belief you carry around, the second is a message you read once.
"""

from __future__ import annotations

import pytest

from app.config import Config, ConfigError

# ------------------------------------------------------------------------------- TLS

def test_a_certificate_is_optional_and_taken_when_given(tmp_path):
    """Argus takes the same two keys, and this board should not be the reason a fleet ends up
    half encrypted. Never required: on a LAN the address is a hostname or a private IP and no
    public CA will sign either, so demanding it would turn a thirty-second setup into a
    certificate project."""
    cert, key = tmp_path / "c.pem", tmp_path / "k.pem"
    cert.write_text("x")
    key.write_text("y")

    plain = Config.from_dict({"token": "a" * 32})
    plain.validate()
    assert plain.tls() is None

    secured = Config.from_dict({"token": "a" * 32, "tls_cert": str(cert), "tls_key": str(key)})
    secured.validate()
    assert secured.tls() == (cert, key)


def test_half_a_certificate_is_refused(tmp_path):
    """The worst of the three states: it would serve plain HTTP while its owner believed
    otherwise."""
    cert = tmp_path / "c.pem"
    cert.write_text("x")
    for half in ({"tls_cert": str(cert)}, {"tls_key": str(cert)}):
        with pytest.raises(ConfigError):
            Config.from_dict({"token": "a" * 32, **half}).validate()


def test_a_certificate_that_is_not_there_is_refused(tmp_path):
    with pytest.raises(ConfigError):
        Config.from_dict({
            "token": "a" * 32,
            "tls_cert": str(tmp_path / "missing.pem"),
            "tls_key": str(tmp_path / "missing.key"),
        }).validate()
