# Changelog

## [Unreleased]

### Added

- `wiki.edit` makes targeted article changes by exact text, section or append without resubmitting the article or its metadata.
- `wiki.delete` removes an article and repairs links to it in the same commit, as plain text or to a named replacement. Git history stays readable.

### Security

- Exclude build-only npm and its bundled Undici from the installed Node runtime while retaining npm for asset compilation (package 0.10.4).
