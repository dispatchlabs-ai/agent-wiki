# Contributing

Chris Reynolds maintains this project, affiliated with Dispatch Labs AI. Discuss
large changes with the maintainer before implementing them. Small fixes should
explain the problem, resulting behavior, and relevant verification.

Use Linux or macOS, Node 24.22.1+ or 26.12.1+ (within those major versions), and Git. Run `npm ci` and
`npm run check`. This checks generated contracts, formatting, and static types;
`npm ci` builds browser assets. Use synthetic content and temporary repositories
for manual verification. Never submit private wiki content, real agent traces,
credentials, or customer data.

Maintainer changes may push directly to `main` after passing checks. Outside
contributions use pull requests with maintainer review and passing checks. Preserve upstream attribution. Contributions are licensed
under MIT; contributors retain their copyright. No CLA, copyright assignment, or
DCO sign-off is required.

AI-assisted contributions are welcome. Disclose material AI assistance and take
responsibility for understanding and verifying the submitted code. Avoid automated
issue or pull-request spam. Treat people respectfully and keep discussions focused
on the work. Report vulnerabilities privately as described in [SECURITY.md](SECURITY.md).

Start with the [roadmap and approachable issues](docs/roadmap.md) to choose a
bounded task. The [contributor map](docs/contributor-guide.md) explains the code,
format examples, and correctness contracts.

The automated test suites and acceptance runners were removed on October 16, 2026. For browser changes, run the synthetic example and inspect the affected
flows in a browser. Report the exact manual checks and their limits; static
checks do not establish runtime correctness. See [verification](docs/verification.md).

User-visible changes need a changelog entry and a versioned release before being
reported as released. Follow [versioning and releases](docs/releases.md).
