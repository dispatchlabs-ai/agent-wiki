{
  runCommand,
  jq,
  cacert,
  closureInfo,
  agent-wiki,
}:

let
  closure = closureInfo { rootPaths = [ agent-wiki ]; };
in
runCommand "agent-wiki-package-smoke-${agent-wiki.version}"
  {
    nativeBuildInputs = [
      agent-wiki
      jq
    ];
  }
  ''
    # Inspect the built runtime, including references retained by source helpers
    # and embedded compiler configuration, not just the selected Nix arguments.
    while IFS= read -r store_path; do
      case "$store_path" in
        *-openssl-*)
          case "$store_path" in
            *-openssl-3.6.5|*-openssl-3.6.5-*) ;;
            *) echo "Unreviewed OpenSSL in runtime closure: $store_path" >&2; exit 1 ;;
          esac
          ;;
        *-perl-[0-9]*)
          echo "Unused Perl interpreter in runtime closure: $store_path" >&2
          exit 1
          ;;
      esac
    done < ${closure}/store-paths

    identity="$(agent-wiki-package-info)"
    test "$(printf '%s' "$identity" | jq -r .name)" = agent-wiki
    test "$(printf '%s' "$identity" | jq -r .version)" = ${agent-wiki.version}
    test "$(printf '%s' "$identity" | jq -r .node)" = ${agent-wiki.packageIdentity.node}
    test "$(printf '%s' "$identity" | jq -r .system)" = ${agent-wiki.packageIdentity.system}
    test "$(printf '%s' "$identity" | jq -r '.packageLockSha256 | length')" = 64

    cat > "$TMPDIR/check-trust.cjs" <<'EOF'
    const fs = require('node:fs');
    const tls = require('node:tls');
    const assert = require('node:assert/strict');
    assert.equal(process.versions.openssl, '3.6.5');
    assert.equal(process.versions.sqlite, '3.53.3');
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
    python_bin=$(sed -n 's/^exec "\([^"]*\/bin\/python3\)".*/\1/p' "${agent-wiki}/bin/agent-wiki")
    test -x "$python_bin"
    "$python_bin" -c 'import ssl, sqlite3; assert ssl.OPENSSL_VERSION.split()[1] == "3.6.5"; assert sqlite3.sqlite_version == "3.53.3"'
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
