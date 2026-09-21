{
  runCommand,
  jq,
  agent-wiki,
}:

runCommand "agent-wiki-package-smoke-${agent-wiki.version}"
  {
    nativeBuildInputs = [
      agent-wiki
      jq
    ];
  }
  ''
    identity="$(agent-wiki-package-info)"
    test "$(printf '%s' "$identity" | jq -r .name)" = agent-wiki
    test "$(printf '%s' "$identity" | jq -r .version)" = ${agent-wiki.version}
    test "$(printf '%s' "$identity" | jq -r .node)" = 24.19.0
    test "$(printf '%s' "$identity" | jq -r .system)" = ${agent-wiki.packageIdentity.system}
    test "$(printf '%s' "$identity" | jq -r '.packageLockSha256 | length')" = 64

    HOME="$TMPDIR" agent-wiki-cli --help >/dev/null
    HOME="$TMPDIR" agent-wiki --help >/dev/null
    test -f "${agent-wiki}/libexec/agent-wiki/ui/components/site.mjs"
    mkdir "$TMPDIR/uninitialized"
    agent-wiki status --root "$TMPDIR/uninitialized" \
      | jq -e '.state == "uninitialized" and .active_owner == false' >/dev/null

    for executable in \
      agent-wiki-server-direct \
      agent-wiki \
      agent-wiki-lifecycle \
      agent-wiki-cli \
      agent-wiki-bootstrap-direct \
      agent-wiki-bootstrap-oidc-direct \
      agent-wiki-local-account-direct \
      agent-wiki-agent-admin-direct \
      agent-wiki-agent-keygen \
      agent-wiki-agent-mcp \
      agent-wiki-import-trace-direct \
      agent-wiki-index-traces-direct \
      agent-wiki-publish-media-direct \
      agent-wiki-package-info
    do
      test -x "${agent-wiki}/bin/$executable"
    done

    mkdir "$out"
    printf '%s\n' "$identity" > "$out/package-identity.json"
  ''
