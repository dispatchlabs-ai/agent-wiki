# Immutable package qualification

`scripts/qualify-package.mjs` is an opt-in acceptance runner for an existing
immutable Agent Wiki package. It does not build the application and does not
import application modules from a source checkout. Every application operation
uses an executable from the supplied package root. The runner itself uses the
repository's Playwright development dependency as an external verification
dependency.

Run it with an absolute immutable package output and a new private receipt path:

```sh
node scripts/qualify-package.mjs \
  --package-root /nix/store/...-agent-wiki-0.8.7 \
  --receipt /absolute/private/path/package-qualification.json
```

To qualify a Wiki-only binary upgrade, add `--upgrade-from /nix/store/OLD-PACKAGE`.
Both roots must be immutable, have matching target systems and distinct source
revisions. The old executable performs bootstrap and the initial browser/MCP
journey. The runner then stops that owner and activates the new executable on the
same root, verifies session/content continuity, and completes restore/recovery and
authenticated writes with the new package. The receipt identifies both artifacts
and measures stop-to-health time. No House or Dispatch runtime is involved.

The host needs Node 24.19 or newer, OpenSSL, and a Playwright Chromium
installation. Install Chromium separately with `npx playwright install chromium`
when the browser cache has not already been prepared. The Agent Wiki package
does not bundle Chromium. On WSL2, clear inherited WSLg display variables for a
headless run:

```sh
env -u DISPLAY -u WAYLAND_DISPLAY node scripts/qualify-package.mjs \
  --package-root /nix/store/...-agent-wiki-0.8.7 \
  --receipt /absolute/private/path/package-qualification.json
```

The runner creates a mode-0700 temporary directory and synthetic data only. It
uses a loopback HTTPS proxy with an ephemeral self-signed certificate and sets
`ignoreHTTPSErrors` only on its Playwright browser context. It does not change
the host trust store, expose a network listener, import an operator root, or
write persistent machine configuration. Command output, generated credentials,
the TLS private key, and a failure screenshot stay in that private directory.
Successful runs remove it unless `--keep-evidence` is supplied. Failed runs
retain it and name the directory in the failure receipt.

The acceptance sequence verifies:

- the package identity file and `agent-wiki-package-info` agree, all declared
  entrypoints exist, both managed lifecycle aliases execute, and the supplied
  package root is read-only;
- empty managed bootstrap succeeds and a second bootstrap is refused;
- trace import and article-media publication run through fenced maintenance;
- an active managed server excludes offline maintenance;
- the bootstrap invitation creates a local manager through the browser over
  HTTPS;
- that browser and its cookie-authenticated MCP connection both read and write;
- imported trace evidence and published media bytes are readable;
- content, session identity, and the manager grant survive a server-process
  restart;
- an offline mode-0600 backup restores into a fresh root with the same Git HEAD,
  principal, grant, content, trace, and media;
- retained synthetic writer evidence blocks serve, binds to an inspection
  manifest, recovers explicitly, and permits a new authenticated write.

The JSON receipt records the exact package identity, package root, identity and
entrypoint digests, qualifier and fixture digests, step timings, continuity
identifiers, and sanitized check results. It distinguishes the process restart
that it performs from service-manager restart, WSL, and host-reboot claims. The
latter three remain `tested: false` until separately exercised in their actual
environments. A passing portable run therefore does not establish service
activation, WSL compatibility, reboot persistence, OCI behavior, or any external
storage claim. The backup archive and both managed roots are siblings on the
same temporary filesystem. `fresh_root_backup_restore` proves application
continuity after restore; it does not qualify independent backup retention or
recovery after loss of that filesystem.

Use `--headed` only for local troubleshooting. It changes browser visibility,
not the acceptance operations. Use `--keep-evidence` when a reviewer needs the
private command logs from a passing run. Never publish the retained directory:
it contains a one-use setup URL and the temporary TLS private key.

## Existing-state container adoption

`scripts/qualify-container-adoption.py` is a separate native Linux Docker check
for moving direct-storage state into the OCI lifecycle. Supply already loaded
legacy and candidate images, a non-root container UID/GID that the caller can
assign to disposable fixture paths, and a new private receipt:

```sh
python3 scripts/qualify-container-adoption.py \
  --legacy-image agent-wiki:0.8.8-LEGACY_SOURCE \
  --candidate-image agent-wiki:0.8.9-CANDIDATE_SOURCE \
  --uid 1000 --gid 1000 \
  --receipt /absolute/private/adoption-qualification.json
```

The qualifier creates its own content Git repository and asks the legacy image's
direct bootstrap command to create a synthetic manager in a separate control
directory. It then bind-mounts those two directories beneath a new candidate
managed root, adopts them with an ephemeral host evidence service, and verifies:

- content HEAD and principal identity survive adoption without a local trace
  directory;
- authenticated MCP reads, writes and an actual external trace read work before
  and after forced container recreation;
- backup records the external provider descriptor and contains no trace archive;
- fresh-root restore preserves authentication, content, writes and external
  evidence access.

It uses a safe synthetic SCP-style remote with push disabled, proving adoption
compatibility but not SSH transport or remote publication. The receipt records
that limit; qualify the deployment's mounted passwd identity, key, `known_hosts`,
SSH alias and push separately. No real account, SSH file, Wiki root or evidence
archive is read. Successful runs remove the private fixture unless
`--keep-fixture` is supplied; failures retain it and a private command log.
