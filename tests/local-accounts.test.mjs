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
    configuredOIDC(config, "https://wiki.example").label,
    "Continue with Google",
  );
  assert.equal(oidcSettings({}), null);
  assert.throws(() => oidcSettings({ WIKI_GOOGLE_CLIENT_ID: "incomplete" }));
  assert.throws(() =>
    oidcSettings({
      ...{ WIKI_GOOGLE_CLIENT_ID: "id", WIKI_GOOGLE_CLIENT_SECRET: "secret" },
      WIKI_OIDC_ISSUER: "https://other.example",
    }),
  );
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
