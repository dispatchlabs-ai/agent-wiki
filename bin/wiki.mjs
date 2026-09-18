#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseArgs } from "node:util";
import {
  WikiApiClient,
  localLogin,
  readPrivateJSON,
  serviceOrigin,
  withProfile,
  writeProfile,
} from "../src/api-client.mjs";
import { createWikiTools } from "../public/wiki-tools.js";
import { browserLogin } from "../src/cli-login.mjs";
import { WikiError } from "../src/errors.mjs";

const help = `Agent Wiki — authenticated HTTP client
Usage: node bin/wiki.mjs <command> [arguments] [--json] [--config FILE]

  login --url https://wiki.example.org [--scope 'wiki:read wiki:trace wiki:write']
      Prints a browser authorization URL. Choose an explicitly shared agent.
  login --url URL --email EMAIL --password-stdin
      Signs in as your local human account. Password is read only from stdin.
  login --connection FILE       Uses an operator-enrolled machine connection.
  logout                       Revokes this login; removes the local profile.
  logout --forget              Removes only the profile after an unrecoverable login.
  whoami                       Shows the authenticated actor and authority.
  search QUERY                 Search articles [--limit N --offset N --topic T].
  read ID [--revision N]        Read current or historical article Markdown.
      [--section ANCHOR] [--fields title,body] selects a partial read.
      --fields sections lists anchors; omit selectors before editing.
  history ID                   Read attributed Git history.
  create ID --file JSON --operation-id ID
  edit ID --file JSON --revision BLOB --operation-id ID
      JSON is one article update (title, description, topic, body, summary).
      edit requires the revision you read; create expects no existing article.
  save --file JSON              Submit an exact batch, including operation_id.
  preview --file MARKDOWN       Render an unsaved draft.
  trace-search QUERY            Search evidence [--limit N --offset N].
  trace ID                      Read evidence [--limit N --offset N].
  traces | trace-sessions       Page the evidence catalog or imported sessions.
  trace-lines ID --start N --end N   Read original imported records.
  trace-provenance KEY          List citations for an imported logical event.
  file ASSET                   Inspect captured file metadata and download URL.
  call wiki.TOOL --file JSON    Full tool parameters through the same HTTP API.
  catalog | health | contract   Read the article catalog, health, or OpenAPI.

Use --file - to read stdin. Retain the exact input and operation ID for retries.
--json writes one result/error to stdout; diagnostics and login URLs use stderr.
Exit: 0 success, 1 request/network failure, 2 invalid usage, 3 conflict/busy,
      4 authentication/permission failure. No automatic mutation retry.
Default profile: ~/.config/agent-wiki/cli.json (0600). No direct wiki storage access.
`;
let json = process.argv.includes("--json");
try {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      json: { type: "boolean" },
      forget: { type: "boolean" },
      help: { type: "boolean", short: "h" },
      config: { type: "string" },
      url: { type: "string" },
      connection: { type: "string" },
      email: { type: "string" },
      "password-stdin": { type: "boolean" },
      scope: { type: "string" },
      file: { type: "string" },
      revision: { type: "string" },
      section: { type: "string" },
      fields: { type: "string" },
      "operation-id": { type: "string" },
      page: { type: "string" },
      start: { type: "string" },
      end: { type: "string" },
      limit: { type: "string" },
      offset: { type: "string" },
      topic: { type: "string" },
    },
  });
  json = !!values.json;
  const [command, argument, ...extra] = positionals;
  if (values.help || !command) {
    process.stdout.write(help);
  } else {
    if (extra.length) throw new WikiError("USAGE", "Unexpected arguments");
    const config =
      values.config || path.join(os.homedir(), ".config/agent-wiki/cli.json");
    const file = () => {
      if (!values.file) throw new WikiError("USAGE", "--file is required");
      const text = fs.readFileSync(
        values.file === "-" ? 0 : values.file,
        "utf8",
      );
      if (Buffer.byteLength(text) > 512000)
        throw new WikiError("USAGE", "Input exceeds 512 KB");
      return text;
    };
    const id = () => {
      if (!argument) throw new WikiError("USAGE", "An ID or query is required");
      return encodeURIComponent(argument);
    };
    const result = await withProfile(config, async (filename) => {
      if (command === "login") {
        if (fs.existsSync(filename))
          throw new WikiError(
            "PROFILE_EXISTS",
            "Use logout or a separate --config before changing identity",
            409,
          );
        let profile;
        if (values.connection) {
          if (values.url || values.email || values["password-stdin"])
            throw new WikiError(
              "USAGE",
              "Use either a machine connection or a URL login",
            );
          const connection = path.resolve(values.connection);
          const registered = readPrivateJSON(connection);
          profile = {
            version: 1,
            kind: "machine",
            connection,
            origin: serviceOrigin(new URL(registered.endpoint).origin),
          };
        } else {
          const origin = serviceOrigin(values.url);
          if (values.email || values["password-stdin"]) {
            if (
              !values.email ||
              !values["password-stdin"] ||
              process.stdin.isTTY
            )
              throw new WikiError(
                "USAGE",
                "Provide --email and pipe a password with --password-stdin",
              );
            profile = await localLogin(
              origin,
              values.email,
              fs.readFileSync(0, "utf8").replace(/\r?\n$/, ""),
            );
          } else
            profile = await browserLogin(
              origin,
              values.scope || "wiki:read",
              (url) => {
                process.stderr.write(
                  `Open this URL in a browser on this machine:\n${url}\n`,
                );
              },
            );
        }
        const api = new WikiApiClient(profile);
        try {
          const actor = await api.request(
            profile.kind === "session" ? "/api/me" : "/api/agent/run",
          );
          writeProfile(filename, profile);
          const { csrf, ...identity } = actor;
          return { signedIn: true, origin: profile.origin, ...identity };
        } finally {
          await api.close();
        }
      }
      if (!fs.existsSync(filename))
        throw new WikiError("LOGIN_REQUIRED", "Run wiki login first", 401);
      if (command === "logout" && values.forget) {
        fs.unlinkSync(filename);
        return {
          forgotten: true,
          revoked: false,
          message:
            "Local profile removed. Revoke the remote connection in the wiki if it is still active.",
        };
      }
      const profile = readPrivateJSON(filename);
      const api = new WikiApiClient(profile, {
        save: (value) => writeProfile(filename, value),
      });
      try {
        if (command === "logout") {
          const result = await api.logout();
          fs.unlinkSync(filename);
          return result;
        }
        if (command === "whoami") {
          const { csrf, ...identity } = await api.request(
            profile.kind === "session" ? "/api/me" : "/api/agent/run",
          );
          return identity;
        }
        const query = new URLSearchParams();
        for (const key of ["limit", "offset", "topic"])
          if (values[key]) query.set(key, values[key]);
        if (["search", "trace-search"].includes(command)) {
          id();
          query.set("q", argument);
          return api.request(
            `/api/${command === "search" ? "articles" : "traces"}/search?${query}`,
          );
        }
        if (command === "read") {
          const selection = new URLSearchParams();
          for (const key of ["section", "fields"])
            if (values[key] !== undefined) selection.set(key, values[key]);
          return api.request(
            `/api/articles/${id()}/${encodeURIComponent(values.revision || "current")}.json` +
              (selection.size ? `?${selection}` : ""),
          );
        }
        if (command === "history")
          return api.request(`/api/articles/${id()}/history.json`);
        if (command === "trace") {
          id();
          if (/^[a-f0-9]{64}$/.test(argument)) {
            if (values.limit || values.offset)
              throw new WikiError(
                "USAGE",
                "Imported traces use --page, not --limit/--offset",
              );
            query.set("view", "conversation");
          }
          if (values.page) query.set("page", values.page);
          return api.request(`/api/traces/${id()}.json?${query}`);
        }
        if (command === "call") {
          id();
          const config = await api.request("/api/articles/authoring.json");
          const tool = createWikiTools(
            (route, body) => api.request(route, body),
            config.write,
            config,
          ).find((t) => t.name === argument);
          if (!tool)
            throw new WikiError(
              "TOOL_UNAVAILABLE",
              "Tool unavailable for this caller or archive",
              404,
            );
          return tool.execute(JSON.parse(file()));
        }
        if (command === "trace-lines") {
          if (!values.start || !values.end)
            throw new WikiError(
              "USAGE",
              "Supply --start and --end inclusive source lines",
            );
          query.set("start", values.start);
          query.set("end", values.end);
          return api.request(`/api/traces/${id()}/lines.json?${query}`);
        }
        if (command === "trace-provenance") {
          id();
          query.set("key", argument);
          return api.request(`/api/traces/provenance.json?${query}`);
        }
        if (["traces", "trace-sessions"].includes(command))
          return api.request(
            `/api/traces/${command === "traces" ? "catalog" : "sessions"}.json?${query}`,
          );
        if (command === "file") return api.request(`/api/files/${id()}.json`);
        if (command === "preview")
          return api.request("/api/articles/preview", { body: file() });
        if (command === "save")
          return api.request("/api/articles/edits", JSON.parse(file()));
        if (["create", "edit"].includes(command)) {
          id();
          if (
            !values["operation-id"] ||
            (command === "edit" && !values.revision)
          )
            throw new WikiError(
              "USAGE",
              "Supply --operation-id and, for edit, the --revision you read",
            );
          const update = JSON.parse(file());
          return api.request("/api/articles/edits", {
            operation_id: values["operation-id"],
            updates: [
              {
                ...update,
                id: argument,
                expected_revision_id:
                  command === "create" ? null : values.revision,
              },
            ],
          });
        }
        const route = {
          catalog: "/api/articles/catalog.json",
          health: "/api/articles/health.json",
          contract: "/api/openapi.json",
        }[command];
        if (route) return api.request(route);
        throw new WikiError("USAGE", "Unknown command. Run with --help");
      } finally {
        await api.close();
      }
    });
    if (json) process.stdout.write(JSON.stringify(result) + "\n");
    else if (typeof result.body === "string")
      process.stdout.write(
        `${result.title}\nRevision: ${result.revision_id}\n\n${result.body}\n`,
      );
    else if (result.articles && command === "search")
      process.stdout.write(
        result.articles
          .map((a) => `${a.id} — ${a.title}\n${a.snippet || ""}`)
          .join("\n\n") + "\n",
      );
    else if (result.revisions)
      process.stdout.write(
        result.revisions
          .map((r) => `${r.number}  ${r.revision_id || r.commit}  ${r.summary}`)
          .join("\n") + "\n",
      );
    else process.stdout.write(JSON.stringify(result, null, 2) + "\n");
  }
} catch (error) {
  const code = error.code || "CLIENT_ERROR",
    status = error.status || 0;
  const message = error.message || "Request failed";
  if (json)
    process.stdout.write(
      JSON.stringify({ isError: true, code, status, error: message }) + "\n",
    );
  else process.stderr.write(`${code}: ${message}\n`);
  process.exitCode =
    status === 409
      ? 3
      : [401, 403, 404].includes(status)
        ? 4
        : code === "USAGE" ||
            code.startsWith("ERR_PARSE_ARGS") ||
            error instanceof SyntaxError
          ? 2
          : 1;
}
