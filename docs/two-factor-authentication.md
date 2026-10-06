# Two-factor authentication

Agent Wiki 0.9.0 adds optional per-user two-factor authentication for local
email/password and Google/OIDC accounts. Sign in, open **Your account**, then
**Two-factor authentication**. Enroll a passkey, an authenticator app, or both.
Protection starts only after successful verification. Save the ten recovery
codes shown after your first enrollment; they are displayed only once.

After Google/OIDC or password sign-in, a protected account must verify an enrolled
factor before receiving a wiki session. The pending challenge expires in five
minutes and grants no content, API or OAuth consent access. The original article
or authorization destination is retained. Passkeys are a second sign-in step,
not a passwordless replacement for the first step. Each separate local or OIDC
identity manages its own factors; matching email addresses do not join accounts.

## Enroll and manage methods

- **Passkey:** choose **Add a passkey** and accept your browser's passkey
  prompt. The authenticator must verify you using its supported biometric or
  device-PIN method. A default label such as **Passkey 1** is assigned automatically.
  Use **Rename** afterward if a personal label helps you recognize the device.
  Multiple passkeys are supported.
- **After enrollment:** save the recovery-code file from the confirmation screen,
  or expand **View recovery codes** to copy them. Optional passkey renaming keeps
  the one-time codes on screen until you leave the page.
- **Authenticator app:** scan the QR code, or enter the setup key, then verify
  a six-digit code. One authenticator secret is enrolled per account.
- **Recovery code:** use one saved code when neither normal method is available.
  Each code works once. Generate replacements in security settings after signing
  in; doing so invalidates every earlier code.

Security changes require a wiki sign-in within the last five minutes, including
the second factor when already enabled. Sign out and sign in again when asked.
Adding or removing factors, regenerating recovery codes, or turning protection off revokes
other browser sessions and outstanding MFA challenges. These operations do not
extend the retained session's original eight-hour expiry or authentication
freshness. Renaming an owned passkey also requires fresh sign-in but changes only
its label; it preserves credentials, recovery codes, sessions and their expiry.
Password changes for enrolled accounts also require recent MFA proof.
To remove the final factor, explicitly turn off two-factor authentication.

The feature is optional. There is no organization-wide enforcement setting or
manager reset button. Named-agent credentials, remote OAuth grants and their
scopes remain separate. Browser consent requires completion of human MFA;
existing agent access does not acquire a human second-factor requirement.
Local CLI users can provide a TOTP or recovery code with
[`--second-factor-file`](cli.md#sign-in). Passkey ceremonies use the browser.

## Deployment and storage

No additional provider secret or feature flag is required. Serve one canonical
HTTPS origin and redirect aliases before authentication. Passkeys are bound to
that origin and hostname. Moving the wiki to a different hostname requires
re-enrollment; keep an independent authenticator or recovery method available.
Loopback HTTP is supported only for synthetic development.

The control database holds public passkey credentials, monotonic counters,
SHA-256 hashes of random 128-bit recovery codes, and AES-256-GCM encrypted TOTP
secrets. The server creates a random 32-byte mode-0600 key next to the control
database at first TOTP setup (`WIKI_CONTROL` plus `.mfa-key`). The parent directory
must be private and writable by the service account. The key is separate from the
database but belongs to the same authoritative backup. Missing, invalid, or
mismatched keys fail closed; they are never silently regenerated over enrollment.

TOTP uses six digits, SHA-1 and 30-second steps with a one-step clock tolerance;
an already accepted step cannot be reused. Verification attempts share a durable
per-account limit of ten per fifteen minutes across login and enrollment. Passkey
verification requires the expected challenge, origin, RP ID, credential owner,
signature and user verification. One-use challenges are bound to the initiating
session or pending sign-in. Use normal clock synchronization on the host.

## Backup and recovery

Use the 0.9.0-or-newer lifecycle backup and restore commands. They preserve and
validate the TOTP key with the control database. A restore invalidates browser
sessions, login attempts, MFA challenges and **all saved recovery codes**, so
used codes from after the backup cannot become valid again. It also advances
the TOTP replay counter beyond the restore-time tolerance window; a code may
need up to ninety seconds to become usable. Passkey enrollment and encrypted
authenticator seeds are retained. Sign in with an enrolled method and generate
new recovery codes. Continue the general [recovery reconciliation](authentication.md#recovery)
for restored passwords, grants, agent credentials and invitations.

If a person has lost every method, a trusted operator must independently verify
their identity, identify their exact principal UUID, stop the managed writer and
use the installation's lifecycle maintenance workflow to run:

```sh
node scripts/reset-mfa.mjs PRINCIPAL_UUID
```

Supply the normal private `WIKI_CONTROL` and canonical `WIKI_ORIGIN` environment.
The command removes that principal's factors and recovery codes, revokes all
their browser sessions/challenges, and records `mfa:operator-reset` attributed to
`operator`. It preserves identity, password, grants and unrelated accounts. The
person must sign in with the first factor and enroll again. Resetting a local
password alone does not remove MFA. There is no remote unauthenticated reset.

Schema installation is additive, and existing users keep their sign-in behavior
until they enroll. Once a user enrolls, retain a 0.9.0-or-newer server and lifecycle
tools. An older server is blocked from issuing password-only sessions by the
database guard, but cannot complete MFA or safely manage its backups. Downgrading
is not a supported recovery procedure.
