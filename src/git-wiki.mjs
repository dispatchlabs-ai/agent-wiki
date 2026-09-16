// Markdown is authoritative. All historical bodies are read from Git objects;
// this module keeps only bounded, disposable in-memory projections.
import { WikiError } from "./errors.mjs";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import matter from "gray-matter";
import { references } from "./wiki.mjs";

export const wikiRepo = () =>
  process.env.WIKI_REPO ||
  (() => {
    throw Error("Set WIKI_REPO to a content repository");
  })();
export const sha = (value) => createHash("sha256").update(value).digest("hex");
export const validId = (id) =>
  typeof id === "string" &&
  /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id) &&
  id.length <= 100;
export function git(repo, args, options = {}) {
  return execFileSync("git", ["-C", repo, ...args], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    stdio: ["pipe", "pipe", "pipe"],
    ...options,
  }).trimEnd();
}
export function markdown(data, body) {
  return `---\n${JSON.stringify(data, null, 2)}\n---\n${body}`;
}
export function parsePage(text, filename, blob) {
  // gray-matter also supports executable JavaScript frontmatter. Only the
  // plain YAML/JSON delimiter is accepted; content must never execute code.
  if (!/^---\r?\n/.test(text))
    throw Error(`Expected YAML frontmatter: ${filename}`);
  const { data, content } = matter(text, {}); // Disable the parser's unbounded cache.
  if (!data || typeof data !== "object" || Array.isArray(data))
    throw Error(`Invalid frontmatter object: ${filename}`);
  JSON.stringify(data); // Reject cyclic YAML metadata that cannot cross the JSON API.
  const id = path.basename(filename, ".md");
  if (
    !validId(id) ||
    typeof data.title !== "string" ||
    !data.title.trim() ||
    typeof data.description !== "string" ||
    (data.kind !== undefined && typeof data.kind !== "string")
  )
    throw Error(`Invalid Markdown frontmatter: ${filename}`);
  if (!content.trim()) throw Error(`Empty article: ${filename}`);
  for (const field of ["related", "questions", "aliases"]) {
    if (
      data[field] !== undefined &&
      (!Array.isArray(data[field]) ||
        data[field].some((s) => typeof s !== "string"))
    )
      throw Error(`Invalid ${field}: ${filename}`);
  }
  for (const field of ["sources"]) {
    if (
      data[field] !== undefined &&
      (!Array.isArray(data[field]) ||
        data[field].some(
          (s) => !s || typeof s !== "object" || typeof s.url !== "string",
        ))
    )
      throw Error(`Invalid ${field}: ${filename}`);
  }
  if (data.topic !== undefined && typeof data.topic !== "string")
    throw Error(`Invalid topic: ${filename}`);
  return {
    ...data,
    id,
    filename,
    blob,
    body: content,
    topic: data.topic || "Wiki",
    related: data.related || [],
    questions: data.questions || [],
    sources: data.sources || [],
  };
}

export class GitWiki {
  constructor(repo = wikiRepo()) {
    this.repo = repo;
    this.head = null;
    this.pages = new Map();
    this.histories = new Map();
    this.fileInfo = new Map();
    this.linkCache = new Map();
    this.refresh();
  }
  refresh() {
    const head = git(this.repo, ["rev-parse", "HEAD"]);
    if (head === this.head) return false;
    const files = git(this.repo, [
      "ls-tree",
      "-rz",
      "--full-tree",
      head,
      "--",
      "wiki",
    ])
      .split("\0")
      .filter(Boolean);
    const entries = files
      .map((line) => {
        const [mode, type, rest] = line.split(" ");
        const tab = rest.indexOf("\t");
        return {
          mode,
          type,
          blob: rest.slice(0, tab),
          filename: rest.slice(tab + 1),
        };
      })
      .filter((e) => e.filename.endsWith(".md"));
    const pages = new Map();
    for (const entry of entries) {
      if (
        entry.type !== "blob" ||
        entry.mode !== "100644" ||
        !/^wiki\/(?:[a-z0-9-]+\/)*[a-z0-9-]+\.md$/.test(entry.filename)
      )
        throw Error(
          `Only regular Markdown files are allowed: ${entry.filename}`,
        );
      const prior = this.pages.get(path.basename(entry.filename, ".md"));
      const page =
        prior?.blob === entry.blob && prior.filename === entry.filename
          ? prior
          : parsePage(
              execFileSync(
                "git",
                ["-C", this.repo, "cat-file", "blob", entry.blob],
                { encoding: "utf8", maxBuffer: 4 * 1024 * 1024 },
              ),
              entry.filename,
              entry.blob,
            );
      if (pages.has(page.id)) throw Error(`Duplicate article: ${page.id}`);
      pages.set(page.id, page);
    }
    // A whole committed tree is adopted together; dirty worktree files are ignored.
    const linkCache = new Map();
    for (const page of pages.values()) {
      const links = this.linkCache.get(page.blob) || references(page.body);
      linkCache.set(page.blob, links);
      for (const target of [...links, ...page.related]) {
        if (!pages.has(target))
          throw Error(`Broken article link: ${page.id} -> ${target}`);
      }
    }
    const histories = new Map();
    const log = git(this.repo, [
      "log",
      "--first-parent",
      "--diff-merges=first-parent",
      "--no-renames",
      "--format=%x1e%H%x1f%cI%x1f%s",
      "--name-status",
      head,
      "--",
      "wiki",
    ]);
    for (const record of log.split("\x1e").filter(Boolean).reverse()) {
      const [header, ...names] = record.split("\n");
      const [commit, created_at, summary] = header.split("\x1f");
      for (const line of names.filter(Boolean)) {
        const [status, filename] = line.split("\t");
        if (status === "D" || !filename?.endsWith(".md")) continue;
        const id = path.basename(filename, ".md");
        const history = histories.get(id) || [];
        history.push({
          commit,
          created_at,
          summary,
          filename,
          number: history.length + 1,
          url: `/wiki/${id}/revision/${history.length + 1}/`,
        });
        histories.set(id, history);
      }
    }
    this.pages = pages;
    this.linkCache = linkCache;
    this.histories = histories;
    this.fileInfo = new Map(
      [...histories].map(([id, history]) => [id, history.at(-1)]),
    );
    this.head = head;
    return true;
  }
  /** @returns {import("./contracts.mjs").RevisionRef[]} */
  history(id) {
    return this.histories.get(id) || [];
  }
  /** @returns {import("./contracts.mjs").ArticleRevision|null} */
  revision(id, number) {
    const ref = this.history(id).find(
      (r) => r.number === number || r.commit === number,
    );
    if (!ref) return null;
    const filename = ref.filename;
    const body = execFileSync(
      "git",
      ["-C", this.repo, "show", `${ref.commit}:${filename}`],
      { encoding: "utf8", maxBuffer: 4 * 1024 * 1024 },
    );
    return this.describe(
      parsePage(
        body,
        filename,
        git(this.repo, ["rev-parse", `${ref.commit}:${filename}`]),
      ),
      ref,
    );
  }
  describe(page, ref = this.fileInfo.get(page.id)) {
    const { number, created_at, summary } = ref;
    return {
      ...page,
      number,
      created_at,
      summary,
      change_type: page.change_type || (number === 1 ? "created" : "updated"),
      revision_id: page.blob,
      commit: ref.commit,
      revisionCount: this.fileInfo.get(page.id).number,
      url: `/wiki/${page.id}/`,
    };
  }
  /** @returns {import("./contracts.mjs").ArticleRevision|null} */
  current(id) {
    const page = this.pages.get(id);
    return page ? this.describe(page) : null;
  }
  catalog() {
    return [...this.pages.keys()].map((id) => {
      const p = this.current(id);
      return {
        id,
        title: p.title,
        description: p.description,
        topic: p.topic,
        number: p.number,
        revisionCount: p.revisionCount,
        updated_at: p.created_at,
        revision_id: p.revision_id,
        rendered_revision: p.number,
        commit: p.commit,
        url: p.url,
      };
    });
  }
  receipt(operation) {
    const name = `.wiki/operations/${operation}.json`;
    try {
      return JSON.parse(git(this.repo, ["show", `${this.head}:${name}`]));
    } catch {
      return null;
    }
  }
}

// Called while holding the repository's advisory writer lock. A private Git
// index creates a commit without staging, overwriting or committing user files.
// update-ref provides compare-and-swap even against writers that ignore the lock.
export function commitFiles(repo, expectedHead, files, message) {
  if (git(repo, ["symbolic-ref", "--short", "HEAD"]) !== "main")
    throw new WikiError("BRANCH_CONFLICT", "Wiki edits require main", 409);
  if (git(repo, ["status", "--porcelain"]))
    throw new WikiError(
      "WORKTREE_CONFLICT",
      "Working tree has changes; commit or reconcile them before wiki edits",
      409,
    );
  const index = path.join(
    git(repo, ["rev-parse", "--absolute-git-dir"]),
    `wiki-index-${randomUUID()}`,
  );
  const env = { ...process.env, GIT_INDEX_FILE: index };
  try {
    git(repo, ["read-tree", expectedHead], { env });
    for (const [name, text] of Object.entries(files)) {
      if (
        !/^wiki\/(?:[a-z0-9-]+\/)*[a-z0-9-]+\.md$/.test(name) &&
        !/^\.wiki\/operations\/[a-z0-9-]+\.json$/.test(name)
      )
        throw Error("Invalid write path");
      const blob = git(repo, ["hash-object", "-w", "--stdin"], { input: text });
      git(
        repo,
        ["update-index", "--add", "--cacheinfo", `100644,${blob},${name}`],
        { env },
      );
    }
    const tree = git(repo, ["write-tree"], { env });
    const commit = git(repo, ["commit-tree", tree, "-p", expectedHead], {
      input: message + "\n",
    });
    git(repo, ["update-ref", "refs/heads/main", commit, expectedHead]);
    // Bring only committed task paths into the real index/worktree. A repository
    // lock serializes service writers; human edits must not race this operation.
    git(repo, [
      "restore",
      "--source",
      commit,
      "--staged",
      "--worktree",
      "--",
      ...Object.keys(files),
    ]);
    return commit;
  } finally {
    fs.rmSync(index, { force: true });
  }
}
