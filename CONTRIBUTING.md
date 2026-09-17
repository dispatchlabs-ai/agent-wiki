# Contributing

Chris Reynolds maintains this project, affiliated with Dispatch Labs AI. Discuss
large changes with the maintainer before implementing them. Small fixes should
explain the problem, resulting behavior, and relevant verification.

Use Linux or macOS, Node 24.19 or later, and Git. Run `npm ci` and
`npm run check`. Tests use temporary repositories and synthetic records. Never
submit private wiki content, real agent traces, credentials, or customer data.

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
format fixtures, and correctness contracts.

For browser work on Ubuntu or Debian, including Ubuntu under WSL2, install
Chromium and its system libraries:

```sh
npx playwright install --with-deps chromium
```

The dependency installation uses `sudo` for system packages. On macOS, or Linux
with Chromium's system libraries already installed, use
`npx playwright install chromium`.
See [Playwright's system dependency instructions](https://playwright.dev/docs/browsers#install-system-dependencies)
for the supported distributions.

Then run `npm run test:browser`. **Under WSL2, use this command instead** to keep
the inherited WSLg display variables out of the headless browser process:

```sh
env -u DISPLAY -u WAYLAND_DISPLAY npm run test:browser
```

This clears the variables only for that command. Keep them for interactive
`--headed` or `--debug` sessions. See the
[WSL2 verification record](docs/onboarding-verification.md#windows-and-wsl2--september-17-2026)
for the observed failure and tested environment.

User-visible changes need a changelog entry and a versioned release before being
reported as released. Follow [versioning and releases](docs/releases.md).
