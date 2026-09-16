# Agent guidance

- Read README.md and the relevant docs before changing behavior.
- Run `npm ci` for setup and `npm run check` before submitting changes. Linux or macOS,
  Node 24.19+ and Git are required. `npm run example` uses synthetic data.
- Keep the engine independent of content and deployment. Git owns article history;
  immutable JSONL owns trace evidence; indexes and rendered caches are derived.
- Preserve on-demand rendering of Markdown articles and JSONL conversations.
  Content updates must not require a site build or application redeployment.
  UI components and Markdown extensions must retain this dynamic rendering model.
- Preserve revision checks, atomic batches, retry receipts, sanitization, stable
  citations, and original trace records. Do not flatten branches or invent events.
- Use only synthetic fixtures and temporary content repositories in tests. Never
  read or modify an operator's real wiki or trace archive while testing.
- Preserve unrelated changes. See CONTRIBUTING.md for review and attribution.
- Repository work does not authorize deployment, visibility changes, releases,
  package publication, or sending messages to others.
