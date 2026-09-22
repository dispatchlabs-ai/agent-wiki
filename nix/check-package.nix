{
  runCommand,
  jq,
  cacert,
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

    cat > "$TMPDIR/check-trust.cjs" <<'EOF'
    const fs = require('node:fs');
    const tls = require('node:tls');
    const assert = require('node:assert/strict');
    assert.equal(process.env.NODE_EXTRA_CA_CERTS, process.env.EXPECTED_CA_FILE);
    const pem = fs.readFileSync(process.env.NODE_EXTRA_CA_CERTS, 'utf8');
    assert.match(pem, /-----BEGIN CERTIFICATE-----/);
    tls.createSecureContext({ ca: pem });
    EOF
    export NODE_OPTIONS="--require=$TMPDIR/check-trust.cjs"
    export EXPECTED_CA_FILE=${cacert}/etc/ssl/certs/ca-bundle.crt
    unset NODE_EXTRA_CA_CERTS
    HOME="$TMPDIR" agent-wiki-cli --help >/dev/null
    HOME="$TMPDIR" agent-wiki bootstrap --root "$TMPDIR/trust-bootstrap" \
      --origin https://wiki.qualification.invalid --manager-name 'Synthetic manager' \
      --manager-email manager@example.invalid >/dev/null
    cp ${cacert}/etc/ssl/certs/ca-bundle.crt "$TMPDIR/custom-ca.crt"
    HOME="$TMPDIR" NODE_EXTRA_CA_CERTS="$TMPDIR/custom-ca.crt" \
      EXPECTED_CA_FILE="$TMPDIR/custom-ca.crt" agent-wiki-cli --help >/dev/null
    unset NODE_OPTIONS EXPECTED_CA_FILE
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
