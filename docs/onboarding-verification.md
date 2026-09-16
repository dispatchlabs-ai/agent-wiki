# Onboarding and discovery verification

## September 16, 2026 — contributor browser checks

Following the published contributor instructions on public 0.6.0 reproduced a
30-second timeout in the responsive browser sweep. A diagnostic run with enough
time to finish took 41.8 seconds: one test visited 154 route/size/theme combinations
and captured 72 screenshots. Its slowest navigation took 674 ms. The clean-clone
gate had hidden this mismatch with a longer timeout than the documented command.

Responsive and rich Markdown sweeps now use separate tests for each screen size
and theme. All 154 responsive and 28 rich-page visits, assertions and screenshots
remain covered; theme preference persistence has its own test. Both the global
clean-clone override and the rich sweep's extended timeout were removed.

The corrected source passed `scripts/check` on Linux x86-64 (Node 26.8.1, npm
11.19.0) and in a fresh public clone with the candidate patch on macOS arm64
(Node 26.5.0, npm 11.17.0). Each run passed formatting, contracts, types, 144
application tests, 65 Chromium browser tests and the production dependency audit.
The revised matrix cases took 1.6–3.7 seconds on these machines, using the default
30-second test limit, one worker and no retries. The complete browser suite took
about two minutes. The higher test count reflects smaller cases, not added
coverage. These checks use synthetic temporary repositories and do not establish
performance for every host or private corpus.

## September 16, 2026 — 0.5.1 documentation

The README's exact agent prompt was rehearsed by separate fresh agent sessions on
Linux and macOS. The candidate `docs/agent-workflow.md` was supplied locally because
it was not published yet; each agent independently cloned public 0.5.0 source into
a new temporary directory. Application behavior is unchanged in 0.5.1. Each trial
used an available loopback port, public npm dependencies and synthetic examples.
Neither agent used private content or altered global client settings.

Both agents exercised MCP through the official SDK from temporary scripts; this
verifies the agent-guided workflow, not automatic in-session MCP configuration in
every client. Both completed install, loopback startup, health, discovery (11 tools),
article search/read, original source reading and unsaved preview without user
intervention. The answer was two weeks, reviewed by Morgan Vale, supported by pi
trace `1becc1c6b6aff33213fee188a377c98641a4d78146ebd6f0ea7b9e7720709ce7` line 5.
Both verified unchanged example Git history and clean worktrees. They stopped
their own servers at the end (the test-only exception to leaving them running).

| Environment        | Runtime                              | Outcome                   |
| ------------------ | ------------------------------------ | ------------------------- |
| Linux              | Node 26.8.1, npm 11.19.0, Git 2.55.0 | All workflow steps passed |
| macOS 26.6.2 arm64 | Node 26.5.0, npm 11.17.0, Git 2.50.1 | All workflow steps passed |

npm emitted nonblocking dependency install-script approval notices; installation
and UI build still succeeded. Preview was verified from returned HTML, not a
visual browser inspection. The agents' candidate instructions were local while
the runnable checkout was the unchanged public 0.5.0 engine.

The hosted setup has a separate regression in `tests/hosting-setup.test.mjs`:
it runs the documented bootstrap CLI and production server with a fresh content
repository/control database, rejects anonymous content, completes initial account
setup, reads an article, restarts and verifies retained session access. It models
HTTPS reverse-proxy Host/Origin headers on loopback; it does not provision DNS or
certificates or establish external client compatibility.

## Unbranded discovery baseline

An independent agent, given only the need for a self-hosted Markdown wiki with Git
history, MCP editing and links to original agent conversations, performed six
public web queries on September 16, 2026:

1. `open source self hosted Markdown wiki Git MCP agent conversations`
2. `GitHub wiki MCP Markdown conversation provenance Git`
3. `wiki "MCP" "conversation" "git-backed"`
4. `wiki "MCP" "conversation traces"`
5. `self hosted markdown wiki MCP "conversations" "git" provenance`
6. `wiki MCP "articles" "traces" git`

The agent did not identify Agent Wiki. It found [AdvWiki](https://github.com/dfalci/mcp-advwiki),
[mcp-llm-wiki](https://github.com/np6126/mcp-llm-wiki), and
[Sourcebook](https://github.com/BackendGameSetMatch/sourcebook). It judged AdvWiki a
conditional documented match when conversations are deliberately ingested and Git
autocommit enabled; other candidates were partial matches. This was README-level
inspection, not runtime competitor validation. Queries were submitted in pairs,
so merged search output does not establish individual query ranks.

A separate GitHub repository query `wiki mcp markdown` through `gh search repos`
returned zero results (limit 20). These bounded observations establish weak
unbranded discovery in this sample, not an exhaustive index/ranking assessment or
proof that the project is undiscoverable. No adoption outcome is inferred.

The repository description and topics describe Git, Markdown, MCP/WebMCP and
conversation evidence. Its homepage now points to the current public README.
Search visibility and successful onboarding remain separate measurements.
