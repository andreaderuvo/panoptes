# Changelog

Panoptes is the fleet component of Argus. Versions follow Semantic Versioning while the
public interfaces remain pre-1.0.

## [Unreleased]

Nothing yet.

## [0.1.0] — 2026-09-08

### Added

- Pull and announcement modes for networks that open in either direction.
- Urgency ordering for machines with agents asking, failed or finished.
- Machine health, session state, orchestration summaries, colours and notes.
- Restricted, pre-approved start and stop actions without an arbitrary command endpoint.
- A journal and remembered announcements without a database.
- Python wheel and source packages, release checksums and a multi-architecture GHCR image.
- Security and contribution policies, issue forms and dependency updates.

### Changed

- The product is now presented as **Argus Fleet, powered by Panoptes**, concentrating adoption
  and stars on the main Argus repository.
- The installer follows releases, can pin a version and verifies packaged assets.
- Python package namespaces no longer collide with Argus when both are installed together.

[Unreleased]: https://github.com/andreaderuvo/panoptes/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/andreaderuvo/panoptes/releases/tag/v0.1.0
