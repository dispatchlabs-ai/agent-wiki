# Public source release

Historical snapshot: published September 9, 2026 with explicit owner authorization.
The policies below describe that date, not current operations.
See [current release policy](releases.md) for maintainer pushes and local CI.

- Repository: https://github.com/dispatchlabs-ai/agent-wiki
- Source alpha: https://github.com/dispatchlabs-ai/agent-wiki/releases/tag/v0.1.0-alpha.1
- Public root: `3206ddfdb2fe42ab53ee19b9cdfd2d1c395624c4`
- Annotated tag: `f57e12a6ebe5efeaf071835e914af2545e004a61`
- CI: https://github.com/dispatchlabs-ai/agent-wiki/actions/runs/34395019505

Anonymous repository and release reads succeeded. Hosted CI passed all 22 tests,
formatting, installation, and the production dependency audit. Hosted logs were
inspected for private identifiers. The tag's SSH signature was verified against
the maintainer's public key.

Main requires one approving review and the check job, with administrator enforcement,
linear history, no force pushes, and no deletion. Version tags cannot be updated or
deleted. Actions use a read-only token and cannot approve pull requests. Secret
scanning, push protection, vulnerability alerts, and private vulnerability reporting
are enabled. Organization-wide account recovery and 2FA policies were not changed.

The original engineering history remains on the existing private origin. The public
repository has an independent parentless history. Do not push the private main
branch or mirror private refs into GitHub; make public changes through reviewed
pull requests based on the public main branch. No npm package, container, or binary
was published. The source alpha makes no stable compatibility or production-support
promise.
