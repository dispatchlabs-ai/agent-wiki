# Qualify a deployed Wiki endpoint

`scripts/qualify-endpoint.mjs` exercises an explicitly authorized synthetic
installation through its real HTTPS origin. It uses the repository's locked
Playwright dependency and an installed Chromium browser. Run `npm ci` and
`npx playwright install chromium` on the operator machine first.

The script consumes a private bootstrap JSON file containing `setup_url`, or a
private credential JSON file containing `email` and `password`. Bootstrap output
must arrive through the protected lifecycle capture channel; never paste its
one-use URL into commands, infrastructure variables, logs or review receipts.
Files containing credentials must have no group or other permissions.

```sh
node scripts/qualify-endpoint.mjs \
  --origin https://wiki.example.com \
  --bootstrap-file /private/operator/bootstrap.json \
  --credentials-file /private/operator/synthetic-login.json \
  --receipt /private/operator/initial-endpoint.json \
  --allow-synthetic-write
```

For first setup the absent credential file is created with a generated password
and synthetic manager email `manager@example.invalid`. Supply a private file
beforehand when bootstrap used another manager email. The script does not store
browser traces, screenshots, cookies or passwords in its qualification receipt.
TLS certificate verification stays enabled.

After an upgrade, restart or restore, use the same private credentials and the
previous receipt. This verifies the previous acknowledged article revision and
manager identity before creating another unique synthetic article:

```sh
node scripts/qualify-endpoint.mjs \
  --origin https://wiki.example.com \
  --credentials-file /private/operator/synthetic-login.json \
  --previous-receipt /private/operator/initial-endpoint.json \
  --receipt /private/operator/after-upgrade-endpoint.json \
  --allow-synthetic-write
```

Each run checks liveness, authenticated article readiness, a manager session,
MCP create/read with actor attribution, a browser edit/read, and MCP readback of
the browser revision. It writes a new mode-0600 receipt and exits nonzero on
failure. It intentionally leaves its synthetic article as persistence evidence;
run it only on an authorized test installation. It never changes infrastructure,
application versions, identities, permissions or lifecycle ownership.

This receipt supports functional health evidence. It does not prove an image
digest, ECS task identity, filesystem ownership, backup consistency, or safe
quiescence. Retain those observations separately and bind them to the deployment
operation before constructing its operator-attested health receipt.
