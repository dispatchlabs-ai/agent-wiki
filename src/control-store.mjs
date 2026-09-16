import { DatabaseSync } from "node:sqlite";
import { randomBytes, randomUUID, createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { WikiError } from "./errors.mjs";
export const LOCAL_ISSUER = "urn:agentic-wiki:local";
export function localEmail(value) {
  if (
    typeof value !== "string" ||
    value.length > 254 ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim())
  )
    throw new WikiError("INVALID_EMAIL", "Enter a valid email address.", 400);
  return value.trim().toLowerCase();
}
export const digest = (value) =>
  createHash("sha256").update(value).digest("hex");
export const secret = () => randomBytes(32).toString("base64url");
export class ControlStore {
  constructor(filename) {
    if (!filename) throw Error("A control database is required");
    filename = filename === ":memory:" ? filename : path.resolve(filename);
    this.filename = filename;
    if (filename !== ":memory:") {
      const fd = fs.openSync(filename, "a", 0o600);
      fs.closeSync(fd);
      fs.chmodSync(filename, 0o600);
    }
    this.db = new DatabaseSync(filename);
    this.db
      .exec(`PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA busy_timeout=10000;
      CREATE TABLE IF NOT EXISTS principals(id TEXT PRIMARY KEY, kind TEXT NOT NULL CHECK(kind IN ('human','agent')), name TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1);
      CREATE TABLE IF NOT EXISTS identities(issuer TEXT NOT NULL, subject TEXT NOT NULL, principal TEXT NOT NULL REFERENCES principals(id), PRIMARY KEY(issuer,subject));
      CREATE TABLE IF NOT EXISTS organizations(id TEXT PRIMARY KEY, name TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS organization_members(organization TEXT REFERENCES organizations(id), principal TEXT REFERENCES principals(id), PRIMARY KEY(organization,principal));
      CREATE TABLE IF NOT EXISTS groups(id TEXT PRIMARY KEY, organization TEXT NOT NULL REFERENCES organizations(id), name TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS group_members(group_id TEXT REFERENCES groups(id), principal TEXT REFERENCES principals(id), PRIMARY KEY(group_id,principal));
      CREATE TABLE IF NOT EXISTS spaces(id TEXT PRIMARY KEY, name TEXT NOT NULL, organization TEXT NOT NULL REFERENCES organizations(id));
      CREATE TABLE IF NOT EXISTS grants(space TEXT REFERENCES spaces(id), principal TEXT REFERENCES principals(id), role TEXT NOT NULL CHECK(role IN ('reader','editor','manager')), PRIMARY KEY(space,principal));
      CREATE TABLE IF NOT EXISTS sessions(hash TEXT PRIMARY KEY, principal TEXT NOT NULL REFERENCES principals(id), csrf TEXT NOT NULL, expires INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS logins(hash TEXT PRIMARY KEY, state TEXT NOT NULL, nonce TEXT NOT NULL, verifier TEXT NOT NULL, expires INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS login_destinations(hash TEXT PRIMARY KEY REFERENCES logins(hash) ON DELETE CASCADE, path TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS local_accounts(principal TEXT PRIMARY KEY REFERENCES principals(id), email TEXT UNIQUE NOT NULL, password TEXT);
      CREATE TABLE IF NOT EXISTS invitations(hash TEXT PRIMARY KEY, principal TEXT UNIQUE NOT NULL REFERENCES local_accounts(principal), expires INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS login_limits(key TEXT PRIMARY KEY, attempts INTEGER NOT NULL, expires INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS audit(id INTEGER PRIMARY KEY, time TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, actor TEXT NOT NULL, action TEXT NOT NULL, target TEXT NOT NULL);
    `);
  }
  transaction(fn) {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const result = fn();
      this.db.exec("COMMIT");
      return result;
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }
  bootstrap({
    issuer,
    subject,
    name,
    organization = "Organization",
    space = "Wiki",
    localAccount = null,
  }) {
    if (
      ![issuer, subject, name].every((v) => typeof v === "string" && v.trim())
    )
      throw Error("Explicit issuer, subject and name required");
    return this.transaction(() => {
      if (this.db.prepare("SELECT 1 FROM spaces").get())
        throw Error("Control store already initialized");
      const id = randomUUID();
      this.db
        .prepare("INSERT INTO principals(id,kind,name) VALUES (?,'human',?)")
        .run(id, name);
      this.db
        .prepare("INSERT INTO identities VALUES (?,?,?)")
        .run(issuer, subject, id);
      this.db
        .prepare("INSERT INTO organizations VALUES (?,?)")
        .run("default", organization);
      this.db
        .prepare("INSERT INTO organization_members VALUES (?,?)")
        .run("default", id);
      this.db
        .prepare("INSERT INTO spaces VALUES (?,?,?)")
        .run("default", space, "default");
      this.db
        .prepare("INSERT INTO grants VALUES (?,?,?)")
        .run("default", id, "manager");
      if (localAccount) return this.installLocal(id, localAccount);
      return id;
    });
  }
  identity(issuer, subject) {
    return this.db
      .prepare(
        "SELECT p.* FROM identities i JOIN principals p ON p.id=i.principal WHERE i.issuer=? AND i.subject=? AND p.active=1",
      )
      .get(issuer, subject);
  }
  enroll({ issuer, subject, name }) {
    return this.transaction(() => {
      const existing = this.identity(issuer, subject);
      if (existing) return existing;
      if (
        this.db
          .prepare("SELECT 1 FROM identities WHERE issuer=? AND subject=?")
          .get(issuer, subject)
      )
        throw Error("Identity disabled");
      const id = randomUUID();
      this.db
        .prepare("INSERT INTO principals(id,kind,name) VALUES (?,'human',?)")
        .run(id, name.slice(0, 200));
      this.db
        .prepare("INSERT INTO identities VALUES (?,?,?)")
        .run(issuer, subject, id);
      return { id, name, kind: "human", active: 1 };
    });
  }
  installLocal(principal, email) {
    const token = secret();
    this.db
      .prepare("INSERT INTO local_accounts(principal,email) VALUES (?,?)")
      .run(principal, email);
    this.db
      .prepare("INSERT INTO invitations VALUES (?,?,?)")
      .run(digest(token), principal, Date.now() + 24 * 60 * 60 * 1000);
    return { id: principal, token };
  }
  bootstrapLocal(email, name) {
    return this.bootstrap({
      issuer: LOCAL_ISSUER,
      subject: randomUUID(),
      name,
      localAccount: localEmail(email),
    });
  }
  inviteLocal(actor, email, name) {
    email = localEmail(email);
    if (typeof name !== "string" || !name.trim() || name.length > 200)
      throw new WikiError(
        "INVALID_NAME",
        "Enter a name, up to 200 characters.",
        400,
      );
    return this.transaction(() => {
      this.require(actor, "manager");
      if (
        this.db.prepare("SELECT 1 FROM local_accounts WHERE email=?").get(email)
      )
        throw new WikiError(
          "ACCOUNT_EXISTS",
          "This local account already exists.",
          409,
        );
      const id = randomUUID();
      this.db
        .prepare("INSERT INTO principals(id,kind,name) VALUES (?,'human',?)")
        .run(id, name.trim());
      this.db
        .prepare("INSERT INTO identities VALUES (?,?,?)")
        .run(LOCAL_ISSUER, id, id);
      const invite = this.installLocal(id, email);
      this.db
        .prepare("INSERT INTO audit(actor,action,target) VALUES (?,?,?)")
        .run(actor, "local-invite", id);
      return invite;
    });
  }
  invitation(token) {
    return this.db
      .prepare(
        "SELECT a.principal,a.email FROM invitations i JOIN local_accounts a ON a.principal=i.principal JOIN principals p ON p.id=a.principal WHERE i.hash=? AND i.expires>? AND p.active=1",
      )
      .get(digest(token || ""), Date.now());
  }
  acceptInvitation(token, password) {
    return this.transaction(() => {
      const invite = this.invitation(token);
      if (!invite)
        throw new WikiError(
          "INVALID_INVITATION",
          "This setup link is invalid or expired.",
          400,
        );
      this.db
        .prepare("UPDATE local_accounts SET password=? WHERE principal=?")
        .run(password, invite.principal);
      this.db
        .prepare("DELETE FROM invitations WHERE principal=?")
        .run(invite.principal);
      this.db
        .prepare("DELETE FROM sessions WHERE principal=?")
        .run(invite.principal);
      return this.session(invite.principal);
    });
  }
  localAccount(email) {
    return this.db
      .prepare(
        "SELECT a.*,p.active FROM local_accounts a JOIN principals p ON p.id=a.principal WHERE a.email=?",
      )
      .get(email);
  }
  localSession(principal, expectedPassword) {
    return this.transaction(() => {
      const current = this.db
        .prepare(
          "SELECT a.password,p.active FROM local_accounts a JOIN principals p ON p.id=a.principal WHERE a.principal=?",
        )
        .get(principal);
      if (!current?.active || current.password !== expectedPassword)
        throw new WikiError(
          "INVALID_LOGIN",
          "Email or password is incorrect.",
          401,
        );
      return this.session(principal);
    });
  }
  resetLocal(email) {
    // Trusted operator recovery only; space managers cannot reset existing users.
    email = localEmail(email);
    return this.transaction(() => {
      const account = this.localAccount(email);
      if (!account?.active) throw Error("Unknown active local account");
      const token = secret();
      this.db
        .prepare("UPDATE local_accounts SET password=NULL WHERE principal=?")
        .run(account.principal);
      this.db
        .prepare("DELETE FROM sessions WHERE principal=?")
        .run(account.principal);
      this.db
        .prepare("DELETE FROM invitations WHERE principal=?")
        .run(account.principal);
      this.db
        .prepare("INSERT INTO invitations VALUES (?,?,?)")
        .run(
          digest(token),
          account.principal,
          Date.now() + 24 * 60 * 60 * 1000,
        );
      this.db
        .prepare("INSERT INTO audit(actor,action,target) VALUES (?,?,?)")
        .run("operator", "local-reset", account.principal);
      return { id: account.principal, token };
    });
  }
  replacePassword(principal, expectedPassword, password) {
    return this.transaction(() => {
      const result = this.db
        .prepare(
          "UPDATE local_accounts SET password=? WHERE principal=? AND password=? AND principal IN (SELECT id FROM principals WHERE active=1)",
        )
        .run(password, principal, expectedPassword);
      if (!result.changes)
        throw new WikiError(
          "INVALID_LOGIN",
          "Account changed. Sign in again.",
          401,
        );
      this.db.prepare("DELETE FROM sessions WHERE principal=?").run(principal);
      return this.session(principal);
    });
  }
  limitLogin(identity, maximum = 10) {
    const key = digest(identity),
      now = Date.now();
    this.db.prepare("DELETE FROM login_limits WHERE expires<=?").run(now);
    if (
      Number(this.db.prepare("SELECT count(*) n FROM login_limits").get().n) >=
      10000
    )
      throw new WikiError(
        "AUTH_BUSY",
        "Sign-in is busy. Try again shortly.",
        429,
      );
    const row = this.db
      .prepare(
        "INSERT INTO login_limits VALUES (?,1,?) ON CONFLICT(key) DO UPDATE SET attempts=attempts+1 RETURNING attempts",
      )
      .get(key, now + 15 * 60 * 1000);
    if (Number(row.attempts) > maximum)
      throw new WikiError(
        "LOGIN_LIMIT",
        "Too many attempts. Try again in 15 minutes.",
        429,
      );
  }
  session(principal, ttl = 8 * 60 * 60 * 1000) {
    this.db.prepare("DELETE FROM sessions WHERE expires<=?").run(Date.now());
    const token = secret(),
      csrf = secret();
    this.db
      .prepare("INSERT INTO sessions VALUES (?,?,?,?)")
      .run(digest(token), principal, csrf, Date.now() + ttl);
    return { token, csrf };
  }
  authenticate(token) {
    if (!token) return null;
    return (
      this.db
        .prepare(
          "SELECT p.*,s.csrf,s.expires FROM sessions s JOIN principals p ON p.id=s.principal WHERE s.hash=? AND s.expires>? AND p.active=1 AND p.kind='human'",
        )
        .get(digest(token), Date.now()) || null
    );
  }
  logout(token) {
    if (token)
      this.db.prepare("DELETE FROM sessions WHERE hash=?").run(digest(token));
  }
  role(principal, space = "default") {
    return (
      this.db
        .prepare(
          "SELECT g.role FROM grants g JOIN principals p ON p.id=g.principal WHERE g.space=? AND g.principal=? AND p.active=1",
        )
        .get(space, principal)?.role || null
    );
  }
  require(principal, role = "reader") {
    if (
      ({ reader: 1, editor: 2, manager: 3 }[this.role(principal)] || 0) <
      { reader: 1, editor: 2, manager: 3 }[role]
    )
      throw new WikiError("NOT_FOUND", "Not found", 404);
  }
  access() {
    return this.db
      .prepare(
        "SELECT p.id,p.name,p.kind,i.issuer,i.subject,l.email,l.password IS NOT NULL AS local_ready,g.role FROM principals p LEFT JOIN identities i ON i.principal=p.id LEFT JOIN local_accounts l ON l.principal=p.id LEFT JOIN grants g ON g.principal=p.id AND g.space='default' WHERE p.active=1 ORDER BY p.name",
      )
      .all();
  }
  grant(actor, principal, role) {
    if (![null, "reader", "editor", "manager"].includes(role))
      throw new WikiError("INVALID_GRANT", "Invalid role", 400);
    return this.transaction(() => {
      this.require(actor, "manager");
      const target = this.db
        .prepare("SELECT kind FROM principals WHERE id=? AND active=1")
        .get(principal);
      if (!target) throw new WikiError("NOT_FOUND", "Not found", 404);
      if (target.kind === "agent" && role === "manager")
        throw new WikiError(
          "INVALID_GRANT",
          "Agent grants may be reader or editor; account management requires a human",
          400,
        );
      if (
        this.role(principal) === "manager" &&
        role !== "manager" &&
        Number(
          this.db
            .prepare(
              "SELECT count(*) n FROM grants g JOIN principals p ON p.id=g.principal WHERE g.role='manager' AND p.active=1",
            )
            .get().n,
        ) <= 1
      )
        throw new WikiError("LAST_MANAGER", "Keep at least one manager", 409);
      if (role)
        this.db
          .prepare(
            "INSERT INTO grants VALUES ('default',?,?) ON CONFLICT(space,principal) DO UPDATE SET role=excluded.role",
          )
          .run(principal, role);
      else
        this.db
          .prepare("DELETE FROM grants WHERE space='default' AND principal=?")
          .run(principal);
      this.db
        .prepare("INSERT INTO audit(actor,action,target) VALUES (?,?,?)")
        .run(actor, "grant:" + String(role), principal);
    });
  }
  login(destination = "/") {
    this.db.prepare("DELETE FROM logins WHERE expires<=?").run(Date.now());
    if (
      Number(this.db.prepare("SELECT count(*) n FROM logins").get().n) >= 1000
    )
      throw Error("Login capacity reached");
    const token = secret(),
      state = secret(),
      nonce = secret(),
      verifier = secret();
    this.db
      .prepare("INSERT INTO logins VALUES (?,?,?,?,?)")
      .run(digest(token), state, nonce, verifier, Date.now() + 300000);
    this.db
      .prepare("INSERT INTO login_destinations VALUES (?,?)")
      .run(digest(token), destination);
    return { token, state, nonce, verifier };
  }
  consumeLogin(token) {
    return this.transaction(() => {
      const row = this.db
        .prepare("SELECT * FROM logins WHERE hash=? AND expires>?")
        .get(digest(token || ""), Date.now());
      if (row)
        row.destination =
          this.db
            .prepare("SELECT path FROM login_destinations WHERE hash=?")
            .get(digest(token || ""))?.path || "/";
      this.db
        .prepare("DELETE FROM logins WHERE hash=?")
        .run(digest(token || ""));
      return row;
    });
  }
  close() {
    this.db.close();
  }
}
