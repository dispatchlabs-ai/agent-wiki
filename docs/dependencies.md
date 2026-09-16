# Dependency review

Reviewed September 9, 2026 against the npm registry and upstream release metadata.

At source-alpha preparation, all eight direct dependencies were at their latest stable versions. The five older
transitive versions below are selected by upstream dependency ranges; no overrides
are applied across major versions. `npm audit` reports zero known vulnerabilities.
Existing locked versions are retained rather than downgraded solely for soak age;
this policy applies to proposed updates. In particular, @ungap/structured-clone
1.4.0 was already locked; it reaches its 14-day eligibility on September 10.
No advisory was reported for that version.

Routine updates soak for 14 days; major, runtime, CI, and parser updates for 30 days.

Node 24.19.0 (August 3; eligible September 2) is the tested runtime baseline.
Node 24.21.0 (September 7; eligible October 7) is deferred for the runtime soak.
[Node release index](https://nodejs.org/dist/index.json).

CI uses checkout 7.0.1 (July 20; eligible August 19) and setup-node 7.0.0
(July 14; eligible August 13), pinned to exact commits. Gitleaks 8.30.1
(March 21; eligible April 4) is used for the release scan.
[Checkout releases](https://github.com/actions/checkout/releases/tag/v7.0.1),
[setup-node releases](https://github.com/actions/setup-node/releases/tag/v7.0.0),
[Gitleaks release](https://github.com/gitleaks/gitleaks/releases/tag/v8.30.1).

| Package                                                                                                                           | Locked | Latest stable | Latest release | License      | Disposition                                 |
| --------------------------------------------------------------------------------------------------------------------------------- | ------ | ------------- | -------------- | ------------ | ------------------------------------------- |
| [@types/debug](https://registry.npmjs.org/@types/debug)                                                                           | 4.1.13 | 4.1.13        | 2026-03-19     | MIT          | Current                                     |
| [@types/hast](https://registry.npmjs.org/@types/hast)                                                                             | 3.0.5  | 3.0.5         | 2026-07-09     | MIT          | Current                                     |
| [@types/mdast](https://registry.npmjs.org/@types/mdast)                                                                           | 4.0.4  | 4.0.4         | 2024-05-14     | MIT          | Current                                     |
| [@types/ms](https://registry.npmjs.org/@types/ms)                                                                                 | 2.1.0  | 2.1.0         | 2025-01-16     | MIT          | Current                                     |
| [@types/unist](https://registry.npmjs.org/@types/unist)                                                                           | 3.0.3  | 3.0.3         | 2024-08-15     | MIT          | Current                                     |
| [@ungap/structured-clone](https://registry.npmjs.org/@ungap/structured-clone)                                                     | 1.4.0  | 1.4.0         | 2026-08-27     | ISC          | Current                                     |
| [argparse](https://registry.npmjs.org/argparse)                                                                                   | 1.0.10 | 3.0.1         | 2026-08-25     | MIT          | Retain upstream-compatible transitive range |
| [bail](https://registry.npmjs.org/bail)                                                                                           | 2.0.2  | 2.0.2         | 2021-11-07     | MIT          | Current                                     |
| [ccount](https://registry.npmjs.org/ccount)                                                                                       | 2.0.1  | 2.0.1         | 2021-10-28     | MIT          | Current                                     |
| [character-entities](https://registry.npmjs.org/character-entities)                                                               | 2.0.2  | 2.0.2         | 2022-06-22     | MIT          | Current                                     |
| [character-entities-html4](https://registry.npmjs.org/character-entities-html4)                                                   | 2.1.0  | 2.1.0         | 2021-10-29     | MIT          | Current                                     |
| [character-entities-legacy](https://registry.npmjs.org/character-entities-legacy)                                                 | 3.0.0  | 3.0.0         | 2021-10-29     | MIT          | Current                                     |
| [comma-separated-tokens](https://registry.npmjs.org/comma-separated-tokens)                                                       | 2.0.3  | 2.0.3         | 2022-11-14     | MIT          | Current                                     |
| [debug](https://registry.npmjs.org/debug)                                                                                         | 4.4.3  | 4.4.3         | 2025-09-13     | MIT          | Current                                     |
| [decode-named-character-reference](https://registry.npmjs.org/decode-named-character-reference)                                   | 1.3.0  | 1.3.0         | 2026-01-19     | MIT          | Current                                     |
| [dequal](https://registry.npmjs.org/dequal)                                                                                       | 2.0.3  | 2.0.3         | 2022-07-11     | MIT          | Current                                     |
| [devlop](https://registry.npmjs.org/devlop)                                                                                       | 1.1.0  | 1.1.0         | 2023-06-29     | MIT          | Current                                     |
| [escape-string-regexp](https://registry.npmjs.org/escape-string-regexp)                                                           | 5.0.0  | 5.0.0         | 2021-04-17     | MIT          | Current                                     |
| [esprima](https://registry.npmjs.org/esprima)                                                                                     | 4.0.1  | 4.0.1         | 2018-07-13     | BSD-2-Clause | Current                                     |
| [extend](https://registry.npmjs.org/extend)                                                                                       | 3.0.2  | 3.0.2         | 2018-07-19     | MIT          | Current                                     |
| [extend-shallow](https://registry.npmjs.org/extend-shallow)                                                                       | 2.0.1  | 3.0.2         | 2017-12-20     | MIT          | Retain upstream-compatible transitive range |
| [gray-matter](https://registry.npmjs.org/gray-matter)                                                                             | 4.0.3  | 4.0.3         | 2021-04-24     | MIT          | Current                                     |
| [hast-util-sanitize](https://registry.npmjs.org/hast-util-sanitize)                                                               | 5.0.2  | 5.0.2         | 2024-10-25     | MIT          | Current                                     |
| [hast-util-to-html](https://registry.npmjs.org/hast-util-to-html)                                                                 | 9.0.5  | 9.0.5         | 2025-02-19     | MIT          | Current                                     |
| [hast-util-whitespace](https://registry.npmjs.org/hast-util-whitespace)                                                           | 3.0.0  | 3.0.0         | 2023-07-31     | MIT          | Current                                     |
| [html-void-elements](https://registry.npmjs.org/html-void-elements)                                                               | 3.0.0  | 3.0.0         | 2023-05-19     | MIT          | Current                                     |
| [is-extendable](https://registry.npmjs.org/is-extendable)                                                                         | 0.1.1  | 1.0.1         | 2017-09-11     | MIT          | Retain upstream-compatible transitive range |
| [is-plain-obj](https://registry.npmjs.org/is-plain-obj)                                                                           | 4.1.0  | 4.1.0         | 2022-06-15     | MIT          | Current                                     |
| [js-yaml](https://registry.npmjs.org/js-yaml)                                                                                     | 3.15.2 | 5.4.1         | 2026-08-26     | MIT          | Retain upstream-compatible transitive range |
| [kind-of](https://registry.npmjs.org/kind-of)                                                                                     | 6.0.3  | 6.0.3         | 2020-01-16     | MIT          | Current                                     |
| [longest-streak](https://registry.npmjs.org/longest-streak)                                                                       | 3.1.0  | 3.1.0         | 2022-11-15     | MIT          | Current                                     |
| [markdown-table](https://registry.npmjs.org/markdown-table)                                                                       | 3.0.4  | 3.0.4         | 2024-10-22     | MIT          | Current                                     |
| [mdast-util-find-and-replace](https://registry.npmjs.org/mdast-util-find-and-replace)                                             | 3.0.2  | 3.0.2         | 2025-01-03     | MIT          | Current                                     |
| [mdast-util-from-markdown](https://registry.npmjs.org/mdast-util-from-markdown)                                                   | 2.0.3  | 2.0.3         | 2026-02-21     | MIT          | Current                                     |
| [mdast-util-gfm](https://registry.npmjs.org/mdast-util-gfm)                                                                       | 3.1.0  | 3.1.0         | 2025-02-10     | MIT          | Current                                     |
| [mdast-util-gfm-autolink-literal](https://registry.npmjs.org/mdast-util-gfm-autolink-literal)                                     | 2.0.1  | 2.0.1         | 2024-08-19     | MIT          | Current                                     |
| [mdast-util-gfm-footnote](https://registry.npmjs.org/mdast-util-gfm-footnote)                                                     | 2.1.0  | 2.1.0         | 2025-02-10     | MIT          | Current                                     |
| [mdast-util-gfm-strikethrough](https://registry.npmjs.org/mdast-util-gfm-strikethrough)                                           | 2.0.0  | 2.0.0         | 2023-07-10     | MIT          | Current                                     |
| [mdast-util-gfm-table](https://registry.npmjs.org/mdast-util-gfm-table)                                                           | 2.0.0  | 2.0.0         | 2023-07-10     | MIT          | Current                                     |
| [mdast-util-gfm-task-list-item](https://registry.npmjs.org/mdast-util-gfm-task-list-item)                                         | 2.0.0  | 2.0.0         | 2023-07-10     | MIT          | Current                                     |
| [mdast-util-phrasing](https://registry.npmjs.org/mdast-util-phrasing)                                                             | 4.1.0  | 4.1.0         | 2024-02-01     | MIT          | Current                                     |
| [mdast-util-to-hast](https://registry.npmjs.org/mdast-util-to-hast)                                                               | 13.2.1 | 13.2.1        | 2025-11-23     | MIT          | Current                                     |
| [mdast-util-to-markdown](https://registry.npmjs.org/mdast-util-to-markdown)                                                       | 2.1.2  | 2.1.2         | 2024-11-04     | MIT          | Current                                     |
| [mdast-util-to-string](https://registry.npmjs.org/mdast-util-to-string)                                                           | 4.0.0  | 4.0.0         | 2023-07-07     | MIT          | Current                                     |
| [micromark](https://registry.npmjs.org/micromark)                                                                                 | 4.0.2  | 4.0.2         | 2025-02-27     | MIT          | Current                                     |
| [micromark-core-commonmark](https://registry.npmjs.org/micromark-core-commonmark)                                                 | 2.0.3  | 2.0.3         | 2025-02-27     | MIT          | Current                                     |
| [micromark-extension-gfm](https://registry.npmjs.org/micromark-extension-gfm)                                                     | 3.0.0  | 3.0.0         | 2023-06-26     | MIT          | Current                                     |
| [micromark-extension-gfm-autolink-literal](https://registry.npmjs.org/micromark-extension-gfm-autolink-literal)                   | 2.1.0  | 2.1.0         | 2024-07-05     | MIT          | Current                                     |
| [micromark-extension-gfm-footnote](https://registry.npmjs.org/micromark-extension-gfm-footnote)                                   | 2.1.0  | 2.1.0         | 2024-07-05     | MIT          | Current                                     |
| [micromark-extension-gfm-strikethrough](https://registry.npmjs.org/micromark-extension-gfm-strikethrough)                         | 2.1.0  | 2.1.0         | 2024-07-05     | MIT          | Current                                     |
| [micromark-extension-gfm-table](https://registry.npmjs.org/micromark-extension-gfm-table)                                         | 2.1.1  | 2.1.1         | 2025-01-20     | MIT          | Current                                     |
| [micromark-extension-gfm-tagfilter](https://registry.npmjs.org/micromark-extension-gfm-tagfilter)                                 | 2.0.0  | 2.0.0         | 2023-06-23     | MIT          | Current                                     |
| [micromark-extension-gfm-task-list-item](https://registry.npmjs.org/micromark-extension-gfm-task-list-item)                       | 2.1.0  | 2.1.0         | 2024-07-05     | MIT          | Current                                     |
| [micromark-factory-destination](https://registry.npmjs.org/micromark-factory-destination)                                         | 2.0.1  | 2.0.1         | 2024-11-12     | MIT          | Current                                     |
| [micromark-factory-label](https://registry.npmjs.org/micromark-factory-label)                                                     | 2.0.1  | 2.0.1         | 2024-11-12     | MIT          | Current                                     |
| [micromark-factory-space](https://registry.npmjs.org/micromark-factory-space)                                                     | 2.0.1  | 2.0.1         | 2024-11-12     | MIT          | Current                                     |
| [micromark-factory-title](https://registry.npmjs.org/micromark-factory-title)                                                     | 2.0.1  | 2.0.1         | 2024-11-12     | MIT          | Current                                     |
| [micromark-factory-whitespace](https://registry.npmjs.org/micromark-factory-whitespace)                                           | 2.0.1  | 2.0.1         | 2024-11-12     | MIT          | Current                                     |
| [micromark-util-character](https://registry.npmjs.org/micromark-util-character)                                                   | 2.1.1  | 2.1.1         | 2024-11-12     | MIT          | Current                                     |
| [micromark-util-chunked](https://registry.npmjs.org/micromark-util-chunked)                                                       | 2.0.1  | 2.0.1         | 2024-11-12     | MIT          | Current                                     |
| [micromark-util-classify-character](https://registry.npmjs.org/micromark-util-classify-character)                                 | 2.0.1  | 2.0.1         | 2024-11-12     | MIT          | Current                                     |
| [micromark-util-combine-extensions](https://registry.npmjs.org/micromark-util-combine-extensions)                                 | 2.0.1  | 2.0.1         | 2024-11-12     | MIT          | Current                                     |
| [micromark-util-decode-numeric-character-reference](https://registry.npmjs.org/micromark-util-decode-numeric-character-reference) | 2.0.2  | 2.0.2         | 2024-11-12     | MIT          | Current                                     |
| [micromark-util-decode-string](https://registry.npmjs.org/micromark-util-decode-string)                                           | 2.0.1  | 2.0.1         | 2024-11-12     | MIT          | Current                                     |
| [micromark-util-encode](https://registry.npmjs.org/micromark-util-encode)                                                         | 2.0.1  | 2.0.1         | 2024-11-12     | MIT          | Current                                     |
| [micromark-util-html-tag-name](https://registry.npmjs.org/micromark-util-html-tag-name)                                           | 2.0.1  | 2.0.1         | 2024-11-12     | MIT          | Current                                     |
| [micromark-util-normalize-identifier](https://registry.npmjs.org/micromark-util-normalize-identifier)                             | 2.0.1  | 2.0.1         | 2024-11-12     | MIT          | Current                                     |
| [micromark-util-resolve-all](https://registry.npmjs.org/micromark-util-resolve-all)                                               | 2.0.1  | 2.0.1         | 2024-11-12     | MIT          | Current                                     |
| [micromark-util-sanitize-uri](https://registry.npmjs.org/micromark-util-sanitize-uri)                                             | 2.0.1  | 2.0.1         | 2024-11-12     | MIT          | Current                                     |
| [micromark-util-subtokenize](https://registry.npmjs.org/micromark-util-subtokenize)                                               | 2.1.0  | 2.1.0         | 2025-02-27     | MIT          | Current                                     |
| [micromark-util-symbol](https://registry.npmjs.org/micromark-util-symbol)                                                         | 2.0.1  | 2.0.1         | 2024-11-12     | MIT          | Current                                     |
| [micromark-util-types](https://registry.npmjs.org/micromark-util-types)                                                           | 2.0.2  | 2.0.2         | 2025-02-27     | MIT          | Current                                     |
| [ms](https://registry.npmjs.org/ms)                                                                                               | 2.1.3  | 2.1.3         | 2020-12-08     | MIT          | Current                                     |
| [prettier](https://registry.npmjs.org/prettier)                                                                                   | 3.9.6  | 3.9.6         | 2026-07-21     | MIT          | Current                                     |
| [property-information](https://registry.npmjs.org/property-information)                                                           | 7.2.0  | 7.2.0         | 2026-06-01     | MIT          | Current                                     |
| [rehype-sanitize](https://registry.npmjs.org/rehype-sanitize)                                                                     | 6.0.0  | 6.0.0         | 2023-08-26     | MIT          | Current                                     |
| [rehype-stringify](https://registry.npmjs.org/rehype-stringify)                                                                   | 10.0.1 | 10.0.1        | 2024-09-27     | MIT          | Current                                     |
| [remark-gfm](https://registry.npmjs.org/remark-gfm)                                                                               | 4.0.1  | 4.0.1         | 2025-02-10     | MIT          | Current                                     |
| [remark-parse](https://registry.npmjs.org/remark-parse)                                                                           | 11.0.0 | 11.0.0        | 2023-09-18     | MIT          | Current                                     |
| [remark-rehype](https://registry.npmjs.org/remark-rehype)                                                                         | 11.1.2 | 11.1.2        | 2025-04-02     | MIT          | Current                                     |
| [remark-stringify](https://registry.npmjs.org/remark-stringify)                                                                   | 11.0.0 | 11.0.0        | 2023-09-18     | MIT          | Current                                     |
| [section-matter](https://registry.npmjs.org/section-matter)                                                                       | 1.0.0  | 1.0.0         | 2017-10-23     | MIT          | Current                                     |
| [space-separated-tokens](https://registry.npmjs.org/space-separated-tokens)                                                       | 2.0.2  | 2.0.2         | 2022-11-14     | MIT          | Current                                     |
| [sprintf-js](https://registry.npmjs.org/sprintf-js)                                                                               | 1.0.3  | 1.1.3         | 2023-09-11     | BSD-3-Clause | Retain upstream-compatible transitive range |
| [stringify-entities](https://registry.npmjs.org/stringify-entities)                                                               | 4.0.4  | 4.0.4         | 2024-04-03     | MIT          | Current                                     |
| [strip-bom-string](https://registry.npmjs.org/strip-bom-string)                                                                   | 1.0.0  | 1.0.0         | 2017-03-30     | MIT          | Current                                     |
| [trim-lines](https://registry.npmjs.org/trim-lines)                                                                               | 3.0.1  | 3.0.1         | 2022-07-03     | MIT          | Current                                     |
| [trough](https://registry.npmjs.org/trough)                                                                                       | 2.2.0  | 2.2.0         | 2024-02-05     | MIT          | Current                                     |
| [unified](https://registry.npmjs.org/unified)                                                                                     | 11.0.5 | 11.0.5        | 2024-06-19     | MIT          | Current                                     |
| [unist-util-is](https://registry.npmjs.org/unist-util-is)                                                                         | 6.0.1  | 6.0.1         | 2025-10-16     | MIT          | Current                                     |
| [unist-util-position](https://registry.npmjs.org/unist-util-position)                                                             | 5.0.0  | 5.0.0         | 2023-07-07     | MIT          | Current                                     |
| [unist-util-stringify-position](https://registry.npmjs.org/unist-util-stringify-position)                                         | 4.0.0  | 4.0.0         | 2023-07-07     | MIT          | Current                                     |
| [unist-util-visit](https://registry.npmjs.org/unist-util-visit)                                                                   | 5.1.0  | 5.1.0         | 2026-01-22     | MIT          | Current                                     |
| [unist-util-visit-parents](https://registry.npmjs.org/unist-util-visit-parents)                                                   | 6.0.2  | 6.0.2         | 2025-10-16     | MIT          | Current                                     |
| [vfile](https://registry.npmjs.org/vfile)                                                                                         | 6.0.3  | 6.0.3         | 2024-08-27     | MIT          | Current                                     |
| [vfile-message](https://registry.npmjs.org/vfile-message)                                                                         | 4.0.3  | 4.0.3         | 2025-07-26     | MIT          | Current                                     |
| [zwitch](https://registry.npmjs.org/zwitch)                                                                                       | 2.0.4  | 2.0.4         | 2022-11-16     | MIT          | Current                                     |

## Browser test addition — September 9, 2026

Development-only `@playwright/test`, `playwright`, and `playwright-core` are pinned
at 1.62.1 (Apache-2.0), released July 30. This satisfies the 30-day CI soak; 1.63.0
(September 4) is deferred. Registry metadata was checked with `npm view` and the
updated lockfile audit reported zero vulnerabilities. Chromium is downloaded by
`npx playwright install chromium`, outside the source distribution; its bundled
notices apply. Runtime dependencies remain unchanged.

The additional CI runtime is Node 26.6.0 (August 4), which also satisfies the
30-day runtime soak. Local verification additionally used the pre-existing
Node 26.8.1 installation.
Playwright also locks optional macOS-only `fsevents` 2.3.2 (MIT); it is not
installed in the supported Linux test environment.

## Boundary checking — September 10, 2026

Added development-only TypeScript 5.9.3 (published September 30, 2025) and
`@types/node` 24.3.0 (August 15, 2025). Both exceed the 30-day CI/tooling soak.
Versions are pinned exactly; runtime dependencies are unchanged. npm audit found
zero advisories at installation. Dates were checked against the npm registry:
[TypeScript metadata](https://registry.npmjs.org/typescript),
[Node type metadata](https://registry.npmjs.org/@types%2fnode).

## Rich reader and controls — September 12, 2026

New direct dependencies are pinned to versions published at least 30 days before
this review. Registry publication dates were checked during implementation.

| Package           | Version | Published  | Purpose                                    |
| ----------------- | ------- | ---------- | ------------------------------------------ |
| @base-ui/react    | 1.7.0   | 2026-08-04 | Accessible dialog and tabs                 |
| react / react-dom | 19.2.8  | 2026-07-21 | Browser control islands                    |
| esbuild           | 0.28.2  | 2026-08-08 | Local browser bundling during engine setup |
| mermaid           | 11.16.1 | 2026-08-04 | Isolated, requested diagrams               |
| lowlight          | 3.3.0   | 2024-12-14 | Class-based syntax highlighting            |
| remark-directive  | 4.0.0   | 2025-02-27 | Named Markdown structures                  |
| remark-math       | 6.0.0   | 2023-09-19 | Math parsing                               |
| rehype-katex      | 7.0.1   | 2024-08-19 | Trusted, bounded MathML rendering          |

All direct additions above are MIT licensed. Highlight.js is BSD-3-Clause; the
lockfile and installed packages retain transitive license metadata. Browser
bundling emits legal comments and a complete installed-package notice collection.
Shadcn source attribution is recorded in `THIRD_PARTY_NOTICES.md`.

Base UI 1.8.0, React 19.3.0 and Mermaid 12.0.0 were not adopted: they are newer than
the applicable soak window. Mermaid 12 also introduced a dependency chain flagged
by npm audit at this review. The selected Mermaid 11 dependency graph resolves
patched lodash-es without an override; `npm audit --omit=dev --audit-level=high`
reports zero vulnerabilities. Registry sources: [Base UI](https://registry.npmjs.org/@base-ui%2freact),
[React](https://registry.npmjs.org/react), [esbuild](https://registry.npmjs.org/esbuild),
[Mermaid](https://registry.npmjs.org/mermaid), [lowlight](https://registry.npmjs.org/lowlight),
[remark-directive](https://registry.npmjs.org/remark-directive),
[remark-math](https://registry.npmjs.org/remark-math),
[rehype-katex](https://registry.npmjs.org/rehype-katex).
