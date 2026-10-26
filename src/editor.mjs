// @ts-check
import { conversationsEnabled } from "./features.mjs";
import { AgentStore } from "./agent-store.mjs";
import { ControlStore, digest } from "./control-store.mjs";
import { validateEvidence, verifyDraftEvidence } from "./evidence-quotes.mjs";
import { WikiError } from "./errors.mjs";
import { editSchema } from "../public/edit-contract.js";
import path from "node:path";
import { withWriterLock } from "./writer-lock.mjs";
import { fileURLToPath } from "node:url";
import {
  GitWiki,
  git,
  wikiRepo,
  sha,
  validId,
  markdown,
  commitFiles,
  parsePage,
} from "./git-wiki.mjs";
import { references } from "./wiki.mjs";

function operationIdentity(actor, authority, operation) {
  // Persistent machine requests have short, independent runs. Bind retries to
  // their registered key and authority, while retaining the original run in the
  // receipt. Legacy expiring credentials preserve their existing identity.
  if (authority?.credential) {
    const { run: _run, ...stable } = authority;
    authority = stable;
  }
  return actor
    ? digest(
        (authority ? JSON.stringify({ actor, authority }) : actor) +
          ":" +
          operation,
      )
    : operation;
}

/** @param {string} repo @param {import("../public/edit-contract.js").EditDraft} draft
 * @returns {import("../public/edit-contract.js").SaveReceipt} */
export function saveGitEdits(
  repo,
  draft,
  verified = new Map(),
  actor = null,
  authority = null,
  publish = (fn) => fn(),
  snapshot = null,
  initiator = null,
) {
  if (
    !draft ||
    !validId(draft.operation_id) ||
    !Array.isArray(draft.updates) ||
    draft.updates.length < 1 ||
    draft.updates.length > editSchema.properties.updates.maxItems
  )
    throw new WikiError("INVALID_EDIT", "Invalid edit operation");
  const publicOperation = draft.operation_id;
  if (actor)
    draft = {
      ...draft,
      operation_id: operationIdentity(actor, authority, publicOperation),
    };
  const wiki = snapshot || new GitWiki(repo);
  const fingerprint = sha(JSON.stringify(draft));
  const prior = wiki.receipt(draft.operation_id);
  if (prior) {
    if (prior.fingerprint !== fingerprint)
      throw new WikiError(
        "OPERATION_CONFLICT",
        "Operation identity already used for different content",
        409,
      );
    const commit = git(repo, [
      "log",
      "-1",
      "--format=%H",
      wiki.head,
      "--",
      `.wiki/operations/${draft.operation_id}.json`,
    ]);
    const tree = git(repo, ["ls-tree", "-rz", commit, "--", "wiki"]).split(
      "\0",
    );
    const result = {
      ...prior.receipt,
      state: "already-saved",
      articles: prior.receipt.articles.map((a) => {
        let number = a.number;
        let revision_id = a.revision_id;
        if (!revision_id) {
          const entry = tree.find(
            (line) => path.basename(line.split("\t")[1] || "", ".md") === a.id,
          );
          if (entry) {
            const [object, filename] = entry.split("\t");
            revision_id = object.split(" ")[2];
            const changed = git(repo, [
              "log",
              "-1",
              "--first-parent",
              "--format=%H",
              commit,
              "--",
              filename,
            ]);
            number =
              (wiki.histories.get(a.id) || []).find(
                (ref) => ref.commit === changed,
              )?.number || number;
          } else revision_id = wiki.revision(a.id, a.number)?.revision_id;
        }
        if (typeof revision_id !== "string")
          throw new WikiError(
            "INVALID_RECEIPT",
            "Recorded article revision is unavailable",
            503,
          );
        return { ...a, number, revision_id };
      }),
      commit,
    };
    // Returning an existing receipt must also recheck current authority.
    return publish(() => result);
  }
  const files = {},
    results = [],
    proposed = new Map(wiki.pages);
  const now = new Date().toISOString();
  const seen = new Set();
  for (const u of draft.updates) {
    if (!u || !validId(u.id) || seen.has(u.id))
      throw new WikiError(
        "INVALID_EDIT",
        "Invalid or duplicate article identity",
      );
    seen.add(u.id);
    const current = wiki.current(u.id);
    if (u.expected_revision_id !== (current?.revision_id || null))
      throw new WikiError(
        "REVISION_CONFLICT",
        "Conflict: article changed; read it again before editing",
        409,
      );
    for (const field of ["title", "description", "topic", "body", "summary"]) {
      const max =
        editSchema.properties.updates.items.properties[field].maxLength;
      if (
        typeof u[field] !== "string" ||
        !u[field].trim() ||
        u[field].length > max
      )
        throw new WikiError("INVALID_EDIT", `Invalid ${field}`);
    }
    for (const field of ["related", "questions"]) {
      if (
        u[field] !== undefined &&
        (!Array.isArray(u[field]) ||
          u[field].length > 100 ||
          u[field].some((s) => typeof s !== "string" || s.length > 2000))
      )
        throw new WikiError("INVALID_EDIT", `Invalid ${field}`);
    }
    if (u.evidence !== undefined) {
      validateEvidence(u.evidence);
      if (
        u.evidence.length &&
        verified.get(u.id)?.input !== JSON.stringify(u.evidence)
      )
        throw new WikiError(
          "EVIDENCE_UNAVAILABLE",
          "Evidence must be verified before saving",
          503,
        );
    }
    const metadata = current
      ? { ...wiki.pages.get(u.id) }
      : { kind: "topic", sources: [] };
    for (const key of [
      "id",
      "filename",
      "blob",
      "body",
      "number",
      "created_at",
      "change_type",
    ])
      delete metadata[key];
    Object.assign(metadata, {
      title: u.title,
      description: u.description,
      topic: u.topic,
      updated: now.slice(0, 10),
      summary: u.summary,
      related: u.related ?? current?.related ?? [],
      questions: u.questions ?? current?.questions ?? [],
    });
    if (u.evidence !== undefined)
      metadata.evidence = u.evidence.length ? verified.get(u.id).records : [];
    const name = current?.filename || `wiki/${u.id}.md`;
    files[name] = markdown(metadata, u.body);
    proposed.set(u.id, parsePage(files[name], name, null));
    const revision_id = git(repo, ["hash-object", "--stdin"], {
      input: files[name],
    });
    results.push({
      id: u.id,
      number:
        ((wiki.histories.get(u.id) || []).at(-1)?.number || 0) +
        Number(!current || revision_id !== current.revision_id),
      revision_id,
      url: `/wiki/${u.id}/`,
    });
  }
  for (const p of proposed.values())
    for (const target of [
      ...(wiki.linkCache.get(p.blob) || references(p.body)),
      ...p.related,
    ])
      if (!proposed.has(target))
        throw new WikiError(
          "INVALID_EDIT",
          `Broken article link: ${p.id} -> ${target}`,
        );
  /** @type {import("../public/edit-contract.js").StoredReceipt} */
  const receipt = {
    operation_id: publicOperation,
    ...(actor ? { actor } : {}),
    ...(authority ? { authority } : {}),
    ...(initiator ? { initiator } : {}),
    state: "saved",
    articles: results,
  };
  files[`.wiki/operations/${draft.operation_id}.json`] =
    JSON.stringify({ fingerprint, recorded_at: now, receipt }, null, 2) + "\n";
  const commit = commitFiles(
    repo,
    wiki.head,
    files,
    draft.updates.map((u) => u.summary).join("; "),
    publish,
  );
  return { ...receipt, commit };
}

// Reuse parsed articles and store connections, never permission decisions. Each
// save refreshes committed state under the same cross-process filesystem lock.
export class GitEditor {
  constructor(repo, { control = null, evidenceUrl = null, push = false } = {}) {
    this.repo = repo;
    this.options = { control, evidenceUrl, push };
    this.control = null;
    this.agents = null;
    this.snapshot = null;
  }

  async save(
    draft,
    { session = null, agentToken = null, audience = null } = {},
    lockOptions = {},
  ) {
    const repo = this.repo;
    return withWriterLock(
      repo,
      async () => {
        if (this.options.control && !this.control)
          this.control = new ControlStore(this.options.control);
        const control = this.control;
        if (control && agentToken && !this.agents)
          this.agents = new AgentStore(control);
        const authorize = () => {
          if (!control) return { actor: null, authority: null };
          if (agentToken) {
            const actor = this.agents.requireToken(
              agentToken,
              audience,
              "default",
              "write",
            );
            if (draft?.updates?.some((update) => update?.evidence?.length))
              this.agents.requireToken(
                agentToken,
                audience,
                "default",
                "trace",
              );
            return {
              actor: actor.id,
              initiator: this.agents.run(actor.run).initiator,
              authority: {
                run: actor.run,
                ...("credential" in actor
                  ? { credential: actor.credential }
                  : {}),
                subject: actor.subject,
                mode: actor.mode,
                definition: actor.definition,
                scope: actor.scope,
              },
            };
          }
          const actor = control.authenticate(session);
          if (!actor) throw new WikiError("NOT_FOUND", "Not found", 404);
          control.require(actor.id, "editor");
          return { actor: actor.id, authority: null };
        };
        const initial = control ? control.read(authorize) : authorize();
        if (this.snapshot) this.snapshot.refresh();
        else this.snapshot = new GitWiki(repo);
        const snapshot = this.snapshot;
        const verified = await verifyDraftEvidence(
          repo,
          {
            ...draft,
            operation_id: operationIdentity(
              initial.actor,
              initial.authority,
              draft?.operation_id,
            ),
          },
          this.options.evidenceUrl,
          snapshot,
        );
        const publish = (commit) => {
          const checked = () => {
            authorize();
            return commit();
          };
          return control ? control.transaction(checked) : checked();
        };
        const result = saveGitEdits(
          repo,
          draft,
          verified,
          initial.actor,
          initial.authority,
          publish,
          snapshot,
          initial.initiator,
        );
        // Retry also retries a previously failed push. A failed remote never makes
        // the local durable commit disappear or creates a duplicate revision.
        try {
          if (this.options.push)
            git(repo, ["push", "origin", "main"], { timeout: 30000 });
          result.remote = this.options.push ? "pushed" : "not-requested";
        } catch {
          result.remote = "push-failed";
        }
        return result;
      },
      lockOptions,
    );
  }

  close() {
    this.control?.close();
    this.control = this.agents = this.snapshot = null;
  }
}

async function readDraft() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const repo = wikiRepo();
  let editor;
  try {
    const draft = await readDraft();
    if (process.env.WIKI_HTTP_WRITE === "1" && !process.env.WIKI_CONTROL)
      throw Error("A control database is required");
    editor = new GitEditor(repo, {
      control:
        process.env.WIKI_HTTP_WRITE === "1" ? process.env.WIKI_CONTROL : null,
      evidenceUrl: conversationsEnabled()
        ? process.env.WIKI_EVIDENCE_URL
        : null,
      push: process.env.WIKI_PUSH === "1",
    });
    const result = await editor.save(draft, {
      session: process.env.WIKI_SESSION,
      agentToken: process.env.WIKI_AGENT_TOKEN,
      audience: process.env.WIKI_AGENT_AUDIENCE,
    });
    console.log(JSON.stringify(result));
  } catch (e) {
    console.error(
      JSON.stringify({
        code: e instanceof WikiError ? e.code : "WRITER_UNAVAILABLE",
        error: e.message,
        status: e instanceof WikiError ? e.status : 503,
      }),
    );
    process.exitCode = 1;
  } finally {
    editor?.close();
  }
}
