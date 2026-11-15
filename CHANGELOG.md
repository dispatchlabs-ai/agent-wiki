# Changelog

## [Unreleased]

## [0.11.1] - 2026-11-15

### Fixed

- New native OAuth connections remain authorized until revoked. Access tokens still expire after five minutes; previously approved connections retain their original expiry.
- Concurrent refreshes and retries within 30 seconds converge on the same rotated credentials, including after a server restart. Older token reuse still revokes the connection. Retry responses are encrypted using the presented token; bearer secrets are never stored in plaintext.

## [0.11.0] - 2026-11-08

### Added

- `wiki.edit` makes targeted article changes by exact text, section or append without resubmitting the article or its metadata.
- `wiki.delete` removes an article and repairs links to it in the same commit, as plain text or to a named replacement. Git history stays readable.

### Security

- Exclude build-only npm and its bundled Undici from the installed Node runtime while retaining npm for asset compilation (package 0.10.4).
