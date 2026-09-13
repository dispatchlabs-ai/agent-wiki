# Spaces and access control

Status: design direction, September 12, 2026. This document records the intended
company knowledge model; it does not describe implemented authorization. The
original baseline lacked authentication. The current engine implements
[single-space authentication](authentication.md) and [remote agent access](remote-agents.md);
multi-space composition below remains a design. It was drafted with AI assistance.

The agent model below incorporates the [agent identity research](agent-identity-research.md).
That report and its evidence audit preserve the comparisons and reasoning behind
the design direction. The [architecture](architecture.md) and
[implementation milestones](implementation-plan.md) define concrete defaults and
implementation boundaries. No migration tooling or backward-compatibility layers
are required; preserve original content and traces while developing the new model.

## Purpose

Provide personal and shared knowledge spaces with familiar document permissions.
Capture all supported agent conversation traces and make them searchable within
their authorized audience. Articles remain Markdown documents connected by a
Wikipedia-style graph, with Git providing their history.

The product model is similar to a shared document system: users see their own
spaces and spaces available through their groups. They should not need to know
where repositories, trace archives, or search indexes live.

## Agreed permission model

People and organizations own spaces and administer identities and groups. Users
and agents are principals that can receive grants directly or through groups,
including grants from another organization. Every article belongs to one space
and inherits that space's permissions. Initial roles are reader, editor, and
manager: readers view content, editors also change content, and managers also
manage the space's access. Per-article permission exceptions are outside the
initial model.

Users have personal spaces, private to their owners by default, and access to
shared spaces through group membership. A person can belong to several groups.
The effective collection they can browse and search is the union of spaces they
can access. Explicit sharing of a personal space uses the same grant model.

**Everybody** is a built-in group containing active human company members. Granting
it access makes a space available company-wide; it does not make content public on
the internet. Membership follows company membership automatically. Guests and agents
receive explicit access rather than automatic Everybody membership.

| Example space        | Grant                                 | Result                                             |
| -------------------- | ------------------------------------- | -------------------------------------------------- |
| A person's workspace | Owner manages it                      | Personal work is private by default                |
| Engineering          | Engineering group edits               | Team members share a working space                 |
| Company handbook     | Everybody reads; handbook group edits | All members can read; a smaller group maintains it |

Company administrators are trusted operators with access to underlying storage.
Private spaces are restricted from ordinary users, not a promise of secrecy from
those administrators. A space manager does not acquire direct Git access.

## Sharing across organizations

An organization is an administrative boundary. A resource owner can grant access
to a person, group, or agent outside that organization using the same space roles.
Sharing does not transfer ownership or grant direct access to Git. Initial sharing
remains space-level; document and folder exceptions are possible later extensions.

Identify external principals through a trusted issuer and stable subject, rather
than display names or email alone. Authentication establishes who is requesting
access; the resource's grants determine whether to allow it. A principal's home
organization cannot grant itself access to another organization's resources.

Everybody is scoped to its own organization. Sharing with another organization's
Everybody group deliberately delegates membership management to that organization.
Group membership changes and removal of external grants must affect subsequent
access. Identity-provider federation and cross-deployment search are integration
work; this model does not imply automatic interoperability between arbitrary wikis.

## Agents as principals and resources

A named agent has a stable principal ID, an accountable owner, and optional space
grants or group memberships. Ownership does not copy the owner's permissions.
Agents use the same resource grants as other principals and can be suspended or
have grants revoked independently of their owners.

Distinguish three objects:

| Object           | Purpose                                                                   |
| ---------------- | ------------------------------------------------------------------------- |
| Agent definition | Versioned instructions, tools, and configuration that can be reused       |
| Agent principal  | The named identity to which access and responsibility attach              |
| Run              | An execution with its own ID, authority mode, task scope, and credentials |

A model name is not an agent identity. Restarting a worker or changing its model
need not create a new principal. Copying a definition into another organization
does not copy its identity or grants. Create separate principals where independent
ownership, permissions, or revocation are needed; transient helpers need not each
become permanent directory entries. Record the definition version and runtime
identity with each run.

### Authority for a run

| Mode          | Authorization basis                                                                                    | Example                                            |
| ------------- | ------------------------------------------------------------------------------------------------------ | -------------------------------------------------- |
| Delegated     | The user's current rights, narrowed by an explicit delegation, task scope, and applicable agent policy | A personal assistant researching accessible spaces |
| Own authority | Direct or group grants to the agent, narrowed by task scope and policy                                 | A team librarian maintaining shared articles       |

Delegation does not require duplicating permanent space grants onto the agent.
It authorizes a specified subset of a user's rights. Ownership or a natural-language
request alone is not proof of delegation; trusted infrastructure must establish
and validate it.

An independent worker can have rights its invoker lacks. A schedule is only a
trigger: a background personal assistant may still use durable, revocable user
delegation, while a team worker may use its own standing grants.

Every request must have an explicit authority basis. Do not union delegated and
standing rights or retry a delegated denial with broader credentials. Mixed
workflows need explicit steps and context boundaries. A new run ID alone does not
isolate memory or credentials from another run.

### Who can use and control an agent

Separate permission to invoke an agent, configure it, and manage its access from
the agent's permissions on spaces. These permissions may themselves be shared with
external principals. An external user could invoke a reporting agent without being
able to rewrite its instructions or directly read all its sources.

Configuration control can redirect the agent's existing authority. Keep changes
to instructions, tools, destinations, and credentials attributable, and control
who can make them. Provide suspension and ownership transfer so departure of an
owner does not leave an unmanaged worker.

Ordinary groups may explicitly include agents. The initial architecture defaults
Everybody to human membership only, with explicit grants or group membership for
independent agents. Delegated agents can exercise a user's Everybody access when
the delegation covers it.

### Credentials, attribution, and revocation

Bind the agent, user where applicable, and run to authenticated credentials at a
trusted boundary. Issue short-lived, audience-scoped credentials and keep underlying
secrets out of model context and captured traces. Caller-supplied names and IDs are
not authorization evidence. An external agent needs a trusted identity mapping as
well as a grant or valid delegation at the receiving resource.

Record the agent, initiating user or schedule, authority mode, delegation or grant
reference, run, affected resource, and result. Preserve original trace records;
verified attribution belongs in associated trusted records. Permission to invoke
an agent does not imply permission to read its complete raw trace.

Evaluate current grants and delegation on requests. Expiry, revocation, or agent
suspension must stop affected access and require reauthorization where appropriate.
Revoking an upstream token does not necessarily revoke already exchanged tokens;
the implementation must enforce the intended revocation behavior. Stopping access
cannot erase plaintext already received.

## Articles are authored documents

An article's destination space determines who can read it. Its permissions do
not inherit from the documents or conversations its author consulted. Human and
agent authors may know more than is appropriate to disclose to a particular
audience; they are responsible for writing an appropriate document for that
space.

There is no automatic intersection of source audiences, propagated confidentiality
label, or source-driven publication approval in the core article permission model.
Citations record evidence, not access grants. An article can therefore be readable
while some of its cited sources are restricted. Company editorial or agent policies
may guide disclosure separately without changing this rule.

An agent writing an article should receive the destination space and audience as
part of its task. Its reads and writes still require authorization. A valid write
grant establishes permission to edit the destination; it cannot establish that the
prose contains only appropriate disclosures.

## One graph across spaces

Spaces partition access and storage, not the conceptual graph. Articles may link
to articles in other spaces. The wiki resolves article identities independently
of repository paths, so a repository boundary need not break navigation.

A link grants no access to its target. Search results, backlinks, graph views,
titles, snippets, and previews must be filtered to the viewer's accessible spaces.
Do not fetch a restricted target's title or excerpt into an accessible page. Text
already authored in that page, including an explicit link label, is part of that
page and follows its permissions.

Stable article identity survives a move between spaces. The architecture uses an
immutable article ID independent of filenames and resolves inaccessible or missing
targets without exposing protected metadata. Today's basename IDs and repository-local
link validation will be redesigned directly, without compatibility layers.

## Capture and search all traces

Trace capture is comprehensive; visibility is authorized. Retaining a trace does
not make it company-wide readable or searchable. Trace catalogs, dialogue search,
original records, tool results, downloads, and eventual attachment serving must
all enforce the trace's access boundary.

Traces retain their existing authoritative form: immutable original JSONL in a
separate archive. Repository-per-space does not imply putting trace blobs in Git.
Indexes and rendered views remain rebuildable derivatives. Article citations
must not grant access to the underlying trace.

Trace visibility follows its explicitly assigned space. The architecture defaults
personal delegated runs to the user's private space and independent workers to a
restricted working space. Shared sessions choose a destination before capture.
Raw traces are independently retained records; changing source access does not
automatically reclassify them. This does not introduce inherited source permissions
for articles derived from those traces.

The current trace search indexes selected dialogue fields; comprehensive capture
and searching every captured field are distinct capabilities. Decide the desired
search coverage explicitly while preserving every original record. See
[trace storage and rendering](traces.md) for current behavior.

## Proposed storage direction: one repository per space

Prefer one administrator-only content Git repository per space. Ordinary people
and agents use authorized wiki interfaces; the service performs Git operations.
Git hosting does not need to reproduce every reader, editor, and group grant.
Trusted service credentials are operational access, not user-facing Git access.

This aligns article history, export, archival, and restoration with the space.
Repositories remain separate from the engine repository. Several spaces can be
served by one company deployment; a repository does not require its own process,
container, or running wiki instance.

| Storage choice             | Benefits                                                                  | Costs                                                                      |
| -------------------------- | ------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| One repository per company | Fewer repositories; atomic commits across spaces                          | Shared history and recovery boundary; space exports need filtering         |
| One repository per space   | History and lifecycle align with spaces; independent exports and restores | More repository management; cross-space writes are not one Git transaction |

A company-level registry will need to map space identities to repositories and
access grants. Its storage format is undecided. Repository contents must not let
an ordinary editor grant themselves access or change company membership.
Authorization should be centralized across all interfaces, including historical
reads and retry receipts. Rebuildable search indexes may span repositories, but
must filter using current grants before returning results to a person or model.

### Moving an article

A cross-space move changes its audience and involves two repositories. It needs
an explicit operation with destination and source authorization, conflict checks,
and recoverable progress. It must not be represented as an atomic Git commit.

The proposed default is to transfer the current article while retaining its old
history in the original space. That avoids automatically sharing deleted passages
with the destination audience. Keep the article's stable identity and resolve its
current location through the wiki. Historical access stays subject to the original
space's permissions; old receipts and cached versions need the same treatment.

This move behavior is a proposal to settle before implementation, along with
identifier collisions, redirects, deletion, and recovery from a partial move.

## Implementation boundaries and remaining decisions

Implement authentication, company membership, space grants, and authorization for
all read/write routes before presenting this as a company access-control system.
Membership revocation must affect subsequent requests and authorization caches.
Backing repositories, trace archives, and indexes must not be directly accessible
to ordinary clients outside those checks.

The architecture and implementation milestones resolve the initial defaults for
trace placement, identifiers, sharing, and move recovery. Remaining implementation
choices include the identity provider and credential adapter, delegation duration
and renewal, and detailed ownership-transfer workflows. Cross-installation federation,
nested groups, and subdelegation are deferred extensions.

Verify isolation with synthetic spaces and users across search, links, history,
traces, assets, writes, receipts, and membership changes. Also verify useful normal
work: personal access, group access, Everybody access, and same-space editing.
Include two organizations, delegated and independent agents, unauthorized invocation
and configuration, spoofed identity/run claims, and attempts to switch authority
after a denial. Verify external grant revocation and trace visibility separately.
These tests belong to implementation; this document changes no runtime behavior.
