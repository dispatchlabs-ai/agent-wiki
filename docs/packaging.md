# Portable packages

Agent Wiki has one locked Nix definition for an `aarch64-darwin` host package,
an `x86_64-linux` host package, and an `x86_64-linux` container image. These are
independent release surfaces. Only exact-revision receipts establish acceptance;
existing deployments change only through their separately authorized upgrade.

The host package is a Nix store package and **requires Nix on the destination**.
It is not a relocatable native archive. The Linux container archive contains its
complete runtime closure and does not require Nix in the running container.

## Locked runtime

`flake.lock` pins the August 21, 2026 NixOS 26.05 channel revision. That revision
supplies Node 24.19.0, matching the repository's tested runtime baseline and using
the channel's published binary-cache artifacts where available. `package-lock.json`
supplies the exact JavaScript dependency graph through Nixpkgs' `importNpmLock`;
there is no placeholder dependency hash and the build performs no unlocked npm resolution.
The package builds the browser assets, prunes development dependencies, and keeps:

- Node, Git, production JavaScript dependencies, and built browser assets;
- the server, authenticated CLI, bootstrap, account and agent administration,
  trace import/indexing, and article-media publication commands;
- operator documentation, the license, and third-party notices.

Run `agent-wiki-package-info` from the result to read its version, source revision,
Nixpkgs revision, Node version, target system, package-lock SHA-256, and executable
inventory. Container labels repeat the release version and source revision. A
release builder must build from the exact clean signed-tag commit so the revision
is immutable; `uncommitted` or a `-dirty` revision is not releasable.

The package contains no content repository, control database, identities, trace
archive, article-media store, credentials, or client configuration. Keep those in
operator-owned mutable paths. The image also contains no default customer data or
secrets and runs as numeric user/group `65532:65532` with `/tmp` as its home.

## Build and inspect

Nix flakes and the `nix-command` interface are currently experimental upstream.
The qualified build and consumer prerequisite is Nix 2.35.2; enable both
features for these commands:

```sh
nix --extra-experimental-features 'nix-command flakes' flake check
nix --extra-experimental-features 'nix-command flakes' build .#agent-wiki
./result/bin/agent-wiki-package-info | jq .
./result/bin/agent-wiki-cli --help
./result/bin/agent-wiki --help
```

`agent-wiki` and `agent-wiki-lifecycle` are equivalent managed entry points. Use
them for bootstrap, serve, maintenance, backup, restore, and recovery operations:

```sh
agent-wiki bootstrap --root /srv/agent-wiki \
  --origin https://wiki.example.test \
  --manager-email manager@example.test \
  --manager-name 'Wiki Manager'
agent-wiki serve --root /srv/agent-wiki
```

Build the container archive on the native `x86_64-linux` builder:

```sh
nix --extra-experimental-features 'nix-command flakes' build .#oci
docker load < result
docker image inspect agent-wiki:VERSION-SOURCE
```

Managed Linux CI runs the same public repository check after the ordinary source
checks:

```sh
./scripts/check
./scripts/check-package
```

`check-package` requires native `x86_64-linux`, Nix and a clean Git checkout. It
runs the locked flake checks, builds the host and OCI outputs without publishing,
checks that package identity names the exact Git revision, and prints bounded
store paths, sizes and identity metadata.

The container entry point is the managed `agent-wiki` lifecycle. Its default command
is `serve --root /data`, and the image explicitly binds the server to `0.0.0.0`.
Bootstrap an empty named volume once before starting the long-running container:

```sh
docker volume create agent-wiki-data
docker run --rm -v agent-wiki-data:/data agent-wiki:VERSION-SOURCE \
  bootstrap --root /data --origin https://wiki.example.test \
  --manager-email manager@example.test --manager-name 'Wiki Manager'
docker run -d --name agent-wiki -p 4317:4317 \
  -v agent-wiki-data:/data agent-wiki:VERSION-SOURCE
```

The lifecycle creates and exports this mutable layout:

```text
/data/content                 WIKI_REPO
/data/control/control.sqlite3 WIKI_CONTROL
/data/search/wiki.sqlite3     WIKI_DATABASE
/data/traces                  WIKI_TRACES (optional)
/data/article-media           WIKI_ARTICLE_MEDIA (optional)
```

The direct entry points expose existing application operations and bypass the
managed writer fence. Managed activation, bootstrap, maintenance, backup, and
recovery must go through `agent-wiki`. Direct commands remain useful for development
and an already fenced operator session, and their `-direct` suffix makes that
authority boundary visible.

## Signed host closure candidate

The pilot uses an ordinary Nix closure export as the complete host artifact. It
can be attached to a GitHub release beside its JSON manifest and signature without
introducing a shared binary-cache service:

```sh
nix develop .#packaging -c ./scripts/package-closure ./dist /path/to/ssh-private-key
```

The script builds the native package, exports every referenced store path, records
the package identity, archive SHA-256, store path, closure count and sizes, then
SSH-signs that manifest in the `agent-wiki-release` namespace. The existing public
release key can verify the signature when the corresponding private key is used.
This is an SSH signature over the artifact manifest, not a Nix binary-cache
signature; do not configure consumers as trusted Nix substituters for it.

A clean Nix-enabled consumer downloads all four candidate files (`.nix-closure.gz`,
`.manifest.json`, `.manifest.json.sig`, and the repository public signing key),
creates an allowed-signers file with the independently verified release key, and
runs the verifier from the reviewed release checkout. The verifier needs `jq`,
`gzip` and an OpenSSH `ssh-keygen` that supports SSH signatures, in addition to
Nix. The locked packaging shell supplies these verification tools without
building the application or changing the consumer's profile:

```sh
nix --extra-experimental-features 'nix-command flakes' \
  develop --no-update-lock-file .#packaging --command \
  ./scripts/verify-package-closure \
  agent-wiki-VERSION-SYSTEM-SOURCE.manifest.json \
  agent-wiki-VERSION-SYSTEM-SOURCE.nix-closure.gz \
  ./allowed-signers maintainer@example.invalid --sudo-import --install
```

Use a private `TMPDIR` on a filesystem with room for the uncompressed closure;
the archive and expanded import staging coexist. A minimal Nix installation does
not imply `jq` is already available. The verifier refuses missing prerequisites
before importing; do not substitute partial manual checks for this command.

Verification checks the SSH signature, manifest schema, archive name and SHA-256,
using one private archive copy, then asks `sudo` to copy it into a root-owned staging
directory, verify its digest again, and import it without rebuilding the application.
The privileged process never runs the imported Wiki executable; identity comparison
and the CLI smoke check run afterward as the ordinary caller. A single-user Nix
installation can omit `--sudo-import`. Multi-user Nix rejects this legacy closure
export for an untrusted caller because the Nix export format does not preserve an
SSH manifest signature as a native Nix store signature. Do not grant the Wiki
service user Nix `trusted-users` authority or disable signature checks to bypass
that boundary. Publishing and retention of these assets remain a release action;
these scripts do not publish anything.

## Qualification matrix

The initial pilot artifact identifies source `ca4df1c9a11e77d692a7d37f7c8e535e8ba4e6fa`.
It is evidence for the packaging approach, not a substitute for checking each new
release's exact revision and signature.

| Surface                        | Pilot evidence                                                                                                                                                    | Boundary                                                                                                                                                      |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| macOS Apple Silicon            | Native build; installed browser/MCP reads and writes, identities, media, traces, restart, fresh-root restore and interrupted-writer recovery                      | Nix required; process mode only                                                                                                                               |
| Linux x86-64                   | Same full installed-package journey; native host and container builds                                                                                             | Nix required for host; process mode only                                                                                                                      |
| Linux x86-64 container         | Clean-volume bootstrap, health, non-root execution, writer exclusion and cleanup                                                                                  | No Nix at runtime; ECS/S3 Files qualification is separate                                                                                                     |
| Ubuntu 24.04 x86-64 under WSL2 | Retrieved matching closure into previously empty application store; verified manifest; bootstrap, health, fencing and process restart with persisted content HEAD | Initial missing jq fixed by locked verifier shell; formal verification was repeated on warm store. Browser/full recovery and unattended restart not qualified |

The WSL test VM unexpectedly stopped during qualification. The cause was not
established; restarting the same preserved VM and completing process checks does
not prove service startup, WSL restart or Windows reboot behavior. Do not advertise
unattended WSL operation from this evidence.

The full package runner's backup and fresh roots share one temporary filesystem.
It proves application continuity, not independently retained disaster recovery.
Operators must retain authenticated backup bytes in a separate failure domain,
protect control identities and evidence, and test their actual recovery destination.

## Upgrade and retention

Stop the sole managed server before changing its package. Run managed status and
retain an offline consistent backup outside the service's failure domain. Activate
the new immutable executable against the same managed root, verify health and an
authorized write, then record its exact identity and the backup digest. The writer
fence refuses overlapping managed owners. Existing unmanaged installations need
an explicit adoption procedure; installing a package does not move their data.

Version 0.8.8 adds lifecycle operations without an application schema migration.
Switching an executable back is binary rollback only. When data has changed in a
way an older binary cannot read, restore the selected trusted backup into a fresh
root and verify it before activation. The backup's internal manifest detects
inconsistency; it does not establish the archive's external authenticity.

Retain signed release manifests, signatures, host closures and image digests while
any installation or recovery plan references them. Customer-owned environments
may mirror the same immutable assets and public verification key; downloading a
mirror must not replace signature/digest verification. Package signing and promotion
are separate from credential-free CI, and neither activates a running service.
