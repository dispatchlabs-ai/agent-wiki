# Managed lifecycle

The managed lifecycle gives one Agent Wiki installation a stable data layout and
one cooperative filesystem owner across serving, administrative writes, backup,
restore, and interrupted-write recovery. It is the required entry point for the
packaged service. It supports local Linux and macOS filesystems. A mounted or
network filesystem, including S3 Files, needs a separate qualification proving
its lock and rename behavior before use.

The managed root contains only installation state:

| Path                          | Authority                                                   |
| ----------------------------- | ----------------------------------------------------------- |
| `content/`                    | Complete article Git repository, history, and edit receipts |
| `control/control.sqlite3`     | Identities, grants, credentials, sessions, and audit data   |
| `traces/`                     | Registered original trace evidence and derived indexes      |
| `article-media/`              | Deliberately published article assets and provenance        |
| `.lifecycle/initialized.json` | Versioned initialization commit marker                      |
| `.lifecycle/recovery/`        | Completed interrupted-write recovery receipts               |
| `.lifecycle/owner.lock`       | Stable kernel-lock inode; never delete or replace it        |

Search indexes outside those stores are disposable. Keep separate installations
in separate roots. Do not place engine files, another installation, or a backup
destination inside a managed root.

## Bootstrap an empty root

The packaged command is `agent-wiki`; a source checkout can use
`python3 scripts/lifecycle.py` with the same arguments:

```sh
agent-wiki bootstrap \
  --root /absolute/private/wiki-data \
  --origin https://wiki.example.org \
  --manager-email manager@example.org \
  --manager-name 'Initial manager'
```

Bootstrap accepts only an absent or empty root. It creates an empty `main` Git
history, the control store and the independent media store, plus a local trace
store unless `--external-evidence-url` selects external ownership. It then validates
Git and SQLite before atomically writing `initialized.json` last. Its JSON receipt
contains the content HEAD and a one-time setup URL. Treat that URL as a credential
and consume it through the configured HTTPS origin. A repeated bootstrap returns
`ALREADY_INITIALIZED`. A crash before the marker leaves `PARTIAL_STATE`; preserve
the files for diagnosis and restore or deliberately clean the exact failed root
offline. Bootstrap never guesses that partial data is disposable.

## Adopt existing content and identities offline

`adopt` brings an existing direct-storage installation under the managed fence
without copying, initializing, or replacing its content repository or control
database. Stop the direct server and every writer first, retain a reviewed recovery
copy, arrange the existing stores at `ROOT/content` and
`ROOT/control/control.sqlite3`, and run:

```sh
agent-wiki adopt \
  --root /absolute/private/wiki-data \
  --origin https://wiki.example.org
```

For an installation whose evidence is owned by a separate read-only service, make
that ownership explicit during adoption:

```sh
agent-wiki adopt \
  --root /absolute/private/wiki-data \
  --origin https://wiki.example.org \
  --external-evidence-url http://evidence.internal:8769/api/evidence/v1/
```

Adoption holds the same owner fence as serve and maintenance. It requires an
ordinary, clean, self-contained Git worktree with safe configuration and no
retained writer lock, verifies Git objects and the control database's principals
and manager grant, and writes `initialized.json` last. Existing content, Git
configuration, identities, grants, credentials and sessions are read but never
rewritten. Missing empty application-owned trace or article-media directories are
created as needed. An external-evidence adoption refuses a nonempty local trace
directory so evidence cannot silently fall outside recovery.

An interrupted attempt before the marker can be repeated after verifying that the
service stayed offline. A repeat with the same origin and evidence configuration
returns `already-adopted`; a different configuration is rejected. Existing
`content` and `control` directories may be bind-mounted subdirectories as long as
the managed root and mount layout are stable across every lifecycle command.
Filesystem validation still rejects symbolic links. Mount points do not prove that
an unmanaged writer is stopped, so the offline step remains an operator boundary.

## Serve and maintain one owner

Start the packaged server through the lifecycle command:

```sh
agent-wiki serve --root /absolute/private/wiki-data
```

The server uses the bootstrap/adoption origin unless `--origin` or `WIKI_ORIGIN` explicitly
overrides it. It binds `127.0.0.1` by default for a same-host HTTPS proxy. A
container can explicitly use `--bind 0.0.0.0`; the canonical origin and Host
checks still apply, and the application port should remain behind the selected
proxy/network boundary.

Run an offline product command while holding the same owner fence:

```sh
agent-wiki maintenance --root /absolute/private/wiki-data -- \
  agent-wiki-import-trace-direct /absolute/private/wiki-data/traces session.jsonl 'Session'
```

Stop the managed server first. The maintenance command exports `WIKI_REPO`,
`WIKI_CONTROL`, and `WIKI_ARTICLE_MEDIA` from the fixed root. A local-evidence
marker also exports `WIKI_TRACES`; an external-evidence marker instead exports its
normalized `WIKI_EVIDENCE_URL`. Ambient values cannot select both providers.
Account and agent administration, trace import/indexing, and media publication
belong behind this command in a managed installation.

The wrapper holds a POSIX advisory `flock` on the stable `owner.lock` inode. It
passes the open descriptor through the server, editor, and Git subprocesses, so
an orphaned writer retains ownership after its parent dies. Descendants verify
that descriptor 3 is the same regular inode as this root's `owner.lock`; an
environment variable alone is not accepted as proof. No process steals the lock
from a PID check or its age. `owner.json` is diagnostic and is not authority.

This is a cooperative local-operator boundary. A process with filesystem authority
can bypass it. The packaged `*-direct` commands and source commands remain
available for development and deliberate recovery, but before using one, stop
the managed owner and every other direct writer. A custom maintenance command
must run its writable children synchronously and preserve inherited file
descriptors. Do not delete `.lifecycle/owner.lock` during recovery.

`agent-wiki status --root ROOT` reports initialization, current content HEAD, a
retained edit lock, and whether the kernel fence is currently held. Its owner
metadata is explicitly labeled diagnostic.

## Create and restore a recovery copy

With the server stopped, create a copy at an independent local destination:

```sh
agent-wiki backup \
  --root /absolute/private/wiki-data \
  --destination /independent/private-backups/wiki-2026-09-21.tar.gz
```

The destination must be outside the managed root and must not already exist. The
command holds exclusive ownership, rejects a dirty content checkout or retained
edit lock, uses SQLite's backup API, and archives only the authoritative paths.
It creates the temporary and final archive as mode `0600`. The embedded manifest
records every regular file's SHA-256 digest, size and mode, the Git HEAD, control
integrity, manager count, and backup identity. The receipt reports the archive's
digest and size. Copying to another directory on the same disk is useful
validation but is not independent disaster recovery; choose a separately retained
destination according to the installation's recovery objective.

Restore only into a fresh root:

```sh
agent-wiki restore \
  --root /absolute/private/fresh-wiki-data \
  --archive /independent/private-backups/wiki-2026-09-21.tar.gz
```

Restore rejects absolute paths, traversal, duplicate members, links, special
files, unexpected paths, special mode bits, missing files, and metadata or digest
mismatches. It validates the complete archive before extracting, rejects unsafe
Git configuration before running Git in the restored repository, then verifies
Git, SQLite, identities and manager grants in private staging below the fresh
root's `.lifecycle` directory. Staging therefore needs write access only to the
mounted managed root, not its parent, and stays on the same filesystem as the
atomic store moves. It moves the validated stores into the fresh root, removes
staging and writes the initialized marker last. Verify the actual browser/API/MCP
read and write flows before accepting the recovery copy.
For local evidence, the archive contains traces together with password hashes,
sessions, credentials and private media. For external evidence, the manifest and
initialized marker record the provider URL and the archive deliberately omits
traces. Restore preserves that mode and URL; recover and verify the externally
owned evidence service through its own procedure before reopening the wiki. In
either mode, protect and retain the archive as private application data.

## Recover an interrupted article write

The application edit lock at `content/.git/wiki-write.lock.d` is durable crash
evidence. Managed server, maintenance, and backup startup fail closed while it is
present. After stopping every managed and direct writer, inspect Git HEAD,
operation receipts, and worktree changes. Preserve or reconcile any human change;
the lifecycle command never discards it automatically.

Create a recovery manifest outside the root:

```sh
agent-wiki inspect-recovery \
  --root /absolute/private/wiki-data \
  --output /absolute/private/recovery-review.json
```

The manifest binds the exact retained-lock tree, whether `owner.json` parsed, Git
HEAD, and the byte-exact worktree status. PID and timestamps remain diagnostic.
Review that file and the repository. Recovery accepts only a clean worktree and
the unchanged inspected facts:

```sh
agent-wiki recover \
  --root /absolute/private/wiki-data \
  --manifest /absolute/private/recovery-review.json
```

Any drift returns `RECOVERY_DRIFT`; inspect again after reconciling. A malformed
or unknown lock owner can be recovered through the same exact-evidence process.
On success, the command removes only `wiki-write.lock.d`, validates the store,
and persists a digest-bound receipt under `.lifecycle/recovery/`. Start one server
and exercise a new write after recovery.

## Upgrade, rollback, and recovery are different operations

An application upgrade replaces immutable program bytes while the data owner is
stopped. Read the target release's upgrade notes, take and retain a verified
backup when its risk warrants one, run any real documented state transition under
`maintenance`, then start the new binary. This lifecycle version introduces no
fake schema migration.

Binary rollback means starting an older compatible program against unchanged
state. It is safe only when that version supports every persisted format now in
the root; for example, old versions cannot read media first published in the
v0.8.7 directory format. Data recovery means restoring an earlier paired copy
into a fresh root and accepting the corresponding loss of later acknowledged
writes. Never describe one as the other, and never combine old binaries with a
newer unsupported data format to make a health check pass.
