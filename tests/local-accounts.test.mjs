import test from "node:test";
import assert from "node:assert/strict";
import { ControlStore } from "../src/control-store.mjs";
import { hashPassword, verifyPassword } from "../src/passwords.mjs";
import { oidcSettings, GOOGLE_ISSUER, configuredOIDC } from "../src/authn.mjs";

test("Google config uses direct identity and can coexist with independent local accounts", () => {
  const config = oidcSettings({
    WIKI_GOOGLE_CLIENT_ID: "synthetic",
    WIKI_GOOGLE_CLIENT_SECRET: "synthetic-secret",
  });
  assert.equal(config.issuer, GOOGLE_ISSUER);
  assert.equal(config.hd, undefined);
  assert.equal(
    oidcSettings({
      WIKI_GOOGLE_CLIENT_ID: "synthetic",
      WIKI_GOOGLE_CLIENT_SECRET: "synthetic-secret",
      WIKI_GOOGLE_WORKSPACE_DOMAIN: "example.com",
    }).hd,
    "example.com",
  );
  assert.equal(
    configuredOIDC(config, "https://wiki.example").label,
    "Continue with Google",
  );
  assert.equal(oidcSettings({}), null);
  assert.throws(() => oidcSettings({ WIKI_GOOGLE_CLIENT_ID: "incomplete" }));
  assert.throws(() =>
    oidcSettings({ WIKI_GOOGLE_WORKSPACE_DOMAIN: "example.com" }),
  );
  assert.throws(() =>
    oidcSettings({
      WIKI_GOOGLE_CLIENT_ID: "synthetic",
      WIKI_GOOGLE_CLIENT_SECRET: "synthetic-secret",
      WIKI_GOOGLE_WORKSPACE_DOMAIN: "Example.COM",
    }),
  );
  assert.throws(() =>
    oidcSettings({
      ...{ WIKI_GOOGLE_CLIENT_ID: "id", WIKI_GOOGLE_CLIENT_SECRET: "secret" },
      WIKI_OIDC_ISSUER: "https://other.example",
    }),
  );
});

test("Workspace reader enrollment is opt-in and requires the restricted Google preset", () => {
  const google = {
    WIKI_GOOGLE_CLIENT_ID: "synthetic",
    WIKI_GOOGLE_CLIENT_SECRET: "synthetic-secret",
    WIKI_GOOGLE_WORKSPACE_DOMAIN: "example.com",
  };
  const setting = "WIKI_GOOGLE_WORKSPACE_READER_ENROLLMENT";
  assert.equal(
    configuredOIDC(oidcSettings(google), "https://wiki.example").enrollReader,
    false,
  );
  assert.equal(
    configuredOIDC(
      oidcSettings({ ...google, [setting]: "0" }),
      "https://wiki.example",
    ).enrollReader,
    false,
  );
  assert.equal(
    configuredOIDC(
      oidcSettings({ ...google, [setting]: "1" }),
      "https://wiki.example",
    ).enrollReader,
    true,
  );
  for (const env of [
    { [setting]: "1" },
    { ...google, WIKI_GOOGLE_WORKSPACE_DOMAIN: "", [setting]: "1" },
    { ...google, WIKI_GOOGLE_CLIENT_SECRET: "", [setting]: "1" },
    { ...google, [setting]: "reader" },
    { ...google, [setting]: "1", WIKI_OIDC_ISSUER: "https://id.example" },
    {
      WIKI_OIDC_ISSUER: "https://id.example",
      WIKI_OIDC_CLIENT_ID: "id",
      WIKI_OIDC_CLIENT_SECRET: "secret",
      [setting]: "1",
    },
  ])
    assert.throws(() => oidcSettings(env));
});

test("first reader enrollment is atomic and preserves explicit access decisions", (t) => {
  const control = new ControlStore(":memory:");
  t.after(() => control.close());
  const owner = control.bootstrap({
    issuer: GOOGLE_ISSUER,
    subject: "owner",
    name: "Owner",
  });
  const identity = { issuer: GOOGLE_ISSUER, subject: "reader", name: "Reader" };
  const local = control.inviteLocal(owner, "reader@example.com", "Reader");
  const reader = control.enroll(
    { ...identity, email: "reader@example.com" },
    { reader: true },
  );
  assert.notEqual(reader.id, local.id);
  assert.equal(control.role(local.id), null);
  assert.equal(control.role(reader.id), "reader");
  assert.equal(
    control.db
      .prepare("SELECT count(*) n FROM organization_members WHERE principal=?")
      .get(reader.id).n,
    0,
  );
  assert.equal(
    control.db
      .prepare("SELECT count(*) n FROM group_members WHERE principal=?")
      .get(reader.id).n,
    0,
  );
  for (const role of ["reader", "editor", "manager", null]) {
    control.grant(owner, reader.id, role);
    assert.equal(control.enroll(identity, { reader: true }).id, reader.id);
    assert.equal(control.role(reader.id), role);
  }
  assert.equal(
    control.db
      .prepare(
        "SELECT count(*) n FROM audit WHERE action='enroll:reader' AND target=?",
      )
      .get(reader.id).n,
    1,
  );
  const existing = control.enroll({ ...identity, subject: "existing" });
  control.enroll({ ...identity, subject: "existing" }, { reader: true });
  assert.equal(control.role(existing.id), null);
  control.db
    .prepare("UPDATE principals SET active=0 WHERE id=?")
    .run(reader.id);
  assert.throws(() => control.enroll(identity, { reader: true }), /disabled/);
  for (const table of ["grants", "audit"]) {
    control.db.exec(
      `CREATE TRIGGER fail_enrollment BEFORE INSERT ON ${table} BEGIN SELECT RAISE(ABORT, 'synthetic failure'); END;`,
    );
    assert.throws(
      () =>
        control.enroll({ ...identity, subject: "rollback" }, { reader: true }),
      /synthetic failure/,
    );
    assert.equal(control.identity(GOOGLE_ISSUER, "rollback"), undefined);
    assert.equal(
      control.db.prepare("SELECT count(*) n FROM principals").get().n,
      4,
    );
    control.db.exec("DROP TRIGGER fail_enrollment");
  }
});

test("local invitations, hashing, single use, revocation and reset preserve identity boundaries", async (t) => {
  const control = new ControlStore(":memory:");
  t.after(() => control.close());
  const owner = control.bootstrap({
    issuer: GOOGLE_ISSUER,
    subject: "owner",
    name: "Owner",
  });
  const invited = control.inviteLocal(
    owner,
    " Reader@example.invalid ",
    "Reader",
  );
  const password = "synthetic only long password";
  const encoded = await hashPassword(password);
  assert.notEqual(encoded, password);
  assert.equal(await verifyPassword(password, encoded), true);
  assert.equal(await verifyPassword("wrong", encoded), false);
  assert.equal(await verifyPassword(password, null), false);
  await assert.rejects(() => hashPassword("short"));
  assert.equal(control.role(invited.id), null);
  const session = control.acceptInvitation(invited.token, encoded);
  assert.equal(control.authenticate(session.token).id, invited.id);
  assert.throws(() => control.acceptInvitation(invited.token, encoded));
  assert.equal(
    control.db
      .prepare("SELECT count(*) n FROM group_members WHERE principal=?")
      .get(invited.id).n,
    0,
  );
  assert.throws(() =>
    control.inviteLocal(invited.id, "other@example.invalid", "Other"),
  );
  assert.throws(() =>
    control.inviteLocal(owner, "reader@example.invalid", "Duplicate"),
  );
  const google = control.enroll({
    issuer: GOOGLE_ISSUER,
    subject: "separate-google",
    name: "Reader",
    email: "reader@example.invalid",
  });
  assert.notEqual(google.id, invited.id);
  assert.equal(control.role(google.id), null);
  const reset = control.resetLocal("reader@example.invalid");
  assert.equal(control.authenticate(session.token), null);
  assert.throws(() => control.localSession(invited.id, encoded));
  control.db
    .prepare("UPDATE invitations SET expires=0 WHERE principal=?")
    .run(invited.id);
  assert.throws(() => control.acceptInvitation(reset.token, encoded));
});

test("local bootstrap is explicit and rate limits survive independent requests", () => {
  const control = new ControlStore(":memory:");
  try {
    const setup = control.bootstrapLocal(
      "operator@example.invalid",
      "Operator",
    );
    assert.equal(control.role(setup.id), "manager");
    assert.throws(() =>
      control.bootstrapLocal("other@example.invalid", "Other"),
    );
    for (let i = 0; i < 10; i++) control.limitLogin("email:test");
    assert.throws(() => control.limitLogin("email:test"), { status: 429 });
    control.db.exec("UPDATE login_limits SET expires=0");
    assert.doesNotThrow(() => control.limitLogin("email:test"));
  } finally {
    control.close();
  }
});
