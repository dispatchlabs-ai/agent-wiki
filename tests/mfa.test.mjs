import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { once } from "node:events";
import net from "node:net";
import {
  randomBytes,
  generateKeyPairSync,
  createHash,
  sign,
} from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import * as OTPAuth from "otpauth";
import { ControlStore, digest } from "../src/control-store.mjs";
import { Mfa } from "../src/mfa.mjs";
import { createWiki } from "../src/server.mjs";
import { hashPassword } from "../src/passwords.mjs";
import { localLogin } from "../src/api-client.mjs";
import { fixture } from "./helpers.mjs";

function setup(t, durable = false) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "wiki-mfa-"));
  const control = new ControlStore(
    durable ? path.join(directory, "control.sqlite3") : ":memory:",
  );
  t.after(() => {
    control.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });
  const invite = control.bootstrapLocal("owner@example.test", "Example owner");
  const session = control.acceptInvitation(invite.token, "synthetic-hash");
  return {
    control,
    mfa: new Mfa(control, "https://wiki.example.test"),
    principal: invite.id,
    session,
    directory,
  };
}
const code = (secret) =>
  new OTPAuth.TOTP({ secret: OTPAuth.Secret.fromBase32(secret) }).generate();
function enroll(mfa, session) {
  const pending = mfa.beginTotp(session.token);
  return {
    ...pending,
    ...mfa.finishTotp(session.token, pending.flow, code(pending.secret)),
  };
}

test("TOTP enrollment requires proof, encrypts secrets, rotates sessions, and has no password-only downgrade", (t) => {
  const { control, mfa, principal, session } = setup(t);
  const secondSession = control.session(principal);
  const pending = mfa.beginTotp(session.token);
  assert.equal(mfa.enabled(principal), false);
  assert.throws(
    () => mfa.finishTotp(session.token, pending.flow, "invalid"),
    /Verification failed/,
  );
  const result = mfa.finishTotp(
    session.token,
    pending.flow,
    code(pending.secret),
  );
  assert.equal(result.recoveryCodes.length, 10);
  assert.equal(new Set(result.recoveryCodes).size, 10);
  assert.equal(control.authenticate(session.token), null);
  assert.equal(control.authenticate(secondSession.token), null);
  assert.equal(control.authenticate(result.session.token).id, principal);
  assert.throws(() => control.session(principal), /Two-factor/);
  assert.throws(
    () =>
      control.db
        .prepare("INSERT INTO sessions VALUES (?,?,?,?)")
        .run(
          digest("old-runtime-cookie"),
          principal,
          "csrf",
          Date.now() + 100000,
        ),
    /Second factor/,
  );
  const stored = control.db.prepare("SELECT data FROM mfa_factors").get().data;
  assert.equal(stored.includes(pending.secret), false);
  assert.equal(
    JSON.stringify(mfa.status(principal)).includes(pending.secret),
    false,
  );
  assert.throws(() =>
    mfa.finishTotp(result.session.token, pending.flow, code(pending.secret)),
  );
});

test("TOTP counters and recovery codes are single-use across independent login challenges", (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: Date.now() });
  const { control, mfa, principal, session } = setup(t);
  const enrolled = enroll(mfa, session);
  const one = mfa.beginSignIn(principal, "/wiki/guide/");
  const two = mfa.beginSignIn(principal);
  assert.equal(one.session, undefined);
  assert.throws(
    () => mfa.verifyCode(one.pending, code(enrolled.secret)),
    /Verification failed/,
  );
  t.mock.timers.tick(30000);
  const current = code(enrolled.secret);
  const completed = mfa.verifyCode(one.pending, current);
  assert.equal(completed.destination, "/wiki/guide/");
  assert.equal(control.authenticate(completed.session.token).id, principal);
  assert.throws(
    () => mfa.verifyCode(one.pending, current),
    /Verification failed/,
  );
  assert.throws(
    () => mfa.verifyCode(two.pending, current),
    /Verification failed/,
  );
  const recovery = mfa.verifyCode(two.pending, enrolled.recoveryCodes[0], true);
  assert.ok(control.authenticate(recovery.session.token));
  const three = mfa.beginSignIn(principal);
  assert.throws(
    () => mfa.verifyCode(three.pending, enrolled.recoveryCodes[0], true),
    /Verification failed/,
  );
  assert.equal(mfa.status(principal).recoveryCodes, 9);
});

test("pending logins expire, respect disabled identities and password changes, and share durable attempt limits", (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: Date.now() });
  const { control, mfa, principal, session } = setup(t);
  const enrolled = enroll(mfa, session);
  let pending = mfa.beginSignIn(principal, "/", "synthetic-hash");
  control.db
    .prepare("UPDATE local_accounts SET password='changed' WHERE principal=?")
    .run(principal);
  assert.throws(() =>
    mfa.verifyCode(pending.pending, enrolled.recoveryCodes[0], true),
  );
  pending = mfa.beginSignIn(principal);
  control.db
    .prepare("UPDATE principals SET active=0 WHERE id=?")
    .run(principal);
  assert.throws(() =>
    mfa.verifyCode(pending.pending, enrolled.recoveryCodes[0], true),
  );
  control.db
    .prepare("UPDATE principals SET active=1 WHERE id=?")
    .run(principal);
  pending = mfa.beginSignIn(principal);
  t.mock.timers.tick(5 * 60000 + 1);
  assert.throws(() => mfa.pending(pending.pending));
  for (let i = 0; i < 9; i++) {
    pending = mfa.beginSignIn(principal);
    assert.throws(
      () => mfa.verifyCode(pending.pending, "invalid"),
      /Verification failed/,
    );
  }
  pending = mfa.beginSignIn(principal);
  assert.throws(
    () => mfa.verifyCode(pending.pending, enrolled.recoveryCodes[0], true),
    /Too many attempts/,
  );
});

test("fresh authentication and owner-bound enrollment protect account changes", (t) => {
  const { control, mfa, principal, session } = setup(t);
  const other = control.enroll({
    issuer: "https://id.example",
    subject: "other",
    name: "Other",
  });
  const otherSession = control.session(other.id);
  const start = mfa.beginTotp(session.token);
  assert.throws(() =>
    mfa.finishTotp(otherSession.token, start.flow, code(start.secret)),
  );
  control.db
    .prepare("UPDATE mfa_sessions SET primary_at=? WHERE hash=?")
    .run(Date.now() - 6 * 60000, digest(session.token));
  assert.throws(
    () => mfa.finishTotp(session.token, start.flow, code(start.secret)),
    /Sign out/,
  );
  assert.equal(mfa.enabled(principal), false);
});

test("durable TOTP key survives reopening and cannot be silently replaced", (t) => {
  const { control, mfa, principal, session } = setup(t, true);
  const enrolled = enroll(mfa, session),
    keyFile = control.filename + ".mfa-key";
  assert.equal(fs.statSync(keyFile).mode & 0o077, 0);
  const again = new Mfa(control, "https://wiki.example.test");
  const encrypted = control.db
    .prepare("SELECT data FROM mfa_factors WHERE principal=?")
    .get(principal).data;
  assert.equal(again.unseal(principal, encrypted), enrolled.secret);
  fs.unlinkSync(keyFile);
  assert.throws(() => again.encryptionKey(true), /storage is unavailable/);
  assert.equal(fs.existsSync(keyFile), false);
  fs.writeFileSync(keyFile, randomBytes(32), { mode: 0o600 });
  assert.throws(() => again.unseal(principal, encrypted));
});

test("recovery renewal and disabling MFA revoke sessions and outstanding challenges", (t) => {
  const { control, mfa, principal, session } = setup(t);
  const enrolled = enroll(mfa, session);
  const pending = mfa.beginSignIn(principal);
  const renewed = mfa.regenerate(enrolled.session.token);
  assert.equal(control.authenticate(enrolled.session.token), null);
  assert.throws(() => mfa.pending(pending.pending));
  const next = mfa.beginSignIn(principal);
  assert.throws(() =>
    mfa.verifyCode(next.pending, enrolled.recoveryCodes[0], true),
  );
  const disabled = mfa.disable(renewed.session.token);
  assert.equal(mfa.status(principal).enabled, false);
  assert.equal(mfa.status(principal).recoveryCodes, 0);
  assert.equal(control.authenticate(renewed.session.token), null);
  assert.ok(control.authenticate(disabled.session.token));
  assert.ok(mfa.beginSignIn(principal).session);
});

test("settings changes do not renew authentication freshness or extend absolute session lifetime", (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: Date.now() });
  const { control, mfa, session } = setup(t);
  const enrolled = enroll(mfa, session);
  const before = control.authenticate(enrolled.session.token);
  t.mock.timers.tick(4 * 60000);
  const renewed = mfa.regenerate(enrolled.session.token);
  const after = control.authenticate(renewed.session.token);
  assert.equal(after.primary_at, before.primary_at);
  assert.equal(after.mfa_at, before.mfa_at);
  assert.equal(after.expires, before.expires);
  t.mock.timers.tick(2 * 60000);
  assert.throws(() => mfa.disable(renewed.session.token), /Sign out/);
});

test("passkeys validate signed challenge, origin, RP, user verification, ownership, and replay", async (t) => {
  const { control, mfa, principal } = setup(t);
  const { publicKey, privateKey } = generateKeyPairSync("ec", {
    namedCurve: "prime256v1",
  });
  const jwk = publicKey.export({ format: "jwk" });
  const cose = Buffer.concat([
    Buffer.from("a5010203262001215820", "hex"),
    Buffer.from(jwk.x, "base64url"),
    Buffer.from("225820", "hex"),
    Buffer.from(jwk.y, "base64url"),
  ]);
  const id = randomBytes(32).toString("base64url");
  control.db
    .prepare("INSERT INTO mfa_factors VALUES (?,?,'passkey','Synthetic',?,0,?)")
    .run(
      id,
      principal,
      JSON.stringify({
        id,
        publicKey: cose.toString("base64"),
        transports: ["internal"],
      }),
      Date.now(),
    );
  const sha = (value) => createHash("sha256").update(value).digest();
  const response = (challenge, changes = {}) => {
    const clientDataJSON = Buffer.from(
      JSON.stringify({
        type: "webauthn.get",
        challenge,
        origin: changes.origin || mfa.origin,
        crossOrigin: false,
      }),
    );
    const counter = Buffer.alloc(4);
    counter.writeUInt32BE(changes.counter ?? 1);
    const authenticatorData = Buffer.concat([
      sha(changes.rpID || mfa.rpID),
      Buffer.from([changes.flags ?? 5]),
      counter,
    ]);
    return {
      id,
      rawId: id,
      type: "public-key",
      clientExtensionResults: {},
      response: {
        clientDataJSON: clientDataJSON.toString("base64url"),
        authenticatorData: authenticatorData.toString("base64url"),
        signature: (changes.badSignature
          ? randomBytes(64)
          : sign(
              "sha256",
              Buffer.concat([authenticatorData, sha(clientDataJSON)]),
              privateKey,
            )
        ).toString("base64url"),
        userHandle: Buffer.from(changes.principal || principal).toString(
          "base64url",
        ),
      },
    };
  };
  for (const changes of [
    { flags: 1 },
    { origin: "https://evil.example" },
    { rpID: "evil.example" },
    { challenge: "wrong" },
    { principal: "another-account" },
    { badSignature: true },
  ]) {
    const pending = mfa.beginSignIn(principal);
    const { flow, options } = await mfa.authenticationOptions(pending.pending);
    await assert.rejects(
      mfa.verifyPasskey(
        pending.pending,
        flow,
        response(changes.challenge || options.challenge, changes),
      ),
      /Verification failed/,
    );
  }
  const pending = mfa.beginSignIn(principal);
  const { flow, options } = await mfa.authenticationOptions(pending.pending);
  const assertion = response(options.challenge);
  const result = await mfa.verifyPasskey(pending.pending, flow, assertion);
  assert.equal(control.authenticate(result.session.token).id, principal);
  await assert.rejects(
    mfa.verifyPasskey(pending.pending, flow, assertion),
    /Verification failed/,
  );
  const next = mfa.beginSignIn(principal);
  const nextOptions = await mfa.authenticationOptions(next.pending);
  await assert.rejects(
    mfa.verifyPasskey(
      next.pending,
      nextOptions.flow,
      response(nextOptions.options.challenge),
    ),
    /Verification failed/,
  );
});

test("operator recovery targets one exact identity, preserves grants, and revokes authentication", (t) => {
  const { control, mfa, principal, session } = setup(t, true);
  const enrolled = enroll(mfa, session);
  const pending = mfa.beginSignIn(principal);
  const grants = control.db.prepare("SELECT * FROM grants").all();
  const run = (id) =>
    spawnSync(process.execPath, ["scripts/reset-mfa.mjs", id], {
      cwd: new URL("..", import.meta.url),
      encoding: "utf8",
      env: {
        ...process.env,
        WIKI_CONTROL: control.filename,
        WIKI_ORIGIN: mfa.origin,
      },
    });
  assert.notEqual(run("unknown").status, 0);
  assert.equal(mfa.enabled(principal), true);
  const reset = run(principal);
  assert.equal(reset.status, 0, reset.stderr);
  assert.equal(mfa.enabled(principal), false);
  assert.equal(control.authenticate(enrolled.session.token), null);
  assert.throws(() => mfa.pending(pending.pending));
  assert.deepEqual(control.db.prepare("SELECT * FROM grants").all(), grants);
  assert.equal(
    control.db
      .prepare(
        "SELECT actor FROM audit WHERE action='mfa:operator-reset' AND target=?",
      )
      .get(principal).actor,
    "operator",
  );
});

test("HTTP and CLI local login cannot bypass an enrolled factor or use it without cookie-bound CSRF", async (t) => {
  const repo = fixture(t),
    control = new ControlStore(path.join(repo, ".git/control.sqlite3"));
  const invite = control.bootstrapLocal("manager@example.test", "Manager");
  const password = "synthetic long example passphrase";
  const session = control.acceptInvitation(
    invite.token,
    await hashPassword(password),
  );
  const reservation = net.createServer().listen(0, "127.0.0.1");
  await once(reservation, "listening");
  const port = reservation.address().port;
  await new Promise((resolve) => reservation.close(resolve));
  const origin = `http://127.0.0.1:${port}`,
    mfa = new Mfa(control, origin);
  const enrolled = enroll(mfa, session);
  const app = createWiki({
    repo,
    control,
    origin,
    localLogin: true,
    development: true,
  });
  app.listen(port, "127.0.0.1");
  await once(app, "listening");
  t.after(async () => {
    await new Promise((resolve) => {
      app.close(resolve);
      app.closeAllConnections();
    });
    control.close();
  });
  const getCookie = (response, name) =>
    response.headers
      .getSetCookie()
      .map((x) => new RegExp(`^${name}=([^;]+)`).exec(x)?.[1])
      .find(Boolean);
  const form = await fetch(origin + "/auth/sign-in?mode=local");
  const csrf = getCookie(form, "wiki_form");
  await form.text();
  const response = await fetch(origin + "/auth/local/login", {
    method: "POST",
    headers: {
      Origin: origin,
      "Content-Type": "application/json",
      Cookie: `wiki_form=${csrf}`,
      "X-Wiki-CSRF": csrf,
    },
    body: JSON.stringify({
      email: "manager@example.test",
      password,
      returnTo: "/wiki/guide/",
    }),
  });
  const result = await response.json(),
    pending = getCookie(response, "wiki_mfa");
  assert.equal(result.mfaRequired, true);
  assert.equal(getCookie(response, "wiki_session"), undefined);
  for (const route of [
    "/api/me",
    "/api/articles/catalog.json",
    "/api/account/security",
    "/oauth/authorize",
  ]) {
    const blocked = await fetch(origin + route, {
      headers: { Cookie: `wiki_mfa=${pending}` },
    });
    assert.equal(blocked.status, 401, route);
    await blocked.text();
  }
  const rejected = await fetch(origin + "/auth/mfa/code", {
    method: "POST",
    headers: {
      Origin: origin,
      "Content-Type": "application/json",
      Cookie: `wiki_mfa=${pending}`,
      "X-Wiki-CSRF": "wrong",
    },
    body: JSON.stringify({ code: enrolled.recoveryCodes[0], recovery: true }),
  });
  assert.equal(rejected.status, 403);
  await rejected.text();
  const complete = await fetch(origin + "/auth/mfa/code", {
    method: "POST",
    headers: {
      Origin: origin,
      "Content-Type": "application/json",
      Cookie: `wiki_mfa=${pending}`,
      "X-Wiki-CSRF": result.csrf,
    },
    body: JSON.stringify({ code: enrolled.recoveryCodes[0], recovery: true }),
  });
  assert.equal(complete.status, 200);
  assert.equal((await complete.json()).redirect, "/wiki/guide/");
  assert.ok(getCookie(complete, "wiki_session"));
  await assert.rejects(
    localLogin(origin, "manager@example.test", password),
    (error) => error.code === "MFA_REQUIRED",
  );
  const profile = await localLogin(
    origin,
    "manager@example.test",
    password,
    fetch,
    enrolled.recoveryCodes[1],
  );
  assert.equal(profile.kind, "session");
  assert.ok(control.authenticate(profile.session));
  const factorFile = path.join(repo, ".git/second-factor.txt");
  const cliProfile = path.join(repo, ".git/cli.json");
  fs.writeFileSync(factorFile, enrolled.recoveryCodes[2], { mode: 0o600 });
  const cli = async () => {
    const child = spawn(
      process.execPath,
      [
        "bin/wiki.mjs",
        "login",
        "--url",
        origin,
        "--email",
        "manager@example.test",
        "--password-stdin",
        "--second-factor-file",
        factorFile,
        "--config",
        cliProfile,
        "--json",
      ],
      { cwd: new URL("..", import.meta.url) },
    );
    let stdout = "",
      stderr = "";
    child.stdout.on("data", (data) => {
      stdout += data;
    });
    child.stderr.on("data", (data) => {
      stderr += data;
    });
    child.stdin.end(password);
    const [exitCode] = await once(child, "close");
    return { exitCode, value: JSON.parse(stdout), stderr };
  };
  fs.chmodSync(factorFile, 0o644);
  const rejectedFile = await cli();
  assert.equal(rejectedFile.exitCode, 2);
  assert.equal(fs.existsSync(cliProfile), false);
  fs.chmodSync(factorFile, 0o600);
  const acceptedFile = await cli();
  assert.equal(acceptedFile.exitCode, 0, acceptedFile.stderr);
  assert.equal(acceptedFile.value.signedIn, true);
  assert.equal(fs.statSync(cliProfile).mode & 0o077, 0);
  assert.equal(JSON.parse(fs.readFileSync(cliProfile, "utf8")).kind, "session");
});

test("passkey rename is owner-bound, fresh, audited, and preserves credential and recovery state", (t) => {
  const { control, mfa, principal, session } = setup(t);
  const enrolled = enroll(mfa, session);
  const insert = control.db.prepare(
    "INSERT INTO mfa_factors VALUES (?,?,'passkey',?,?,?,?)",
  );
  insert.run(
    "passkey-one",
    principal,
    "Passkey 1",
    "synthetic credential bytes",
    42,
    Date.now(),
  );
  insert.run(
    "passkey-three",
    principal,
    "Passkey 3",
    "other synthetic credential",
    9,
    Date.now(),
  );
  assert.equal(mfa.defaultPasskeyName(principal), "Passkey 2");
  const other = control.enroll({
    issuer: "https://id.example",
    subject: "rename-other",
    name: "Other",
  });
  const otherSession = control.session(other.id);
  const before = control.db
    .prepare("SELECT * FROM mfa_factors WHERE id='passkey-one'")
    .get();
  const snapshot = () => ({
    sessions: control.db.prepare("SELECT * FROM sessions").all(),
    proofs: control.db.prepare("SELECT * FROM mfa_sessions").all(),
    recovery: control.db.prepare("SELECT * FROM mfa_recovery").all(),
  });
  const original = snapshot();
  for (const name of [undefined, null, "", "   ", "x".repeat(101), 123])
    assert.throws(
      () => mfa.rename(enrolled.session.token, "passkey-one", name),
      /passkey name/,
    );
  assert.throws(
    () => mfa.rename(otherSession.token, "passkey-one", "Stolen"),
    /Verification failed/,
  );
  assert.throws(
    () => mfa.rename(enrolled.session.token, "missing", "Missing"),
    /Verification failed/,
  );
  const totp = mfa.status(principal).factors.find((f) => f.kind === "totp");
  assert.throws(
    () => mfa.rename(enrolled.session.token, totp.id, "Not a passkey"),
    /Verification failed/,
  );
  const renamed = mfa.rename(
    enrolled.session.token,
    "passkey-one",
    "  Personal phone  ",
  );
  assert.equal(renamed.saved, true);
  assert.equal(
    renamed.status.factors.find((f) => f.id === "passkey-one").name,
    "Personal phone",
  );
  assert.deepEqual(
    {
      ...control.db
        .prepare("SELECT * FROM mfa_factors WHERE id='passkey-one'")
        .get(),
    },
    { ...before, name: "Personal phone" },
  );
  assert.deepEqual(snapshot(), original);
  assert.equal(
    control.db
      .prepare(
        "SELECT actor FROM audit WHERE action='mfa:rename-passkey' AND target='passkey-one'",
      )
      .get().actor,
    principal,
  );
  control.db
    .prepare("UPDATE mfa_sessions SET primary_at=? WHERE hash=?")
    .run(Date.now() - 6 * 60000, digest(enrolled.session.token));
  assert.throws(
    () => mfa.rename(enrolled.session.token, "passkey-one", "Stale"),
    /Sign out/,
  );
});
