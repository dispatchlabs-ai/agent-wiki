import fs from "node:fs";
import path from "node:path";
import {
  randomBytes,
  randomUUID,
  createHash,
  createCipheriv,
  createDecipheriv,
} from "node:crypto";
import * as OTPAuth from "otpauth";
import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} from "@simplewebauthn/server";
import { WikiError } from "./errors.mjs";

const hash = (value) => createHash("sha256").update(value).digest("hex");
const token = () => randomBytes(32).toString("base64url");
const minutes = (n) => n * 60 * 1000;
const invalid = () =>
  new WikiError(
    "INVALID_SECOND_FACTOR",
    "Verification failed or expired. Try again.",
    401,
  );

export function installMfaSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS mfa_factors(id TEXT PRIMARY KEY, principal TEXT NOT NULL REFERENCES principals(id), kind TEXT NOT NULL CHECK(kind IN ('totp','passkey')), name TEXT NOT NULL, data TEXT NOT NULL, counter INTEGER NOT NULL DEFAULT -1, created INTEGER NOT NULL);
    CREATE UNIQUE INDEX IF NOT EXISTS mfa_one_totp ON mfa_factors(principal) WHERE kind='totp';
    CREATE TABLE IF NOT EXISTS mfa_recovery(hash TEXT PRIMARY KEY, principal TEXT NOT NULL REFERENCES principals(id));
    CREATE TABLE IF NOT EXISTS mfa_sessions(hash TEXT PRIMARY KEY, principal TEXT NOT NULL REFERENCES principals(id), primary_at INTEGER NOT NULL, mfa_at INTEGER NOT NULL, expires INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS mfa_pending(hash TEXT PRIMARY KEY, principal TEXT NOT NULL REFERENCES principals(id), csrf TEXT NOT NULL, destination TEXT NOT NULL, password_hash TEXT, primary_at INTEGER NOT NULL, expires INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS mfa_challenges(hash TEXT PRIMARY KEY, principal TEXT NOT NULL REFERENCES principals(id), owner TEXT NOT NULL, kind TEXT NOT NULL, data TEXT NOT NULL, expires INTEGER NOT NULL);
    CREATE TRIGGER IF NOT EXISTS mfa_session_guard BEFORE INSERT ON sessions
    WHEN EXISTS(SELECT 1 FROM mfa_factors WHERE principal=NEW.principal)
      AND NOT EXISTS(SELECT 1 FROM mfa_sessions WHERE hash=NEW.hash AND principal=NEW.principal AND mfa_at>0 AND expires>CAST(strftime('%s','now') AS INTEGER)*1000)
    BEGIN SELECT RAISE(ABORT, 'Second factor required'); END;
  `);
}

/** Human second factors. Agent credentials remain a separate authorization path. */
export class Mfa {
  constructor(control, origin) {
    this.control = control;
    this.db = control.db;
    this.origin = origin;
    this.rpID = new URL(origin).hostname;
    this.memoryKey = null;
  }
  enabled(principal) {
    return !!this.db
      .prepare("SELECT 1 FROM mfa_factors WHERE principal=?")
      .get(principal);
  }
  status(principal) {
    return {
      enabled: this.enabled(principal),
      factors: this.db
        .prepare(
          "SELECT id,kind,name,created FROM mfa_factors WHERE principal=? ORDER BY created,id",
        )
        .all(principal),
      recoveryCodes: Number(
        this.db
          .prepare("SELECT count(*) n FROM mfa_recovery WHERE principal=?")
          .get(principal).n,
      ),
    };
  }
  cleanup() {
    const now = Date.now();
    this.db.prepare("DELETE FROM mfa_pending WHERE expires<=?").run(now);
    this.db.prepare("DELETE FROM mfa_challenges WHERE expires<=?").run(now);
    this.db.prepare("DELETE FROM mfa_sessions WHERE expires<=?").run(now);
  }
  active(principal) {
    if (
      !this.db
        .prepare(
          "SELECT 1 FROM principals WHERE id=? AND kind='human' AND active=1",
        )
        .get(principal)
    )
      throw invalid();
  }
  fresh(sessionToken) {
    const actor = this.control.authenticate(sessionToken);
    const proof =
      actor &&
      this.db
        .prepare("SELECT * FROM mfa_sessions WHERE hash=?")
        .get(hash(sessionToken));
    if (
      !actor ||
      !proof ||
      Number(proof.primary_at) < Date.now() - minutes(5) ||
      (this.enabled(actor.id) && Number(proof.mfa_at) < Date.now() - minutes(5))
    ) {
      throw new WikiError(
        "FRESH_SIGN_IN_REQUIRED",
        "Sign out and sign in again before changing two-factor authentication.",
        403,
      );
    }
    return actor;
  }
  audit(principal, action, target = principal) {
    this.db
      .prepare("INSERT INTO audit(actor,action,target) VALUES (?,?,?)")
      .run(principal, action, target);
  }
  clearTransient(principal) {
    this.db.prepare("DELETE FROM sessions WHERE principal=?").run(principal);
    this.db
      .prepare("DELETE FROM mfa_sessions WHERE principal=?")
      .run(principal);
    this.db.prepare("DELETE FROM mfa_pending WHERE principal=?").run(principal);
    this.db
      .prepare("DELETE FROM mfa_challenges WHERE principal=?")
      .run(principal);
  }
  beginSignIn(principal, destination = "/", passwordHash = null) {
    this.active(principal);
    this.cleanup();
    if (!this.enabled(principal))
      return { session: this.control.session(principal) };
    const pending = token(),
      csrf = token(),
      now = Date.now();
    this.db
      .prepare("INSERT INTO mfa_pending VALUES (?,?,?,?,?,?,?)")
      .run(
        hash(pending),
        principal,
        csrf,
        destination,
        passwordHash === null ? null : hash(passwordHash),
        now,
        now + minutes(5),
      );
    return { pending, csrf, mfaRequired: true };
  }
  pending(pendingToken) {
    if (!pendingToken) throw invalid();
    const row = this.db
      .prepare("SELECT * FROM mfa_pending WHERE hash=? AND expires>?")
      .get(hash(pendingToken), Date.now());
    if (!row) throw invalid();
    this.active(row.principal);
    if (row.password_hash !== null) {
      const current = this.db
        .prepare("SELECT password FROM local_accounts WHERE principal=?")
        .get(row.principal);
      if (!current?.password || hash(current.password) !== row.password_hash)
        throw invalid();
    }
    if (!this.enabled(row.principal)) throw invalid();
    return row;
  }
  complete(pendingToken, verify) {
    return this.control.transaction(() => {
      const pending = this.pending(pendingToken);
      verify(pending.principal);
      this.db
        .prepare("DELETE FROM mfa_pending WHERE hash=?")
        .run(hash(pendingToken));
      this.db
        .prepare("DELETE FROM mfa_challenges WHERE owner=?")
        .run("pending:" + hash(pendingToken));
      this.audit(pending.principal, "mfa:sign-in");
      return {
        session: this.control.session(pending.principal, undefined, {
          primaryAt: Number(pending.primary_at),
          mfaAt: Date.now(),
        }),
        destination: pending.destination,
      };
    });
  }
  encryptionKey(create = false) {
    if (this.control.filename === ":memory:")
      return (this.memoryKey ||= randomBytes(32));
    const filename = this.control.filename + ".mfa-key";
    try {
      const fd = fs.openSync(
        filename,
        fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW,
      );
      try {
        const stat = fs.fstatSync(fd);
        if (!stat.isFile() || stat.size !== 32 || stat.mode & 0o077)
          throw Error("Invalid MFA key permissions or length");
        return fs.readFileSync(fd);
      } finally {
        fs.closeSync(fd);
      }
    } catch (error) {
      if (
        error.code !== "ENOENT" ||
        !create ||
        this.db.prepare("SELECT 1 FROM mfa_factors WHERE kind='totp'").get() ||
        this.db
          .prepare("SELECT 1 FROM mfa_challenges WHERE kind='totp-enroll'")
          .get()
      ) {
        throw new WikiError(
          "MFA_KEY_UNAVAILABLE",
          "Authenticator storage is unavailable. Contact the wiki operator.",
          503,
        );
      }
      const key = randomBytes(32);
      const fd = fs.openSync(
        filename,
        fs.constants.O_WRONLY |
          fs.constants.O_CREAT |
          fs.constants.O_EXCL |
          fs.constants.O_NOFOLLOW,
        0o600,
      );
      try {
        fs.writeFileSync(fd, key);
        fs.fsyncSync(fd);
      } finally {
        fs.closeSync(fd);
      }
      const directory = fs.openSync(
        path.dirname(filename),
        fs.constants.O_RDONLY,
      );
      try {
        fs.fsyncSync(directory);
      } finally {
        fs.closeSync(directory);
      }
      return key;
    }
  }
  seal(principal, value) {
    const key = this.encryptionKey(true),
      iv = randomBytes(12),
      cipher = createCipheriv("aes-256-gcm", key, iv);
    cipher.setAAD(Buffer.from(principal));
    const ciphertext = Buffer.concat([
      cipher.update(value, "utf8"),
      cipher.final(),
    ]);
    return JSON.stringify({
      keyId: hash(key),
      iv: iv.toString("base64"),
      tag: cipher.getAuthTag().toString("base64"),
      ciphertext: ciphertext.toString("base64"),
    });
  }
  unseal(principal, value) {
    const data = JSON.parse(value),
      decipher = createDecipheriv(
        "aes-256-gcm",
        this.encryptionKey(),
        Buffer.from(data.iv, "base64"),
      );
    decipher.setAAD(Buffer.from(principal));
    decipher.setAuthTag(Buffer.from(data.tag, "base64"));
    return Buffer.concat([
      decipher.update(Buffer.from(data.ciphertext, "base64")),
      decipher.final(),
    ]).toString("utf8");
  }
  totp(principal, secretValue) {
    return new OTPAuth.TOTP({
      issuer: "Agent Wiki (" + this.rpID + ")",
      label: principal,
      algorithm: "SHA1",
      digits: 6,
      period: 30,
      secret: OTPAuth.Secret.fromBase32(secretValue),
    });
  }
  totpCounter(principal, secretValue, code) {
    if (typeof code !== "string" || !/^\d{6}$/.test(code)) throw invalid();
    const timestamp = Date.now(),
      totp = this.totp(principal, secretValue);
    const delta = totp.validate({ token: code, window: 1, timestamp });
    if (delta === null) throw invalid();
    return Math.floor(timestamp / 30000) + delta;
  }
  challenge(principal, owner, kind, data) {
    const flow = token();
    this.cleanup();
    this.db
      .prepare("INSERT INTO mfa_challenges VALUES (?,?,?,?,?,?)")
      .run(
        hash(flow),
        principal,
        owner,
        kind,
        JSON.stringify(data),
        Date.now() + minutes(5),
      );
    return flow;
  }
  readChallenge(flow, principal, owner, kind) {
    if (typeof flow !== "string" || flow.length > 100) throw invalid();
    const row = this.db
      .prepare(
        "SELECT data FROM mfa_challenges WHERE hash=? AND principal=? AND owner=? AND kind=? AND expires>?",
      )
      .get(hash(flow), principal, owner, kind, Date.now());
    if (!row) throw invalid();
    return JSON.parse(row.data);
  }
  consumeChallenge(flow, principal, owner, kind) {
    const data = this.readChallenge(flow, principal, owner, kind);
    this.db.prepare("DELETE FROM mfa_challenges WHERE hash=?").run(hash(flow));
    return data;
  }
  recovery(principal) {
    this.db
      .prepare("DELETE FROM mfa_recovery WHERE principal=?")
      .run(principal);
    const codes = Array.from({ length: 10 }, () =>
      randomBytes(16).toString("hex").match(/.{8}/g).join("-"),
    );
    const insert = this.db.prepare("INSERT INTO mfa_recovery VALUES (?,?)");
    for (const code of codes)
      insert.run(hash(code.replaceAll("-", "")), principal);
    return codes;
  }
  changed(principal, firstFactor, actor, verified = false) {
    const recoveryCodes = firstFactor ? this.recovery(principal) : undefined;
    this.clearTransient(principal);
    return {
      session: this.control.session(
        principal,
        Math.max(0, Number(actor.expires) - Date.now()),
        {
          primaryAt: Number(actor.primary_at),
          mfaAt: verified ? Date.now() : Number(actor.mfa_at),
        },
      ),
      ...(recoveryCodes ? { recoveryCodes } : {}),
    };
  }
  beginTotp(sessionToken) {
    const actor = this.fresh(sessionToken);
    if (this.status(actor.id).factors.some((x) => x.kind === "totp"))
      throw new WikiError(
        "FACTOR_EXISTS",
        "An authenticator app is already enrolled.",
        409,
      );
    const value = new OTPAuth.Secret({ size: 20 }).base32;
    const encrypted = this.seal(actor.id, value);
    const flow = this.challenge(
      actor.id,
      "session:" + hash(sessionToken),
      "totp-enroll",
      { encrypted },
    );
    return { flow, secret: value, uri: this.totp(actor.id, value).toString() };
  }
  finishTotp(sessionToken, flow, code) {
    const actor = this.fresh(sessionToken),
      owner = "session:" + hash(sessionToken);
    this.control.limitLogin("mfa:" + actor.id);
    const data = this.readChallenge(flow, actor.id, owner, "totp-enroll");
    const counter = this.totpCounter(
      actor.id,
      this.unseal(actor.id, data.encrypted),
      code,
    );
    return this.control.transaction(() => {
      this.fresh(sessionToken);
      this.consumeChallenge(flow, actor.id, owner, "totp-enroll");
      const first = !this.enabled(actor.id);
      this.db
        .prepare("INSERT INTO mfa_factors VALUES (?,?, 'totp',?,?,?,?)")
        .run(
          randomUUID(),
          actor.id,
          "Authenticator app",
          data.encrypted,
          counter,
          Date.now(),
        );
      this.audit(actor.id, "mfa:enroll-totp");
      return this.changed(actor.id, first, actor, true);
    });
  }
  verifyCode(pendingToken, code, recovery = false) {
    const pending = this.pending(pendingToken);
    this.control.limitLogin("mfa:" + pending.principal);
    return this.complete(pendingToken, (principal) => {
      if (recovery) {
        if (typeof code !== "string" || !/^[a-f0-9-]{32,40}$/i.test(code))
          throw invalid();
        const result = this.db
          .prepare("DELETE FROM mfa_recovery WHERE hash=? AND principal=?")
          .run(hash(code.replaceAll("-", "").toLowerCase()), principal);
        if (!result.changes) throw invalid();
        this.audit(principal, "mfa:recovery-used");
      } else {
        const factor = this.db
          .prepare(
            "SELECT * FROM mfa_factors WHERE principal=? AND kind='totp'",
          )
          .get(principal);
        if (!factor) throw invalid();
        const counter = this.totpCounter(
          principal,
          this.unseal(principal, factor.data),
          code,
        );
        if (counter <= Number(factor.counter)) throw invalid();
        this.db
          .prepare("UPDATE mfa_factors SET counter=? WHERE id=?")
          .run(counter, factor.id);
      }
    });
  }
  async beginPasskey(sessionToken) {
    const actor = this.fresh(sessionToken);
    const credentials = this.db
      .prepare(
        "SELECT data FROM mfa_factors WHERE principal=? AND kind='passkey'",
      )
      .all(actor.id)
      .map((x) => JSON.parse(x.data));
    const options = await generateRegistrationOptions({
      rpName: "Agent Wiki",
      rpID: this.rpID,
      userID: Buffer.from(actor.id),
      userName: actor.name + " (" + actor.id.slice(0, 8) + ")",
      attestationType: "none",
      excludeCredentials: credentials.map((x) => ({
        id: x.id,
        transports: x.transports,
      })),
      authenticatorSelection: {
        residentKey: "preferred",
        userVerification: "required",
      },
    });
    this.fresh(sessionToken);
    const flow = this.challenge(
      actor.id,
      "session:" + hash(sessionToken),
      "passkey-enroll",
      { challenge: options.challenge },
    );
    return { flow, options };
  }
  async finishPasskey(sessionToken, flow, response, name) {
    const actor = this.fresh(sessionToken),
      owner = "session:" + hash(sessionToken);
    if (name !== undefined) this.passkeyName(name);
    this.control.limitLogin("mfa:" + actor.id);
    const data = this.consumeChallenge(flow, actor.id, owner, "passkey-enroll");
    let verification;
    try {
      verification = await verifyRegistrationResponse({
        response,
        expectedChallenge: data.challenge,
        expectedOrigin: this.origin,
        expectedRPID: this.rpID,
        requireUserVerification: true,
      });
    } catch {
      throw invalid();
    }
    if (!verification.verified || !verification.registrationInfo)
      throw invalid();
    const info = verification.registrationInfo,
      credential = info.credential;
    return this.control.transaction(() => {
      this.fresh(sessionToken);
      const first = !this.enabled(actor.id);
      if (
        this.db
          .prepare("SELECT 1 FROM mfa_factors WHERE id=?")
          .get(credential.id)
      )
        throw invalid();
      this.db
        .prepare("INSERT INTO mfa_factors VALUES (?,?, 'passkey',?,?,?,?)")
        .run(
          credential.id,
          actor.id,
          name === undefined ? this.defaultPasskeyName(actor.id) : name.trim(),
          JSON.stringify({
            id: credential.id,
            publicKey: Buffer.from(credential.publicKey).toString("base64"),
            transports: credential.transports,
            deviceType: info.credentialDeviceType,
            backedUp: info.credentialBackedUp,
          }),
          credential.counter,
          Date.now(),
        );
      this.audit(actor.id, "mfa:enroll-passkey", credential.id);
      return this.changed(actor.id, first, actor, true);
    });
  }
  passkeyName(name) {
    if (typeof name !== "string" || !name.trim() || name.length > 100)
      throw new WikiError(
        "INVALID_NAME",
        "Use a passkey name between 1 and 100 characters.",
        400,
      );
    return name.trim();
  }
  defaultPasskeyName(principal) {
    const names = new Set(this.status(principal).factors.map((f) => f.name));
    let number = 1;
    while (names.has(`Passkey ${number}`)) number++;
    return `Passkey ${number}`;
  }
  rename(sessionToken, factorID, name) {
    return this.control.transaction(() => {
      const actor = this.fresh(sessionToken);
      const label = this.passkeyName(name);
      const result = this.db
        .prepare(
          "UPDATE mfa_factors SET name=? WHERE id=? AND principal=? AND kind='passkey'",
        )
        .run(label, factorID, actor.id);
      if (!result.changes) throw invalid();
      this.audit(actor.id, "mfa:rename-passkey", factorID);
      return { saved: true, status: this.status(actor.id) };
    });
  }
  async authenticationOptions(pendingToken) {
    const pending = this.pending(pendingToken);
    const credentials = this.db
      .prepare(
        "SELECT data FROM mfa_factors WHERE principal=? AND kind='passkey'",
      )
      .all(pending.principal)
      .map((x) => JSON.parse(x.data));
    if (!credentials.length) throw invalid();
    const options = await generateAuthenticationOptions({
      rpID: this.rpID,
      userVerification: "required",
      allowCredentials: credentials.map((x) => ({
        id: x.id,
        transports: x.transports,
      })),
    });
    this.pending(pendingToken);
    const flow = this.challenge(
      pending.principal,
      "pending:" + hash(pendingToken),
      "passkey-login",
      { challenge: options.challenge },
    );
    return { flow, options };
  }
  async verifyPasskey(pendingToken, flow, response) {
    const pending = this.pending(pendingToken),
      owner = "pending:" + hash(pendingToken);
    this.control.limitLogin("mfa:" + pending.principal);
    const data = this.consumeChallenge(
      flow,
      pending.principal,
      owner,
      "passkey-login",
    );
    if (typeof response?.id !== "string") throw invalid();
    if (
      response.response?.userHandle != null &&
      response.response.userHandle !==
        Buffer.from(pending.principal).toString("base64url")
    )
      throw invalid();
    const factor = this.db
      .prepare(
        "SELECT * FROM mfa_factors WHERE id=? AND principal=? AND kind='passkey'",
      )
      .get(response.id, pending.principal);
    if (!factor) throw invalid();
    const credential = JSON.parse(factor.data);
    let verification;
    try {
      verification = await verifyAuthenticationResponse({
        response,
        expectedChallenge: data.challenge,
        expectedOrigin: this.origin,
        expectedRPID: this.rpID,
        requireUserVerification: true,
        credential: {
          id: factor.id,
          publicKey: new Uint8Array(
            Buffer.from(credential.publicKey, "base64"),
          ),
          counter: Number(factor.counter),
          transports: credential.transports,
        },
      });
    } catch {
      throw invalid();
    }
    if (!verification.verified) throw invalid();
    return this.complete(pendingToken, (principal) => {
      const result = this.db
        .prepare(
          "UPDATE mfa_factors SET counter=? WHERE id=? AND principal=? AND counter=?",
        )
        .run(
          verification.authenticationInfo.newCounter,
          factor.id,
          principal,
          factor.counter,
        );
      if (!result.changes) throw invalid();
    });
  }
  remove(sessionToken, factorID) {
    return this.control.transaction(() => {
      const actor = this.fresh(sessionToken),
        status = this.status(actor.id);
      if (!status.factors.some((x) => x.id === factorID)) throw invalid();
      if (status.factors.length === 1)
        throw new WikiError(
          "LAST_FACTOR",
          "Use Turn off two-factor authentication to remove your last method.",
          409,
        );
      this.db
        .prepare("DELETE FROM mfa_factors WHERE id=? AND principal=?")
        .run(factorID, actor.id);
      this.audit(actor.id, "mfa:remove", factorID);
      return this.changed(actor.id, false, actor);
    });
  }
  regenerate(sessionToken) {
    return this.control.transaction(() => {
      const actor = this.fresh(sessionToken);
      if (!this.enabled(actor.id)) throw invalid();
      const recoveryCodes = this.recovery(actor.id);
      this.audit(actor.id, "mfa:recovery-regenerate");
      return { ...this.changed(actor.id, false, actor), recoveryCodes };
    });
  }
  disable(sessionToken) {
    return this.control.transaction(() => {
      const actor = this.fresh(sessionToken);
      this.db
        .prepare("DELETE FROM mfa_factors WHERE principal=?")
        .run(actor.id);
      this.db
        .prepare("DELETE FROM mfa_recovery WHERE principal=?")
        .run(actor.id);
      this.clearTransient(actor.id);
      this.audit(actor.id, "mfa:disable");
      return {
        session: this.control.session(
          actor.id,
          Math.max(0, Number(actor.expires) - Date.now()),
          { primaryAt: Number(actor.primary_at) },
        ),
      };
    });
  }
}
