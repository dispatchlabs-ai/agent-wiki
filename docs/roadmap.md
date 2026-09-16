# Roadmap and first contributions

The next adoption milestone is five independent users completing the
[example-to-agent walkthrough](getting-started.md) without maintainer help, then
reporting whether they use their own wiki again. This is a goal, not a claim that
those users already exist. Installation friction and missing evidence will guide
what comes next.

## Pick a bounded task

| Issue                                                                                     | Scope                                                                               | Useful experience                           |
| ----------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- | ------------------------------------------- |
| [Keyboard-only editor journey #4](https://github.com/dispatchlabs-ai/agent-wiki/issues/4) | Add one browser regression and fix any demonstrated focus/navigation defect.        | JavaScript and Playwright                   |
| [Claude Code walkthrough #5](https://github.com/dispatchlabs-ai/agent-wiki/issues/5)      | Verify one additional client against synthetic content and document exact versions. | Technical writing and access to that client |
| [WSL2 rehearsal #6](https://github.com/dispatchlabs-ai/agent-wiki/issues/6)               | Record installation, browser/client reachability, and known limits.                 | Access to a WSL2 machine                    |

Each issue includes starting files and acceptance criteria. Check the issue's
current status and leave a comment before starting substantial work to avoid
duplicating someone else's effort. Documentation corrections and focused bug
reproductions are welcome without a prior proposal. See [contributing](../CONTRIBUTING.md)
for setup and review expectations.

## What we are improving now

- A clear path from installation to a sourced answer and a reviewable edit.
- Verified client compatibility, rather than assuming every MCP client behaves alike.
- Recoverable content, isolated examples, and actionable failures.
- Small contributions with a reproducible test or observed user outcome.

## Discuss before implementation

Package/container distribution, new trace formats, and serving performance changes
need a concrete user case and verification plan. Authentication, single-space roles and authenticated remote clients are supported.
Multi-space permissions, plugin systems and ingestion pipelines remain proposals
requiring an accepted user case; they are not scheduled commitments. Keep each proposal focused
on the problem and the smallest useful change.

## Tell us where you got stuck

Use the [walkthrough feedback form](https://github.com/dispatchlabs-ai/agent-wiki/issues/new?template=walkthrough.md)
to report the last successful step, your versions, and the observed failure or
successful outcome. After trying your own content, tell us whether you came back
to use it and what made it useful. Screenshots and reproductions must use the
synthetic example. Never attach real wiki content, traces, or credentials.
