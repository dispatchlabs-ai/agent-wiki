#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { generateKeyPairSync, randomUUID } from "node:crypto";
import { parseArgs } from "node:util";
const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    origin: { type: "string" },
    name: { type: "string" },
    agent: { type: "string" },
    days: { type: "string" },
    "until-revoked": { type: "boolean", default: false },
    role: { type: "string", default: "reader" },
  },
});
if (
  positionals.length !== 1 ||
  !values.origin ||
  !values.name ||
  !["reader", "editor"].includes(values.role)
)
  throw Error(
    "Usage: node scripts/agent-keygen.mjs /absolute/researcher.json --origin https://wiki.example.org --name Researcher [--role editor] [--agent EXISTING-ID] [--days 90 | --until-revoked]",
  );
const origin = new URL(values.origin);
if (
  origin.origin !== values.origin ||
  (origin.protocol !== "https:" &&
    !(
      origin.protocol === "http:" &&
      ["127.0.0.1", "localhost", "[::1]"].includes(origin.hostname)
    ))
)
  throw Error("Use an HTTPS origin or loopback development origin");
if (values["until-revoked"] && values.days !== undefined)
  throw Error("Choose days or until-revoked");
const days = Number(values.days ?? "90");
if (!Number.isInteger(days) || days < 1 || days > 365)
  throw Error("days must be 1–365");
const filename = path.resolve(positionals[0]);
const keyFile = filename.replace(/\.json$/, "") + ".key.pem";
const publicFile = filename.replace(/\.json$/, "") + ".public.json";
for (const file of [filename, keyFile, publicFile])
  if (fs.existsSync(file))
    throw Error("Output already exists; use a new filename for rotation");
fs.mkdirSync(path.dirname(filename), { recursive: true, mode: 0o700 });
const { publicKey, privateKey } = generateKeyPairSync("rsa", {
  modulusLength: 3072,
});
const agent = values.agent || randomUUID(),
  key = randomUUID();
const config = {
  version: 1,
  endpoint: origin.origin + "/mcp",
  agent,
  key,
  privateKeyFile: keyFile,
  scope:
    values.role === "editor"
      ? "wiki:read wiki:trace wiki:write"
      : "wiki:read wiki:trace",
};
const tools = [
  "wiki.search",
  "wiki.read",
  "wiki.history",
  "wiki.traceSearch",
  "wiki.traces",
  "wiki.trace",
  "wiki.file",
  "wiki.preview",
  ...(values.role === "editor" ? ["wiki.save"] : []),
];
const registration = {
  version: 1,
  agent,
  key,
  name: values.name,
  publicKey: { ...publicKey.export({ format: "jwk" }), alg: "RS256" },
  expiresAt: values["until-revoked"]
    ? null
    : new Date(Date.now() + days * 86400000).toISOString(),
  definition: {
    instructions:
      "Search maintained articles and original conversations; read relevant source passages and cite evidence.",
    tools,
  },
};
fs.writeFileSync(keyFile, privateKey.export({ type: "pkcs8", format: "pem" }), {
  flag: "wx",
  mode: 0o600,
});
fs.writeFileSync(publicFile, JSON.stringify(registration, null, 2) + "\n", {
  flag: "wx",
  mode: 0o600,
});
fs.writeFileSync(filename, JSON.stringify(config, null, 2) + "\n", {
  flag: "wx",
  mode: 0o600,
});
console.log(
  JSON.stringify({
    config: filename,
    publicRegistration: publicFile,
    privateKeyFile: keyFile,
    agent,
    key,
  }),
);
