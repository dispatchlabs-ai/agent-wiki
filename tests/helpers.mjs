import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { git, markdown } from "../src/git-wiki.mjs";
export function fixture(t) {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), "agent-wiki-test-"));
  t.after(() => fs.rmSync(repo, { recursive: true, force: true }));
  git(repo, ["init", "-b", "main"]);
  git(repo, ["config", "user.name", "Test"]);
  git(repo, ["config", "user.email", "test@example.invalid"]);
  fs.mkdirSync(path.join(repo, "wiki"));
  fs.writeFileSync(
    path.join(repo, "wiki/guide.md"),
    markdown(
      {
        title: "Guide",
        description: "A starting point",
        kind: "guide",
        sources: [{ url: "https://example.org/source", title: "Source" }],
        custom: { preserved: true },
      },
      "Start here.\n",
    ),
  );
  commit(repo, "Initial article");
  return repo;
}
export function commit(repo, message) {
  git(repo, ["add", "."]);
  return git(repo, ["commit", "-m", message]);
}
export const update = (id, body = "An explanation.") => ({
  id,
  title: id,
  description: "A short description",
  topic: "Examples",
  body,
  summary: `Update ${id}`,
  expected_revision_id: null,
});
