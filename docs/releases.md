# Versioning and releases

Agentic Wiki follows [Semantic Versioning 2.0.0](https://semver.org/).
The public contract covers the documented HTTP, MCP and WebMCP APIs, CLI commands,
configuration, article format, and persisted trace and edit-receipt formats.
Internal modules and disposable indexes/caches are not public APIs. Raising the
minimum runtime or dropping a supported platform is a breaking change.

## Choosing a version

During initial development (`0.y.z`), this project uses patch bumps for compatible
fixes and additions, and minor bumps for breaking changes (resetting patch to zero).
This is our explicit pre-1.0 convention; SemVer does not promise a stable API for
major version zero. Document migrations for every breaking change.

From `1.0.0`, use patch for compatible fixes, minor for compatible features or
deprecations, and major for breaking changes. Reset lower components when bumping.
Use `-alpha.N`, `-beta.N`, or `-rc.N` only for deliberate previews of an upcoming
version. A normal `0.y.z` release remains initial-development software.

`0.1.0` completes the earlier `0.1.0-alpha.1` preview with the accumulated fixes
and additions. It does not imply production readiness.

## Publishing a release

1. Work from public `main`; never merge private engineering history into it.
   Maintainer changes can push directly to `main`; outside contributors use PRs.
2. Describe changes since the previous release in `CHANGELOG.md`, including
   compatibility and migration notes. Update `package.json`, both root version
   fields in `package-lock.json`, and the README status together.
3. Run `npm ci`, `npm run check`, `npm run test:browser`, and
   `npm audit --omit=dev --audit-level=high` using synthetic data. Review the diff
   and public source archive for unintended content. Keep dependencies locked.
4. Commit and push; wait for the Linux/macOS runtime matrix and browser CI to pass
   on that exact commit before tagging. Linux checks run through the Palm-managed
   local runner, not GitHub Actions; run the same `scripts/check` gate on macOS
   and record the exact SHA and result. Do not treat a queued CI run as a pass.
5. Create an SSH-signed annotated `vX.Y.Z` tag on that commit, verify its signature,
   and push only that tag. Publish matching GitHub release notes from the changelog.
   Mark preview versions as GitHub prereleases; normal versions are regular releases.
6. Verify the remote tag, release version, target commit, and publication status.
   Report the release link and check results. A push to `main` alone is not a release.

Released tags and artifacts are immutable. Correct a released defect in a new
version; never move or replace a published tag. Several related commits may form
one release. Completed user-visible work must not silently remain unversioned.
Source releases do not authorize npm publication or deployment of running instances.

## Verify a downloaded release

The public key used for v0.2.2 is checked in as
[`release-signing-key.pub`](release-signing-key.pub). Its SHA-256 fingerprint is:

```text
SHA256:1Np/3VtW8SH6zILX+qft4EhOs5KnErjy0+RFr2zXrfQ
```

Confirm the fingerprint through an independently trusted maintainer channel before
trusting it for the first time. A key downloaded alongside a tag establishes
signature consistency, not independent proof of the maintainer's identity.

From a Git checkout, with OpenSSH tools and Git supporting SSH signatures:

```sh
git fetch origin tag v0.2.2
ssh-keygen -lf docs/release-signing-key.pub
mkdir -p .runtime
awk '{print "chrisbyboston@gmail.com " $0}' docs/release-signing-key.pub > .runtime/allowed-signers
git -c gpg.ssh.allowedSignersFile=.runtime/allowed-signers verify-tag v0.2.2
git rev-parse 'v0.2.2^{}'
```

Expect a good signature with that fingerprint and target commit
`fc841ef7724d2a400a40bb8607a289db89d1e963`. These instructions and the key file
were added after v0.2.2; keep them available when verifying the older tag. A GitHub
source ZIP does not include Git objects needed by `verify-tag`; use a Git checkout
for this verification.

On September 11, 2026, local verification succeeded but GitHub's tag API reported
`verified: false` with `reason: unknown_key`. The signature exists; the key was not
recognized by GitHub. Registering the public key as an **SSH signing key** on the
maintainer's GitHub account is a separate account operation. It must not require
replacing or moving the released tag. See GitHub's
[SSH key registration instructions](https://docs.github.com/en/authentication/connecting-to-github-with-ssh/adding-a-new-ssh-key-to-your-github-account).

Before future releases, verify both the local signature and GitHub's recognition
of the key. If GitHub still reports the key as unknown, report that limitation
instead of describing the tag as GitHub-verified. Announce future key changes with
the new fingerprint and preserve prior public keys for historical verification.
