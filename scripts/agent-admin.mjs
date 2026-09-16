#!/usr/bin/env node
import fs from "node:fs";
import { parseArgs } from "node:util";
import { ControlStore } from "../src/control-store.mjs";
import { AgentStore } from "../src/agent-store.mjs";
const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    owner: { type: "string" },
    role: { type: "string", default: "reader" },
    mode: { type: "string", default: "independent" },
  },
});
const [command, argument, key] = positionals;
const control = new ControlStore(process.env.WIKI_CONTROL);
const agents = new AgentStore(control);
try {
  let result;
  if (command === "people")
    result = control
      .access()
      .filter((principal) => principal.kind === "human")
      .map(({ id, name, issuer, subject, email, role }) => ({
        id,
        name,
        issuer,
        subject,
        email,
        role,
      }));
  else if (command === "register" && argument && values.owner)
    result = agents.enrollOperator(
      JSON.parse(fs.readFileSync(argument, "utf8")),
      values.owner,
      values.role,
      values.mode,
    );
  else if (command === "list" && values.owner)
    result = agents.list(values.owner);
  else if (command === "configure" && argument && key && values.owner)
    result = agents.configure(
      values.owner,
      argument,
      JSON.parse(fs.readFileSync(key, "utf8")),
    );
  else if (command === "revoke-key" && argument && key) {
    agents.revokeKey(argument, key);
    result = { revoked: true };
  } else if (command === "stop-run" && argument && values.owner) {
    agents.stop(values.owner, argument);
    result = { stopped: true };
  } else if (command === "suspend" && argument && values.owner) {
    agents.suspend(values.owner, argument);
    result = { suspended: true };
  } else
    throw Error(
      "Usage: WIKI_CONTROL=... node scripts/agent-admin.mjs people | register PUBLIC.json --owner ID [--role reader|editor] [--mode independent|delegated] | list --owner ID | revoke-key AGENT KEY | stop-run RUN --owner ID | suspend AGENT --owner ID",
    );
  console.log(JSON.stringify(result));
} finally {
  control.close();
}
