// @ts-check
import { AgentStore } from "./agent-store.mjs";
import { ControlStore, digest } from "./control-store.mjs";
import { validateEvidence, verifyDraftEvidence } from "./evidence-quotes.mjs";
import { WikiError } from "./errors.mjs";
import { editSchema } from "../public/edit-contract.js";
import fs from "node:fs";
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
  const wiki = new GitWiki(repo);
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
    return {
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
              wiki.history(a.id).find((ref) => ref.commit === changed)
                ?.number || number;
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
        (wiki.history(u.id).at(-1)?.number || 0) +
        Number(!current || revision_id !== current.revision_id),
      revision_id,
      url: `/wiki/${u.id}/`,
    });
  }
  for (const p of proposed.values())
    for (const target of [...references(p.body), ...p.related])
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
  );
  return { ...receipt, commit };
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const repo = wikiRepo();
  try {
    await withWriterLock(repo, async () => {
      const draft = JSON.parse(fs.readFileSync(0, "utf8"));
      let result;
      let control;
      try {
        let agents;
        if (process.env.WIKI_HTTP_WRITE === "1") {
          control = new ControlStore(process.env.WIKI_CONTROL);
          agents = process.env.WIKI_AGENT_TOKEN
            ? new AgentStore(control)
            : null;
        }
        const authorize = () => {
          if (!control) return { actor: null, authority: null };
          if (agents) {
            const actor = agents.requireToken(
              process.env.WIKI_AGENT_TOKEN,
              process.env.WIKI_AGENT_AUDIENCE,
              "default",
              "write",
            );
            if (draft?.updates?.some((update) => update?.evidence?.length))
              agents.requireToken(
                process.env.WIKI_AGENT_TOKEN,
                process.env.WIKI_AGENT_AUDIENCE,
                "default",
                "trace",
              );
            return {
              actor: actor.id,
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
          const actor = control.authenticate(process.env.WIKI_SESSION);
          if (!actor) throw new WikiError("NOT_FOUND", "Not found", 404);
          control.require(actor.id, "editor");
          return { actor: actor.id, authority: null };
        };
        const initial = authorize();
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
          process.env.WIKI_EVIDENCE_URL,
        );
        const publish = () => {
          const current = authorize();
          return saveGitEdits(
            repo,
            draft,
            verified,
            current.actor,
            current.authority,
          );
        };
        result = control ? control.transaction(publish) : publish();
      } finally {
        control?.close();
      }

      // Retry also retries a previously failed push. A failed remote never makes
      // the local durable commit disappear or creates a duplicate revision.
      try {
        if (process.env.WIKI_PUSH === "1")
          git(repo, ["push", "origin", "main"], { timeout: 30000 });
        result.remote =
          process.env.WIKI_PUSH !== "1" ? "not-requested" : "pushed";
      } catch {
        result.remote = "push-failed";
      }
      console.log(JSON.stringify(result));
    });
  } catch (e) {
    console.error(
      JSON.stringify({
        code: e instanceof WikiError ? e.code : "WRITER_UNAVAILABLE",
        error: e.message,
        status: e instanceof WikiError ? e.status : 503,
      }),
    );
    process.exitCode = 1;
  }
}
