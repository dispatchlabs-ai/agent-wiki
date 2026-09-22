# Container deployment

The Linux image runs the managed lifecycle as its entry point, under numeric user
and group `65532:65532`. Keep `/data` durable and writable by that identity, use a
writable `/tmp`, and expose port 4317 only to the deployment's HTTPS proxy or
private network boundary.

The repository includes [`examples/compose-existing-state.yaml`](../examples/compose-existing-state.yaml)
as a generic example for an existing installation. It deliberately contains no
host-specific paths, credentials, DNS, certificates or service-manager settings.
Set its variables in a private environment file; the two source directories must
already contain a complete content Git repository and `control.sqlite3`.
Create `WIKI_MANAGED_ROOT/search` before starting because the configured SQLite
search index is derived and excluded from lifecycle backup/restore. Make the root,
search directory, content repository and control directory writable by the
selected container identity. The example uses a private tmpfs for `/tmp` and a
small init process so stop signals reach the managed server and its children.

Stop every direct Wiki process and writer and retain a reviewed recovery copy.
Then adopt the mounted stores once:

```sh
docker compose --env-file /private/wiki.env \
  -f examples/compose-existing-state.yaml run --rm wiki \
  adopt --root /data --origin https://wiki.example.org \
  --external-evidence-url http://host.docker.internal:8769/api/evidence/v1/
```

The command verifies content and identities in place and writes the lifecycle
marker to `WIKI_MANAGED_ROOT`; it does not replace the two bind-mounted stores.
Start the service only after adoption succeeds:

```sh
docker compose --env-file /private/wiki.env \
  -f examples/compose-existing-state.yaml up -d
```

The example publishes the application only on loopback and uses
`host.docker.internal` for a host evidence service. Docker Desktop supplies that
name; the example's `host-gateway` entry supplies it on current Linux Docker.
Choose a different explicit provider address when the evidence service is on
another host or network. Its URL is normalized and retained in the marker, so it
does not also belong in the long-running container environment.

Set `WIKI_PUSH=1` only when remote publication is intended. For SSH remotes, add
read-only mounts for a purpose-specific private key, `known_hosts`, and a minimal
SSH configuration owned by the deployment. Supply a minimal passwd entry and
home directory for the selected numeric container identity when its SSH client
needs NSS identity lookup; these files can be read-only mounts and do not require
rebuilding the image. The image includes OpenSSH and accepts safe `ssh://` and
SCP-style alias remotes. It continues to reject Git remote helpers, hooks,
filesystem redirects and unsafe repository configuration. The container retains
explicit `GIT_ASKPASS`, `GIT_SSH_COMMAND`, `GIT_AUTHOR_*` and `GIT_COMMITTER_*`
settings, but it does not inherit a host user's global Git configuration.

For a new installation, omit the nested content/control bind mounts and bootstrap
an empty durable `/data` volume as shown in [portable packages](packaging.md#build-and-inspect).
Do not use the existing-state Compose file for bootstrap because Docker creates
the nested mount points before the lifecycle can create its fresh layout.
