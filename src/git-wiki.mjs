// Markdown is authoritative. All historical bodies are read from Git objects;
// this module keeps only bounded, disposable in-memory projections.
import { WikiError } from "./errors.mjs";
import fs from "node:fs";
import path from "node:path";
import { execFileSync, spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import matter from "gray-matter";
import { references } from "./wiki.mjs";
import { lifecycleStdio } from "./lifecycle-lock.mjs";

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
    stdio: lifecycleStdio(["pipe", "pipe", "pipe"]),
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

// Read changed objects in byte-bounded batches rather than spawning Git once
// per article. Retain the existing 4 MiB per-article read bound. Frame by bytes,
// not lines or JavaScript character offsets, so Unicode and trailing newlines
// survive exactly as they do with `cat-file blob`.
function readPages(repo, entries) {
  const pages = new Map();
  if (!entries.length) return pages;
  // A single incremental change already needs only one object read.
  if (entries.length === 1) {
    const entry = entries[0];
    pages.set(
      entry.filename,
      parsePage(
        execFileSync("git", ["-C", repo, "cat-file", "blob", entry.blob], {
          encoding: "utf8",
          maxBuffer: 4 * 1024 * 1024,
          stdio: lifecycleStdio(["pipe", "pipe", "pipe"]),
        }),
        entry.filename,
        entry.blob,
      ),
    );
    return pages;
  }
  // Query sizes only for changed objects; ls-tree --long would also touch
  // every unchanged object on remote storage after each commit.
  const headers = git(repo, ["cat-file", "--batch-check"], {
    input: entries.map((entry) => entry.blob).join("\n") + "\n",
  }).split("\n");
  if (headers.length !== entries.length)
    throw Error("Incomplete Git object metadata");
  entries = entries.map((entry, i) => {
    const [blob, type, rawSize] = headers[i].split(" ");
    const size = Number(rawSize);
    if (
      blob !== entry.blob ||
      type !== "blob" ||
      !Number.isSafeInteger(size) ||
      size < 0
    )
      throw Error(`Invalid Git object metadata: ${entry.filename}`);
    if (size > 4 * 1024 * 1024)
      throw Error(`Article exceeds the 4 MiB read bound: ${entry.filename}`);
    return { ...entry, size };
  });
  for (let start = 0; start < entries.length;) {
    let end = start + 1,
      bytes = entries[start].size;
    while (end < entries.length && bytes + entries[end].size <= 4 * 1024 * 1024)
      bytes += entries[end++].size;
    const batch = entries.slice(start, end);
    const output = execFileSync("git", ["-C", repo, "cat-file", "--batch"], {
      input: batch.map((entry) => entry.blob).join("\n") + "\n",
      maxBuffer: bytes + batch.length * 128,
      stdio: lifecycleStdio(["pipe", "pipe", "pipe"]),
    });
    let offset = 0;
    for (const entry of batch) {
      const newline = output.indexOf(10, offset);
      const bodyStart = newline + 1,
        bodyEnd = bodyStart + entry.size;
      if (
        newline < offset ||
        output.toString("utf8", offset, newline) !==
          `${entry.blob} blob ${entry.size}` ||
        output[bodyEnd] !== 10
      )
        throw Error(`Invalid Git object response: ${entry.filename}`);
      pages.set(
        entry.filename,
        parsePage(
          output.toString("utf8", bodyStart, bodyEnd),
          entry.filename,
          entry.blob,
        ),
      );
      offset = bodyEnd + 1;
    }
    if (offset !== output.length) throw Error("Unexpected Git batch output");
    start = end;
  }
  return pages;
}

// History is lazy: constructors and writer snapshots do not parse receipts.
// The reader worker batches immutable commit/object reads. Async subprocesses
// also let that worker refresh articles while a cold history read is in flight.
function historyGit(
  repo,
  args,
  { input = "", maxBuffer = 64 * 1024 * 1024 } = {},
) {
  return new Promise((resolve, reject) => {
    const child = spawn("git", ["-C", repo, ...args], {
      stdio: lifecycleStdio(["pipe", "pipe", "pipe"]),
    });
    const output = [];
    let bytes = 0;
    child.on("error", reject);
    child.stdout.on("data", (chunk) => {
      bytes += chunk.length;
      if (bytes > maxBuffer) {
        child.kill();
        reject(Error("History Git output exceeds its read bound"));
      } else output.push(chunk);
    });
    child.stderr.resume();
    child.on("close", (code) => {
      if (code !== 0) reject(Error(`History Git read failed: ${args[0]}`));
      else resolve(Buffer.concat(output));
    });
    child.stdin.on("error", (error) => {
      if (!("code" in error) || error.code !== "EPIPE") reject(error);
    });
    child.stdin.end(input);
  });
}
async function historyReceipts(repo, refs) {
  const commits = new Map(
    refs.map((ref) => [ref.commit, { blobs: new Map(), receipts: [] }]),
  );
  const changes = (
    await historyGit(
      repo,
      [
        "diff-tree",
        "--stdin",
        "--root",
        "--first-parent",
        "--diff-merges=first-parent",
        "--no-renames",
        "-r",
        "--raw",
        "--no-abbrev",
        "-z",
        "--",
        "wiki",
        ".wiki/operations",
      ],
      { input: [...commits.keys()].join("\n") + "\n" },
    )
  )
    .toString("utf8")
    .split("\0");
  const objects = new Map();
  let commit;
  for (let i = 0; i < changes.length; i++) {
    const change = changes[i];
    if (commits.has(change)) {
      commit = commits.get(change);
      continue;
    }
    if (!change.startsWith(":")) continue;
    const [, , , blob, status] = change.split(" ");
    const filename = changes[++i];
    if (!commit) throw Error("Invalid history diff response");
    commit.blobs.set(filename, blob);
    // Only newly added receipts in this exact commit can identify its changer.
    if (
      status !== "A" ||
      !/^\.wiki\/operations\/[a-z0-9-]+\.json$/.test(filename)
    )
      continue;
    if (!objects.has(blob)) objects.set(blob, []);
    objects.get(blob).push(commit.receipts);
  }
  if (!objects.size) return commits;
  const blobs = [...objects.keys()];
  const headers = (
    await historyGit(repo, ["cat-file", "--batch-check"], {
      input: blobs.join("\n") + "\n",
    })
  )
    .toString("utf8")
    .trimEnd()
    .split("\n");
  if (headers.length !== blobs.length)
    throw Error("Incomplete receipt metadata");
  const entries = headers.flatMap((header, i) => {
    const [blob, type, rawSize] = header.split(" ");
    const size = Number(rawSize);
    // Unreadable legacy/operator receipts do not supply authenticated identity.
    if (
      blob !== blobs[i] ||
      type !== "blob" ||
      !Number.isSafeInteger(size) ||
      size < 0 ||
      size > 64 * 1024 * 1024
    )
      return [];
    return [{ blob, size }];
  });
  for (let start = 0; start < entries.length;) {
    let end = start + 1,
      bytes = entries[start].size;
    while (end < entries.length && bytes + entries[end].size <= 4 * 1024 * 1024)
      bytes += entries[end++].size;
    const batch = entries.slice(start, end);
    const output = await historyGit(repo, ["cat-file", "--batch"], {
      input: batch.map((entry) => entry.blob).join("\n") + "\n",
      maxBuffer: bytes + batch.length * 128,
    });
    let offset = 0;
    for (const { blob, size } of batch) {
      const newline = output.indexOf(10, offset),
        bodyStart = newline + 1,
        bodyEnd = bodyStart + size;
      if (
        newline < offset ||
        output.toString("utf8", offset, newline) !== `${blob} blob ${size}` ||
        output[bodyEnd] !== 10
      )
        throw Error("Invalid receipt object response");
      try {
        const receipt = JSON.parse(
          output.toString("utf8", bodyStart, bodyEnd),
        ).receipt;
        for (const receipts of objects.get(blob)) receipts.push(receipt);
      } catch {
        // Malformed receipts remain unknown, never Git-author attribution.
      }
      offset = bodyEnd + 1;
    }
    if (offset !== output.length)
      throw Error("Unexpected receipt batch output");
    start = end;
  }
  return commits;
}
function attribution(id, ref, receipts, blob) {
  const matches = receipts.filter(
    (receipt) =>
      receipt?.state === "saved" &&
      Array.isArray(receipt.articles) &&
      receipt.articles.some(
        (article) =>
          article?.id === id &&
          article.number === ref.number &&
          (!article.revision_id || article.revision_id === blob),
      ),
  );
  const unknown = { kind: "unknown", actor: null, authority: null };
  if (matches.length !== 1) return unknown;
  const receipt = matches[0];
  if (!receipt.actor) return { kind: "operator", actor: null, authority: null };
  if (typeof receipt.actor !== "string") return unknown;
  if (!receipt.authority)
    return { kind: "human", actor: receipt.actor, authority: null };
  const { mode, subject } = receipt.authority;
  if (
    !["independent", "delegated"].includes(mode) ||
    (subject !== null && typeof subject !== "string")
  )
    return unknown;
  return {
    kind: "agent",
    actor: receipt.actor,
    // Only this allowlisted projection is cached or sent to the serving thread.
    authority: {
      mode,
      subject,
      initiator:
        typeof receipt.initiator === "string" ? receipt.initiator : null,
    },
  };
}

export class GitWiki {
  constructor(repo = wikiRepo()) {
    this.repo = repo;
    this.head = null;
    this.pages = new Map();
    this.histories = new Map();
    this.attributions = new Map();
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
        const tab = line.indexOf("\t");
        const [mode, type, blob] = line.slice(0, tab).split(" ");
        return {
          mode,
          type,
          blob,
          filename: line.slice(tab + 1),
        };
      })
      .filter((e) => e.filename.endsWith(".md"));
    for (const entry of entries) {
      if (
        entry.type !== "blob" ||
        entry.mode !== "100644" ||
        !/^wiki\/(?:[a-z0-9-]+\/)*[a-z0-9-]+\.md$/.test(entry.filename)
      )
        throw Error(
          `Only regular Markdown files are allowed: ${entry.filename}`,
        );
    }
    const changed = readPages(
      this.repo,
      entries.filter((entry) => {
        const prior = this.pages.get(path.basename(entry.filename, ".md"));
        return prior?.blob !== entry.blob || prior.filename !== entry.filename;
      }),
    );
    const pages = new Map();
    for (const entry of entries) {
      const prior = this.pages.get(path.basename(entry.filename, ".md"));
      const page = changed.get(entry.filename) || prior;
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
  attributionKey(id, ref) {
    // Number and path belong to the requested history, not the current HEAD.
    return `${ref.commit}:${id}:${ref.filename}:${ref.number}`;
  }
  /** @returns {Promise<import("./contracts.mjs").HistoryRevision[]>} */
  async history(id, refs = this.histories.get(id) || []) {
    const missing = refs.filter(
      (ref) => !this.attributions.has(this.attributionKey(id, ref)),
    );
    if (missing.length) {
      const commits = await historyReceipts(this.repo, missing);
      for (const ref of missing) {
        const { receipts, blobs } = commits.get(ref.commit);
        this.attributions.set(
          this.attributionKey(id, ref),
          attribution(id, ref, receipts, blobs.get(ref.filename)),
        );
      }
    }
    return refs.map((ref) => ({
      ...ref,
      attribution: this.attributions.get(this.attributionKey(id, ref)),
    }));
  }
  /** @returns {import("./contracts.mjs").ArticleRevision|null} */
  revision(id, number) {
    const ref = (this.histories.get(id) || []).find(
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
export function commitFiles(
  repo,
  expectedHead,
  files,
  message,
  publish = (fn) => fn(),
) {
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
    const entries = [];
    for (const [name, text] of Object.entries(files)) {
      if (
        !/^wiki\/(?:[a-z0-9-]+\/)*[a-z0-9-]+\.md$/.test(name) &&
        !/^\.wiki\/operations\/[a-z0-9-]+\.json$/.test(name)
      )
        throw Error("Invalid write path");
      const blob = git(repo, ["hash-object", "-w", "--stdin"], { input: text });
      entries.push(`100644 ${blob}\t${name}\n`);
    }
    // All paths are validated above. Populate the private index in one Git
    // invocation, amortizing process and index-lock work across atomic batches.
    git(repo, ["update-index", "--index-info"], {
      env,
      input: entries.join(""),
    });
    const tree = git(repo, ["write-tree"], { env });
    const commit = git(repo, ["commit-tree", tree, "-p", expectedHead], {
      input: message + "\n",
    });
    // Object preparation can be slow. Serialize authorization/revocation only
    // around the atomic visibility change, never around that preparation.
    publish(() =>
      git(repo, ["update-ref", "refs/heads/main", commit, expectedHead]),
    );
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
