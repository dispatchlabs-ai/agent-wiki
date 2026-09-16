import { indexTraces } from "../src/trace-search.mjs";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { git } from "../src/git-wiki.mjs";
import { createWiki } from "../src/server.mjs";
import { importTrace } from "../src/traces.mjs";
const root = fileURLToPath(new URL("../", import.meta.url));
const repo = path.join(root, ".runtime/example");
if (!fs.existsSync(repo)) {
  fs.mkdirSync(repo, { recursive: true });
  fs.cpSync(path.join(root, "examples/wiki"), path.join(repo, "wiki"), {
    recursive: true,
  });
  git(repo, ["init", "-b", "main"]);
  git(repo, ["config", "user.name", "Example editor"]);
  git(repo, ["config", "user.email", "example@example.invalid"]);
  git(repo, ["add", "wiki"]);
  git(repo, ["commit", "-m", "Add synthetic example corpus"]);
}
const traces = path.join(root, ".runtime/traces");
for (const [name, title] of [
  ["codex", "Atlas decision · Codex (synthetic)"],
  ["pi", "Cedar prototype · pi (synthetic)"],
]) {
  importTrace(traces, path.join(root, `examples/traces/${name}.jsonl`), title);
}
indexTraces(traces);
const port = Number(process.env.PORT || 4317);
createWiki({
  repo,
  traces,
  evidenceUrl: null,
  database:
    process.env.WIKI_DATABASE || path.join(root, ".runtime/example.sqlite3"),
  origin: process.env.WIKI_ORIGIN || `http://127.0.0.1:${port}`,
  write: true,
}).listen(port, "127.0.0.1", () =>
  console.log(
    `Example wiki: http://127.0.0.1:${port} (synthetic content, local editing enabled)`,
  ),
);
