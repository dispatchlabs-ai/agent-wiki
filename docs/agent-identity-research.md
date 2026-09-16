# Agent identity and authority

**Decision-ready: model an agent as a distinct principal that can receive its own
space grants, and also support explicitly delegated authority for user tasks.**
Keep the identity stable while issuing separate, limited credentials for runs.
Do not silently combine an agent's standing rights with a user's delegated rights.

Research date and evidence cutoff: September 12, 2026, at retrieval time. Main
coverage: January 1, 2025–September 12, 2026, plus current documentation and the
foundational January 2020 OAuth Token Exchange RFC. This is a design recommendation,
not an implemented feature or a vendor selection. AI-assisted research and synthesis.
See the [evidence audit](agent-identity-evidence.md).

## Decision context

The [space design](spaces-and-access-control.md) gives articles their containing
space's permissions, without inherited source restrictions. Personal and group
spaces, a company-scoped Everybody group, administrator-only Git, searchable
traces, and a graph across spaces remain the foundation. The subsequent sharing
direction also allows external users and groups: resource ownership and principal
identity need not belong to the same company.

The question here is how agents participate in that model: who they are, whether
they hold rights, whose authority applies to a particular request, and who may
control or invoke them. Inputs are authenticated identities, space grants,
delegations, and run context. Outputs are authorization decisions and attributable
wiki reads, writes, and traces. Assume a company-controlled wiki and a trusted
execution or credential-brokering layer. No new cloud platform, identity vendor,
GPU, or model is required by this recommendation.

## What current implementations establish

| Source                      | Identity and authority model                                                                                                                                                  | Availability and limits observed                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Microsoft Entra Agent ID    | Distinct agent identities can hold application permissions or act through delegated user permissions.                                                                         | Generally available according to current release documentation; some setup UI remains preview. Not every Entra role or Graph permission is supported. [Authorization](https://learn.microsoft.com/en-us/entra/agent-id/authorization-agent-id), [status](https://learn.microsoft.com/en-us/entra/agent-id/whats-new-agent-id)                                                                                                                                                                                           |
| Google Cloud Agent Identity | A dedicated SPIFFE-based principal supports its own authority and user delegation. The principal can receive IAM grants directly.                                             | Agent Identity GA recorded April 22, 2026; auth manager and newer APIs GA August 22. Cloud-specific integration; not a universal identity accepted by every service. [Overview](https://docs.cloud.google.com/iam/docs/agent-identity-overview), [release notes](https://docs.cloud.google.com/iam/docs/release-notes)                                                                                                                                                                                                  |
| AWS AgentCore Identity      | Agent identities are workload identities. User context can be bound to the workload and carried into downstream authorization.                                                | AgentCore GA October 13, 2025; a concrete user-context example was published August 19, 2026. AWS integration still requires downstream enforcement. [Identity](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/identity.html), [example](https://aws.amazon.com/blogs/security/propagate-user-authorization-context-in-ai-agents-with-amazon-bedrock-agentcore/), [GA update](https://aws.amazon.com/blogs/aws/introducing-amazon-bedrock-agentcore-securely-deploy-and-operate-ai-agents-at-any-scale/) |
| Glean                       | Default execution uses the invoking user. Agent identity instead attaches deliberately scoped service credentials, with the same permission set for every authorized invoker. | Public beta announced July 15, 2026; current docs still label it beta. Credential selection can differ by tool or step. [Documentation](https://docs.glean.com/administration/agent-identity/overview), [announcement](https://www.glean.com/blog/introducing-agent-identity)                                                                                                                                                                                                                                           |
| OpenFGA                     | An `agent` principal participates in the existing resource hierarchy, including durable grants. Task constraints are an additional layer.                                     | Current modeling guides updated September 9; server v1.20.0 released September 8, Apache-2.0. It supplies authorization checks, not agent authentication or a secure runtime. [Principal model](https://openfga.dev/docs/modeling/agents/agents-as-principals), [release](https://github.com/openfga/openfga/releases/tag/v1.20.0)                                                                                                                                                                                      |

These independently maintained implementations support the architectural direction.
They do not establish market adoption, equivalent guarantees, or a universal agent
identity protocol. Microsoft, Google, AWS, and Glean are commercial managed services;
using them requires their accounts, integrations, and applicable commercial terms.
No prices, comparable latency, memory use, or operating costs were measured. OpenFGA
is a self-hostable option requiring a server and persistent storage; selecting it
is a separate decision from adding an agent type to the wiki.

## What the standards work says

The July 6 revision of **AI Agent Authentication and Authorization** treats agents
as workloads and reuses workload identity and OAuth mechanisms. It covers user
delegation, an agent's own authorization, and cross-domain access. Its status page
shows working-group adoption with a September 9 metadata update. It remains an
Internet-Draft, not an RFC or a completed interoperability standard. [Draft -03](https://datatracker.ietf.org/doc/draft-klrc-aiagent-auth/)

OAuth Token Exchange already distinguishes the subject from the acting party. Two
limits matter: exchanged tokens do not automatically share revocation fate, and
nested prior actors are an audit history rather than additional authorities to
use in access decisions. Delegation validation and revocation must therefore be
implemented, not inferred from a token containing a chain. [RFC 8693, sections 2.1 and 4.1](https://www.rfc-editor.org/rfc/rfc8693.html)

NIST's February 2026 concept paper asks how to identify agents, delegate access,
and connect actions to accountable identities. It proposes applying existing
standards; it does not settle the product model. [NCCoE concept paper](https://www.nccoe.nist.gov/sites/default/files/2026-02/accelerating-the-adoption-of-software-and-ai-agent-identity-and-authorization-concept-paper.pdf)

## Recommended wiki model

The following choices are proposed for this project, rather than requirements
imposed by the sources.

### A principal, a definition, and a run are different things

| Object           | Meaning                                                                      | Example                                |
| ---------------- | ---------------------------------------------------------------------------- | -------------------------------------- |
| Agent definition | Versioned instructions, tools, and configuration                             | A reusable research assistant template |
| Agent principal  | A named, independently manageable identity with an owner and optional grants | A company's research assistant         |
| Run              | One execution, with a specific authority mode, task scope, and expiry        | Preparing this week's project update   |

Do not identify the agent by the model name. Replacing the model or restarting a
worker need not create a new logical colleague. Conversely, copying a template
into another company must not copy the original agent's identity or grants.

Give each logical agent a durable ID and each run a separate ID. Record the
version/deployment used in each run. Create a separate principal when independent
permissions, ownership, or revocation are needed; do not require a permanent
directory account for every transient helper invocation.

This granularity is a design choice, not settled consensus. In an August–September
standards discussion, a contributor argued against shared execution identities;
respondents explicitly left logical-versus-physical granularity to implementers.
A related thread discusses separate agent, runtime, and deployment identifiers.
[Discussion #145 and replies](https://github.com/PieterKas/agent2agent-auth-framework/issues/145),
[discussion #66](https://github.com/PieterKas/agent2agent-auth-framework/issues/66)

### Two explicit authority modes

| Mode          | Where rights come from                                                                                  | Suitable use                                         |
| ------------- | ------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| Delegated     | The user's current access, limited by their delegation, the permitted task, and applicable agent policy | A personal assistant searching or editing for a user |
| Own authority | Grants to the agent, directly or through its groups, limited by the permitted task and policy           | A shared librarian or scheduled team worker          |

In delegated mode, the agent does not need a duplicate permanent grant on every
space the user can access. An explicit delegation authorizes it to exercise a
specified subset of that user's rights. Agent policy can impose a further ceiling.
Never infer delegation merely because somebody owns the agent or typed a request.

In own-authority mode, apply the familiar space roles to the agent. Ownership does
not copy the owner's rights. The agent can have more access than a particular
invoker, just as a purpose-built service can perform a bounded operation that its
caller cannot perform directly.

A schedule is a trigger, not an authority source. A personal nightly assistant can
remain delegated through a durable, revocable authorization. An independent team
worker can instead keep working under its own grants when its original creator
leaves, provided responsibility has been transferred.

The same logical agent can support both modes, but each request must have an
explicit authorization basis. A delegated denial must not trigger an automatic
retry using broader standing credentials. Mixed workflows need explicit steps and
context boundaries; never use the union of both permission sets as a convenience.

### Agents are also resources that other principals control

Separate permissions to **invoke**, **configure**, and **manage access** to an
agent from the agent's permissions on spaces. An external company might be allowed
to invoke a reporting agent without being allowed to change its instructions or
read all of its source material.

Treat configuration control as powerful: somebody who can replace tools,
instructions, or destinations may redirect the agent's existing authority. Keep
configuration changes attributable and credential/grant changes separately
controlled. Record an accountable owner and provide suspension and ownership
transfer. Microsoft's separation of technical owners from business sponsors is a
useful precedent, without requiring the wiki to reproduce all its roles.
[Administrative relationships](https://learn.microsoft.com/en-us/entra/agent-id/agent-owners-sponsors-managers)

Allow ordinary groups to contain agents where explicitly intended. **Proposed
default:** Everybody automatically includes human company members, not every new
agent. An agent using delegated authority can still use a person's Everybody
access when covered by the delegation; an own-authority agent receives explicit
grants or group membership. This default needs product agreement before implementation.

### Cross-company sharing uses the same grants

A resource owner can grant an external agent access to a space, just as it can
grant an external person access. Identify principals by a trusted issuer and
stable subject, not display name or email alone. Receiving a signed identity from
another company establishes who is asking; the receiving resource still decides
what access to grant. An agent's home company cannot confer rights over somebody
else's space.

For delegated access, preserve both the external agent and the delegating user,
then enforce the receiving resource's policy. For own authority, grant the named
external agent directly. Revoking a space grant must work independently of whether
the external company deletes the agent.

Do not assume arbitrary identity-provider interoperability. Entra, for example,
represents agent identities as single-tenant objects even though a blueprint can
produce identities across tenants. A standards issue also identifies access
without prior federation as an unresolved gap. Start with explicit registration
and trusted identity mappings, then add federation adapters as needed.
[Entra object model](https://learn.microsoft.com/en-us/entra/agent-id/agent-service-principals),
[cross-domain gap #146](https://github.com/PieterKas/agent2agent-auth-framework/issues/146)

### Execution, traces, and articles

Authenticate at a trusted boundary and obtain short-lived credentials scoped to
the wiki and run. Keep underlying secrets out of model context and searchable
traces. A caller-supplied agent name, task ID, or purported user ID is not proof of
authority. The execution layer must bind those values to authenticated credentials.

Record the agent, initiating principal or schedule, authority mode, delegation or
grant reference, run, affected resource, and result. Retain immutable source traces;
store verified attribution in associated trusted records rather than rewriting
original events. Trace readership remains a separate space-placement question.
An invoker need not receive access to a privileged worker's complete raw trace.

Check current grants on each request, deny expired or revoked delegation, and stop
or reauthorize affected work. A new task ID does not erase confidential material
from an existing context, so do not reuse privileged session memory indiscriminately.
Resource revocation cannot make already received plaintext disappear.

**Article permissions remain exactly as agreed:** an authored article belongs to
its destination space. Agent identity does not introduce source-permission
inheritance. An agent with suitable grants can author a document for that audience;
access control cannot decide whether its prose makes an appropriate disclosure.

## Counter-evidence and limits

A rule that all agents must always be limited by the current invoker would exclude
Glean's deliberately supported independent-worker model. Conversely, giving every
personal assistant independent standing rights loses the useful user boundary
illustrated by AWS. Both modes are needed; neither should silently substitute for
the other.

A new principal type does not demand a new authentication protocol. Standards
reviewers discuss workload authentication with local authorization as a sufficient
baseline for some non-delegated, same-domain calls, adding OAuth where the scenario
needs it. This is practitioner discussion, not a tested universal recipe.
[Issue #121 and replies](https://github.com/PieterKas/agent2agent-auth-framework/issues/121)

Some vendor writing argues that ordinary roles cannot work for agents. Our smaller
space model does not need to adopt that conclusion: evaluate the existing grants
at request time and add explicit delegation/run constraints. A commercial Auth0
article itself acknowledges that simpler attribute-based policies may suffice;
its advocacy and OpenFGA's advocacy are related evidence, not independent adoption
signals. [Auth0 discussion](https://auth0.com/blog/ai-agents-are-not-users/)

No live cloud integration, adversarial benchmark, or interoperability test was
performed. Provider lifecycle and consent behaviors have documented exceptions;
GA is not evidence that our design is correctly integrated. Before implementation
is accepted, test two users, two companies, a delegated assistant, and an independent
worker against expiry, revocation, identity spoofing, cross-company grants,
unauthorized invocation/configuration, and accidental switching of authority.

The evidence is sufficient to choose the identity model. The remaining decisions
are which agents need standing grants, Everybody membership, delegation duration
and subdelegation rules, and the first external identity integration. My final
quality judgment is based on reviewing original sources and contradictory cases;
no source-count script or vendor claim establishes that judgment.
