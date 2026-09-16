# Third-party provenance

Agent identity and control-grant policy are implemented in this repository under
the root MIT license, copyright Chris Reynolds.

The original engine was generalized from Chris Reynolds's own private wiki code.
Its original code and synthetic examples are released under the root MIT License.
No private articles, original session archives, deployment configuration, or
third-party source trees are included in this source release.

Codex and pi are names of external agent harnesses whose JSONL records this engine
can interpret. This project is independent and is not endorsed by their maintainers.
It does not bundle either harness, their logos, or a model service.

Runtime and development dependencies are separately licensed, downloaded by
`npm ci`, and pinned by package-lock.json. Their own license notices remain in the
installed packages. The lockfile records resolved versions, integrity values, and
license identifiers. The dependency inventory is in
[dependency review](docs/dependencies.md). If distributing a bundled application or
container, include the applicable dependency license texts and review that artifact
separately; the root MIT notice does not replace upstream notices.

## shadcn/ui and browser assets

`public/typeset.css` was copied from https://ui.shadcn.com/typeset.css on
September 12, 2026 (SHA-256
`f70fb9750ffc48355ffa84c6d338dff866441a84f838901fa5739e148eea1be5`).
`ui/components/dialog.jsx` adapts the Base Nova dialog from
https://ui.shadcn.com/r/styles/base-nova/dialog.json, replacing Tailwind classes
with local semantic CSS and retaining Base UI behavior. The upstream MIT license
is preserved in [shadcn-license.txt](docs/shadcn-license.txt).
`ui/components/agents.jsx` also adapts shadcn Base UI button, card, badge,
native-select and tabs patterns using the same semantic CSS approach.
`ui/components/mode-toggle.jsx` adapts the [Mode Toggle](https://ui.shadcn.com/docs/dark-mode/vite#add-a-mode-toggle)
and Base UI dropdown-menu patterns, retaining the existing pre-paint preference.

React, Base UI and Mermaid browser bundles are generated from locked dependencies
during setup. Their esbuild legal comments and an aggregate `licenses.txt` are
served alongside them under `/assets/vendor/`. That license inventory is generated
from installed package notices and includes development tools when installed.
Syntax highlighting uses lowlight/highlight.js; math uses KaTeX via rehype-katex.
Their separate upstream licenses apply.

Shared native controls in `ui/components/primitives.mjs` extend the existing
shadcn adaptations under the same MIT notice in `docs/shadcn-license.txt`.
