# Agent identity research: evidence audit

Supports [Agent identity and authority](agent-identity-research.md). Access date:
September 12, 2026. Evidence cutoff: retrieval time that day. Main event window:
January 1, 2025–September 12, 2026, with current undated documentation and RFC 8693
(January 2020) explicitly admitted. Date-only boundaries use America/New_York;
source timestamps retain their own timezone. Page update dates are not assumed
to be feature launch dates.

## Questions and source selection

1. Are agents separate principals, and can they hold rights? Current identity
   platform documentation and resource authorization models.
2. How do delegation and independent execution differ? OAuth specifications,
   provider integration guides, and a contrasting service-credential product.
3. What is the correct identity granularity and lifecycle? Standards source issues,
   substantive replies, and administrative documentation.
4. What changes across companies? Object models and standards federation discussions.
5. What can this wiki adopt without a new platform? A synthesis against the agreed
   space design, with recommendations labeled separately from product facts.

Broad discovery used one 10-result Exa query followed by four focused 6-result
queries. Follow-ups were limited to named availability gaps: one 6-result and one
3-result query, plus one AWS-specific web search. This was a bounded qualitative
review, not an exhaustive census. No social engagement, market share, or adoption
claim was attempted; GitHub standards discussions supplied practitioner evidence.

## Query journal

All Exa calls used the installed authenticated `request.py search` helper through
`exec_command`, default search mode, original page text, and `maxAgeHours: 24`.
Search used no publication-date filter so maintained documentation was eligible;
returned dates were checked before using any recent-event claim. All calls returned
`ok`; that records retrieval, not verification. Duplicate URLs and locale/path
variants were grouped around the canonical sources below.

| ID  | Query                                                                                                                    | Requested results | Outcome and decision                                                                                                                                                                                                                              |
| --- | ------------------------------------------------------------------------------------------------------------------------ | ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Q1  | AI agent identity authorization own principal delegated permissions on behalf of user Entra Agent ID AWS AgentCore 2026  | 10                | Entra authorization and AWS user-context implementation selected; duplicate localized OBO pages merged.                                                                                                                                           |
| Q2  | AI agent identity delegation principal OAuth IETF NIST 2026 agent authorization standards                                | 6                 | Selected NIST concept paper and draft-klrc-aiagent-auth. Other individual drafts were discovery leads, not adopted standards or dependencies.                                                                                                     |
| Q3  | agent identity own permissions delegated user Glean Google Cloud agent identity 2026                                     | 6                 | Selected Google overview and Glean documentation/announcement. Provider setup pages not needed to choose the model.                                                                                                                               |
| Q4  | AI agents do not need own identity service accounts delegation agent identity criticism limitations                      | 6                 | Required contrary search. Selected Auth0's original argument and qualification; rejected derivative summaries and unverified incident/statistical claims. Glean and standards issue replies supplied stronger counterexamples to universal rules. |
| Q5  | agent identity cross tenant cross organization delegation authorization agent Entra limitations                          | 6                 | Selected current Entra object model and followed FAQ. An older Microsoft skills limitations summary was not treated as current product truth.                                                                                                     |
| Q6  | Microsoft Entra Agent ID Google Cloud Agent Identity generally available preview September 2026 limitations cross tenant | 6                 | Required missing-evidence search. Found Entra GA statement; external summaries used only as leads.                                                                                                                                                |
| Q7  | site:cloud.google.com "Agent Identity" "Preview" "2026"                                                                  | 3                 | Google release notes resolved preview-to-GA chronology.                                                                                                                                                                                           |
| Q8  | site:aws.amazon.com "AgentCore Identity" "October 13, 2025" generally available                                          | Web search        | Recovered a primary GA statement after a guessed AWS announcement URL returned an internal retrieval error. Opened the actual original AWS article.                                                                                               |

## Original sources and claim groups

Final-source reads used `web.run` open/find/click, or public HTTP through Python's
standard library. GitHub issue bodies and every returned comment were fetched via
GitHub's official REST API. Selected content was inspected directly; there are no
pending browser handoffs. The Glean redirect was followed to its actual overview;
a redirect page alone was not counted as evidence. Microsoft pages displayed a
generic authorization notice but also returned the relevant full article text.

| Source                                                                                                                                                                       | Date/status observed                                           | Supported finding and confidence                                                                                                                                              |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Entra authorization](https://learn.microsoft.com/en-us/entra/agent-id/authorization-agent-id)                                                                               | Updated June 12, 2026                                          | High: delegated and application permission modes; restrictions exist. Avoid generalizing its directory-role rules into the wiki's roles.                                      |
| [Entra what's new](https://learn.microsoft.com/en-us/entra/agent-id/whats-new-agent-id)                                                                                      | Updated May 1, 2026; says GA                                   | High for stated product status; setup wizard separately marked preview. Do not infer every feature is GA.                                                                     |
| [Entra FAQ](https://learn.microsoft.com/en-us/entra/agent-id/faq)                                                                                                            | Current retrieval; old preview-known-issues URL redirects here | High for listed operational caveats. Consent workflow, object cleanup, and UI limitations are not evidence of failure in our untested integration.                            |
| [Entra administrative relationships](https://learn.microsoft.com/en-us/entra/agent-id/agent-owners-sponsors-managers)                                                        | Updated July 21, 2026                                          | High: technical administration and business accountability are distinct.                                                                                                      |
| [Entra design patterns](https://learn.microsoft.com/en-us/entra/agent-id/concept-agent-id-design-patterns)                                                                   | Current documentation                                          | High: template, identity, and optional user-account constructs differ; deployment boundaries matter.                                                                          |
| [Entra service principals](https://learn.microsoft.com/en-us/entra/agent-id/agent-service-principals)                                                                        | Current documentation                                          | High: single-tenant identities, cross-tenant blueprint instances, and shared blueprint credential risk. Not proof of frictionless B2B sharing.                                |
| [Google overview](https://docs.cloud.google.com/iam/docs/agent-identity-overview)                                                                                            | Updated September 11, 2026 UTC                                 | High: dedicated principal and both authority models. Permission cleanup is an operator responsibility.                                                                        |
| [Google IAM release notes](https://docs.cloud.google.com/iam/docs/release-notes)                                                                                             | April 22 and August 22, 2026 entries                           | High: identity GA and later auth manager/API GA are different milestones.                                                                                                     |
| [Google announcement](https://cloud.google.com/blog/products/identity-security/whats-new-in-iam-security-governance-and-runtime-defense)                                     | May 6, 2026                                                    | Historical launch context; release notes take precedence for later status.                                                                                                    |
| [AWS identity documentation](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/identity.html)                                                                    | Current documentation                                          | High: agent identities implemented as workload identities.                                                                                                                    |
| [AWS user-context example](https://aws.amazon.com/blogs/security/propagate-user-authorization-context-in-ai-agents-with-amazon-bedrock-agentcore/)                           | Published August 19, 2026                                      | High for documented architecture; no independent execution/reproduction. Downstream services enforce user-scoped access.                                                      |
| [AWS introduction](https://aws.amazon.com/blogs/aws/introducing-amazon-bedrock-agentcore-securely-deploy-and-operate-ai-agents-at-any-scale/)                                | July 16, 2025 article; October 13 GA update                    | High for the explicit GA update, despite the historical preview title.                                                                                                        |
| [Glean overview](https://docs.glean.com/administration/agent-identity/overview)                                                                                              | Current beta documentation                                     | High: fixed service permissions across invokers, with step/tool-level configuration and separate attribution.                                                                 |
| [Glean announcement](https://www.glean.com/blog/introducing-agent-identity)                                                                                                  | July 15, 2026                                                  | High for public-beta announcement; customer demand narrative is vendor-reported, not independently measured.                                                                  |
| [OpenFGA principal model](https://openfga.dev/docs/modeling/agents/agents-as-principals)                                                                                     | Updated September 9, 2026                                      | High: explicit agent type can use existing grants and durable membership.                                                                                                     |
| [OpenFGA task model](https://openfga.dev/docs/modeling/agents/task-based-authorization)                                                                                      | Current documentation                                          | High: task limits complement identity; the caller must be bound to the task. Example snippets are not a complete tested wiki policy.                                          |
| [OpenFGA release](https://github.com/openfga/openfga/releases/tag/v1.20.0)                                                                                                   | September 8, 2026 20:41:34 UTC                                 | GitHub API verified latest release and Apache-2.0 license; active maintenance, no workload benchmark.                                                                         |
| [AI authentication draft -03](https://datatracker.ietf.org/doc/draft-klrc-aiagent-auth/)                                                                                     | Revision July 6, 2026; metadata September 9; WG adopted        | High for text/status; not an RFC. Read sections on workload identity, authorization, and cross-domain use. Plain-text original also retrieved.                                |
| [RFC 8693](https://www.rfc-editor.org/rfc/rfc8693.html)                                                                                                                      | January 2020                                                   | High: actor/subject distinction, prior-actor semantics, and nonautomatic revocation propagation.                                                                              |
| [NIST concept paper](https://www.nccoe.nist.gov/sites/default/files/2026-02/accelerating-the-adoption-of-software-and-ai-agent-identity-and-authorization-concept-paper.pdf) | February 2026                                                  | High for proposed project/questions; not a final standard. Exa's discovery metadata incorrectly mixed in a response-paper author/date; the original PDF governed attribution. |
| [Auth0 original article](https://auth0.com/blog/ai-agents-are-not-users/)                                                                                                    | Current retrieval; not used to date an event                   | Vendor argument for distinct identity and runtime policies, with a simpler-policy qualification. Incident anecdotes and prevalence figures were not used.                     |

## Practitioner discussions and contrary evidence

Read through the GitHub API, preserving parent body and reply context:

- [#145](https://github.com/PieterKas/agent2agent-auth-framework/issues/145), August
  4–September 4, 2026, three comments: a proposal against shared identities receives
  explicit objections to prescribing logical/physical identity granularity.
- [#66](https://github.com/PieterKas/agent2agent-auth-framework/issues/66), March 13
  issue with two July 29 replies: separate logical/runtime/deployment IDs are a
  reported lab pattern; a hierarchical alternative is suggested. Neither is a
  completed universal requirement.
- [#121](https://github.com/PieterKas/agent2agent-auth-framework/issues/121), June
  4–8, five comments: debate about workload-only versus OAuth layers, including an
  implementer's same-domain experience. That self-report was not independently
  reproduced and is not evidence to adopt its product.
- [#113](https://github.com/PieterKas/agent2agent-auth-framework/issues/113), May
  22–June 2, five comments: durable user delegation, actor propagation, and where
  delegation state lives remain substantive design questions. Diagrams were not
  needed for the report's claims; it relies on the written discussion.
- [#146](https://github.com/PieterKas/agent2agent-auth-framework/issues/146), August
  25, no comments: identifies the missing no-prior-federation scenario. This is a
  contributor's gap report, not proof that no solution exists anywhere.
- [#144](https://github.com/PieterKas/agent2agent-auth-framework/issues/144), seven
  comments through September 12: inspected discussion of credential handling and
  approval boundaries. Numerical tool-population claims and assertions about other
  standards were excluded without following them into a separate research project.

The strongest counter-evidence changes the recommendation: Glean's independent
worker model rules out mandatory caller intersection for every operation. AWS's
user-scoped example rules out independent standing rights as the sole model.
Standards replies rule out presenting per-run permanent identities as consensus.

## Branch audit and stopping boundary

- Each material model has primary evidence; managed-service availability and
  OpenFGA version/license were checked. Provider-specific feature exceptions remain.
- Cost, speed, memory, and comparative security performance are unmeasured; no
  procurement ranking or production certification is made. Identity does not
  require specific model hardware. Hosted options have commercial dependencies.
- The contrary and missing-evidence searches are complete. Selected original
  bodies and relevant comment threads were read. Remaining individual draft leads
  are not required to decide whether agents can be principals with grants.
- Confidence is high in the two-mode recommendation, moderate in a portable
  integration plan, and insufficient for claims about arbitrary cross-provider
  federation, immediate distributed revocation, or production adoption rates.
- The next useful evidence is an integration test against the chosen identity
  provider, not more general search. No implementation or cloud setup was performed.
- The research agent made the final quality judgment after source review. Retrieval
  success and source counts did not determine that judgment.
