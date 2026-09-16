# Versioning and releases

Agent Wiki follows [Semantic Versioning 2.0.0](https://semver.org/).
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
   on that exact commit before tagging. Linux checks run through the maintainer-managed
   local runner, not GitHub Actions; run the same `scripts/check` gate on macOS
   and record the exact SHA and result. Do not treat a queued CI run as a pass.
5. Create an SSH-signed annotated `vX.Y.Z` tag on that commit, verify its signature,
   and push only that tag. Publish matching GitHub release notes from the changelog.
   Mark preview versions as GitHub prereleases; normal versions are regular releases.
6. Verify the remote tag, release version, target commit, and publication status.
   Report the release link and check results. A push to `main` alone is not a release.

Except for the explicitly authorized 0.5.0 public-history reset, released tags and artifacts are immutable. Correct a released defect in a new
version; never move or replace a published tag. Several related commits may form
one release. Completed user-visible work must not silently remain unversioned.
Source releases do not authorize npm publication or deployment of running instances.

## Verify a downloaded release

The public signing key is [release-signing-key.pub](release-signing-key.pub).
Confirm its fingerprint through an independently trusted maintainer channel.
Use a Git checkout to verify the signed release tag:

```sh
git fetch origin tag v0.5.0
ssh-keygen -lf docs/release-signing-key.pub
mkdir -p .runtime
awk '{print "maintainer@example.invalid " $0}' docs/release-signing-key.pub > .runtime/allowed-signers
git -c gpg.ssh.allowedSignersFile=.runtime/allowed-signers verify-tag v0.5.0
git rev-parse 'v0.5.0^{}'
```

The allowed-signers identity above is a local verification label, not a contact
address. Compare the resolved commit with the release notes. Local signature
verification and GitHub's recognition of a signing key are separate checks.

## Public history reset

Version 0.5.0 replaces the old public history. Earlier release references in the
changelog describe historical changes; their retired tags are no longer fetched.
See [upgrading](upgrading.md) before updating an old checkout. The persisted local
identity issuer remains unchanged so existing accounts and grants are preserved.
