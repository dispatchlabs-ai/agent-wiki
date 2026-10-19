# Agent Wiki use cases

This inventory records 61 high-level use cases in 10 groups for Agent Wiki.
Each entry has a stable ID, a short goal title, and one sentence describing an
actor's intended outcome. IDs remain stable when entries move between groups.

These are product goals, not an implementation checklist or a claim about a
particular installation. The linked contracts supply permissions and conditions;
[release notes](CHANGELOG.md), [verification](docs/verification.md), and deployment
records establish what was released or checked. Current service scope is one
knowledge space per instance. Original evidence needs editorial authority and,
for scoped agents, trace permission; article writing must also be enabled.

“Reader,” “editor,” “manager,” “operator,” and “integrator” describe responsibilities.
A reader or editor may be a person or an authorized agent. Operators administer
storage and deployment separately from ordinary service access; agent owners
control who may use or change an agent.

## 1. Establish shared knowledge

Context: [getting started](docs/getting-started.md) and
[using Agent Wiki as shared memory](README.md#use-agent-wiki-as-shared-memory).

- **AW-001 — Try the complete workflow.** A prospective user tries synthetic knowledge, follows a source, and previews or saves an edit before adopting the wiki.
- **AW-002 — Keep an owned knowledge collection.** A knowledge owner maintains a shared collection of Markdown articles with history in a separate Git repository.
- **AW-003 — Recall prior knowledge.** A person or agent finds recorded facts, decisions, and procedures relevant to ongoing work.
- **AW-004 — Preserve useful learning.** An authorized agent records useful, verified knowledge during work under its user's instructions so later participants can reuse it.

## 2. Find and read articles

Context: [article interfaces](docs/interfaces.md), [article reads](docs/api.md),
[Markdown profile](docs/markdown-profile.md), and [published media](docs/article-media.md).

- **AW-005 — Find relevant knowledge.** A reader searches articles by their text and descriptive metadata to find information relevant to a question.
- **AW-006 — Browse the collection.** A reader explores the article catalog and topics to discover available knowledge.
- **AW-007 — Follow related knowledge.** A reader follows article links and backlinks to understand connected subjects.
- **AW-008 — Read the relevant passage.** A reader requests an article's outline, selected section, or metadata while retaining its identity and citation.
- **AW-009 — Understand a rich document.** A reader views an article's prose, tables, diagrams, mathematics, and other supported formatting as one readable document.
- **AW-010 — Read an earlier account.** A reader opens a historical article revision and cites that particular version.
- **AW-011 — Open published media.** A reader views images or PDFs deliberately published with an article under article access permissions.

## 3. Maintain the knowledge collection

Context: [article editing](docs/api.md), [content format](README.md#content-format),
and [published media](docs/article-media.md).

- **AW-012 — Create an article.** An editor adds a durable explanation of a subject to the knowledge collection.
- **AW-013 — Revise an article.** An editor updates an existing explanation as new information or decisions become available.
- **AW-014 — Connect related subjects.** An editor links articles so readers can follow relationships and discover supporting context.
- **AW-015 — Make knowledge discoverable.** An editor maintains useful titles, descriptions, topics, and relationships for the collection.
- **AW-016 — Inspect a draft.** An editor previews how proposed Markdown will appear before saving it.
- **AW-017 — Support a claim with evidence.** An editor adds source citations and, when supported by the configured evidence provider, verifies exact conversation quotations before publication.
- **AW-018 — Update related articles together.** An editor saves coordinated changes as one atomic update, including new articles that link to one another.
- **AW-019 — Retire an article coherently.** An operator removes an article and updates its incoming links together while retaining its earlier revisions.

## 4. Review and recover article changes

Context: [write consistency and recovery](docs/api.md) and
[shared interface guarantees](docs/interfaces.md).

- **AW-020 — Review attributed history.** A reader inspects who changed an article, why it changed, and its retained revisions.
- **AW-021 — Resolve an editing conflict.** An editor learns that an article changed since it was read and reconciles the draft with the current revision.
- **AW-022 — Recover an uncertain save.** An editor retries the same uncertain operation and recovers its original result without creating another change.
- **AW-023 — Understand publication progress.** An editor distinguishes a committed change, its remote Git push, and its availability to readers.
- **AW-024 — Read newly committed knowledge.** A reader sees committed article updates without waiting for a content build or application redeployment.

## 5. Investigate original evidence

Context: [imported traces](docs/traces.md) and
[external evidence](docs/external-evidence.md); available evidence depends on the
configured provider and whether Conversations is enabled.

- **AW-025 — Find a relevant conversation.** An authorized editorial reader searches recorded dialogue to locate the source behind a question or claim.
- **AW-026 — Read a source in context.** An authorized editorial reader examines original conversation passages around the evidence they need.
- **AW-027 — Inspect the recorded work.** An authorized editorial reader examines available tool activity, reasoning, and other source records when dialogue alone is insufficient.
- **AW-028 — Understand source provenance.** An authorized editorial reader inspects recorded session, snapshot, branch, and source relationships to understand where evidence came from.
- **AW-029 — Cite precise evidence.** An authorized editorial reader links to the original event or source line supporting a claim.
- **AW-030 — Inspect a captured attachment.** An authorized editorial reader previews or retrieves an available original file through the configured external evidence provider.
- **AW-031 — Read a large source progressively.** An authorized editorial reader retrieves selected pages, records, or text ranges while retaining access to the complete supported original source.

## 6. Sign in and protect a personal account

Context: [authentication](docs/authentication.md) and
[two-factor authentication](docs/two-factor-authentication.md).

- **AW-032 — Sign in as the intended person.** A person uses a configured local or federated identity and receives only that identity's current wiki access.
- **AW-033 — Maintain a local password.** A person changes their local password and invalidates other sessions using the former account state.
- **AW-034 — Protect sign-in with a second factor.** A person enrolls and manages passkeys, an authenticator app, or both for their own identity.
- **AW-035 — Recover access after losing a factor.** A person uses a recovery code or obtains a trusted operator reset for their exact identity.
- **AW-036 — End a browser session.** A person signs out of the current browser session when finished using the wiki.

## 7. Manage access to knowledge

Context: [single-space access](docs/authentication.md),
[agent access directory](docs/remote-agents.md), and [security boundaries](SECURITY.md).

- **AW-037 — Invite a local user.** A manager gives an intended person a private account-setup invitation and grants wiki access separately.
- **AW-038 — Assign wiki responsibilities.** A manager grants or changes a person's or agent's reader, editor, or manager role within the permitted role model.
- **AW-039 — Enroll company readers deliberately.** An operator enables automatic reader enrollment for new verified identities in one chosen Google Workspace domain.
- **AW-040 — Inspect people and agent access.** A manager reviews identities, wiki roles, and agent creators, owners, sharing, and enabled tools without gaining control of another person's agent.
- **AW-041 — Withdraw wiki access.** A manager or operator revokes the relevant grants or disables an identity so affected requests no longer receive protected knowledge.

## 8. Define and connect agents

Context: [remote agents](docs/remote-agents.md) and
[operator-managed agent credentials](docs/agent-setup.md).

- **AW-042 — Define a named agent.** An agent owner creates an identifiable agent with instructions and exposed wiki tools, with content access granted separately.
- **AW-043 — Revise an agent deliberately.** An agent owner or authorized editor updates its versioned definition while existing connections retain the version they approved.
- **AW-044 — Share control of an agent.** An agent owner or authorized access manager grants another person permission to use the agent, edit its definition, or manage its access.
- **AW-045 — Authorize a remote client.** A person connects a compatible client using an explicitly selected agent and approved scope, with the person and acting agent recorded separately.
- **AW-046 — Keep a trusted machine connected.** An operator enrolls an independent agent credential that can renew short-lived access until its chosen expiry or revocation.
- **AW-047 — Delegate bounded authority.** An operator enrolls a delegated agent whose access stays within the named person's current authority and the delegation's scope and lifetime.
- **AW-048 — Disconnect an agent client.** A person or authorized operator revokes a selected connection or machine credential independently of browser sign-out.

## 9. Use the wiki through other tools

Context: [interface inventory](docs/interfaces.md), [API contract](docs/api.md),
[terminal CLI](docs/cli.md), and [external evidence integration](docs/external-evidence.md).

- **AW-049 — Use a preferred client.** A person or agent reads and maintains knowledge through a supported browser, MCP, WebMCP, HTTP, or terminal client under consistent service permissions.
- **AW-050 — Automate a content workflow.** An integrator uses documented operations and structured results to work with articles without direct access to their storage.
- **AW-051 — Retain identity across clients.** A terminal user or integration selects human or agent authentication explicitly and retains the corresponding permissions and attribution.
- **AW-052 — Connect an existing evidence archive.** An operator connects a compatible read-only evidence service so authorized readers can inspect its conversations and files through the wiki.

## 10. Operate and recover a wiki

Context: [hosting boundaries](SECURITY.md), [managed lifecycle](docs/lifecycle.md),
[packages](docs/packaging.md), [trace storage](docs/traces.md),
[published media](docs/article-media.md), and [upgrades](docs/upgrading.md).

- **AW-053 — Host a shared wiki.** An operator runs an authenticated wiki for an individual or trusted team behind controlled HTTPS access on a supported platform.
- **AW-054 — Establish installation ownership.** An operator initializes a managed installation or adopts existing content and identities without replacing their authoritative records.
- **AW-055 — Choose article-only operation.** An operator disables or restores Conversations for an installation while preserving archives, existing article citations, and separately published media.
- **AW-056 — Retain original conversations.** An operator explicitly imports supported conversation snapshots without rewriting their original bytes or discarding a source because of its total size.
- **AW-057 — Publish selected article assets.** An operator publishes reviewed images or PDFs with provenance so article readers can use them independently of restricted original evidence.
- **AW-058 — Diagnose service readiness.** An operator checks installation health and distinguishes article availability from evidence-provider or derived-index problems.
- **AW-059 — Keep derived data recoverable.** An operator rebuilds or relocates disposable search indexes while preserving authoritative content and original citations.
- **AW-060 — Recover durable knowledge and access.** An operator backs up and restores articles, history, identities, permissions, evidence, and published media under their documented recovery requirements.
- **AW-061 — Upgrade or repair an installation.** An operator applies a compatible release or recovers interrupted maintenance while preserving authoritative state and a usable recovery path.

## Scope still to reconcile

The [space and access design](docs/spaces-and-access-control.md) records personal
and group spaces, sharing across organizations, and one graph across authorized
spaces as intended design directions. Those proposals remain separate from the
current single-space service; their acceptance and delivery scope need explicit
reconciliation before they become current commitments. The
[roadmap](docs/roadmap.md) keeps other proposals and adoption work separate.
An omitted case does not establish an exclusion.

Conversations configuration in AW-055 is present on `main` after 0.9.4 and remains
unreleased as of October 19, 2026; its inclusion does not assert a live rollout.
