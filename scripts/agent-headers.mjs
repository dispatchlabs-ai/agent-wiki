#!/usr/bin/env node
import fs from "node:fs";
import {
  Client,
  StreamableHTTPClientTransport,
} from "@modelcontextprotocol/client";
import { AgentCredential } from "../src/agent-client.mjs";

// One short-lived run per invocation. Codex retains only the returned headers,
// reruns this helper after token expiry, and never receives the signing key.
try {
  const check = process.argv[3] === "--check";
  if (process.argv.length !== (check ? 4 : 3))
    throw Error(
      "Usage: node scripts/agent-headers.mjs /absolute/agent.json [--check]",
    );
  const config = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
  const credential = new AgentCredential(config, { runLifetimeSeconds: 300 });
  const token = await credential.token();
  if (check) {
    const client = new Client({
      name: "agent-wiki-machine-check",
      version: "1",
    });
    try {
      await client.connect(
        new StreamableHTTPClientTransport(new URL(config.endpoint), {
          authProvider: { token: () => token },
          fetch: credential.fetch,
        }),
      );
      const { tools } = await client.listTools();
      for (const name of [
        "wiki.search",
        "wiki.read",
        "wiki.traceSearch",
        "wiki.trace",
      ])
        if (!tools.some((tool) => tool.name === name))
          throw Error("Missing required Wiki tool");
      console.log(
        JSON.stringify({ ok: true, tools: tools.map((tool) => tool.name) }),
      );
    } finally {
      await client.close();
      await credential.close();
    }
  } else
    process.stdout.write(
      JSON.stringify({ Authorization: "Bearer " + token }) + "\n",
    );
  // Do not close (revoke) the run before Codex uses the token. Both expire in
  // five minutes; the process exits without saving either credential to disk.
} catch {
  console.error(
    "Wiki machine authentication failed; check connectivity, registration and key permissions.",
  );
  process.exitCode = 1;
}
