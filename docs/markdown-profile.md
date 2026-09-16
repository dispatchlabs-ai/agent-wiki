# Markdown profile

Articles, conversations, historical revisions and draft previews use the same
on-demand Markdown renderer. Markdown in Git and original JSONL remain the source;
rendered HTML and search indexes are disposable. Publishing a content commit never
requires a browser bundle build or application deployment.

## Supported syntax

CommonMark with remark-gfm provides tables, task lists, strikethrough, automatic
links and footnotes. Existing wiki links (`[[article-id|Label]]`) and the `[w]`
in-progress task marker remain supported. Raw HTML is shown as text, and MDX,
JavaScript expressions and author-supplied component attributes are not executed.
This is an explicit profile, not a claim of full GitHub website compatibility.

GitHub-style alerts accept NOTE, TIP, IMPORTANT, WARNING and CAUTION:

```markdown
> [!NOTE]
> Keep the explanation linked to its evidence.
```

Fenced code names its language, for example `javascript`, `python`, `bash` or
`json`. Recognized languages receive syntax highlighting and a Copy code button;
unknown languages remain readable code. Highlighting is bounded to 100,000
characters per block. Copying retains the original code text.

Inline math uses `$E = mc^2$`. Display math uses a pair of `$$` lines around a
formula. KaTeX emits native MathML, retaining TeX in its annotation for accessibility
and inspection. Math uses no external fonts, scripts or network service. Trust is
disabled and expansion/size limits apply. Unsupported commands remain inspectable.
Escape literal dollar signs (`\$`) when adjacent currency amounts could resemble
math delimiters.

A `mermaid` fence offers **Show diagram**, with the exact code always available in
**Diagram source**. Diagrams render in a sandboxed iframe without same-origin
privileges, popups, parent navigation, or network access. Configuration directives
and frontmatter are rejected. Rendering is limited to 20,000 characters and 200
edges. Invalid or oversized diagrams retain their source instead of breaking the
article. Diagrams keep readable natural dimensions and scroll horizontally when
needed. Mermaid is loaded only when a reader requests a diagram.

## Rich blocks

Named directives provide inert structures. Only `title` is used, as plain text;
other author attributes are ignored. Unsupported directives remain visible as
source. Use a longer outer fence when nesting directives.

```markdown
:::details{title="Supporting explanation"}
Additional Markdown, available in a native disclosure.
:::

::::tabs
:::tab{title="Read"}
Read the explanation and follow the original citation.
:::
:::tab{title="Edit"}
Write, preview, and save a new revision.
:::
::::

::::figure
![A captured image](/media/<sha256>.png)

:::caption
A caption that stays with its figure.
:::
::::
```

The placeholder `<sha256>` above must be replaced with a real captured asset hash.
The existing captured-media policy applies: only approved local hashed images
embed; unavailable images are labeled, and original download links are retained.
Figures also accept ordinary Markdown text, links and tables.

The `note`, `tip`, `important`, `warning` and `caution` directives accept Markdown
content and an optional plain-text title, using the same presentation as alerts.

Content tabs use Base UI keyboard navigation: Left/Right arrows, Home and End.
Up to 100 tab groups with 20 panels each are enhanced per page. Larger or nested
groups retain their fully readable server presentation. All panels are present in server HTML and remain visible without JavaScript and
when printing. Disclosure, tab and caption content remains in article search.
Footnotes in conversation messages are namespaced to prevent duplicate IDs;
original event and source-line citation anchors are unchanged. Existing article
footnote and heading anchors are preserved.

## Design and maintenance

`public/typeset.css` is shadcn Typeset, with local semantic tokens and responsive
styles in `public/ui.css`. `ui/components/dialog.jsx` adapts shadcn's Base UI dialog
with semantic CSS instead of Tailwind utilities. The remaining server-rendered
navigation and form controls share those styles and retain native behavior.
`ui/main.jsx` adds search-dialog and content-tab interactions without owning
article or trace data. The dialog also opens with Ctrl/Command+K.

`npm ci` runs `npm run build:ui` once for engine assets. When using
`npm ci --ignore-scripts`, run `npm run build:ui` explicitly. Rebuild after changing
`ui/` source; no content repository is read by this command. Bundles and their
license notices are generated under ignored `public/vendor/` and served locally.
No CDN, frontend service or content compilation is involved.

The synthetic [rendering fixture](../tests/fixtures/rich-markdown.md) demonstrates
the full profile. Run `npm run check` and `npm run test:browser` for sanitization,
source retention, live content updates, keyboard interactions and responsive
coverage. Screenshot outputs are under `.runtime/rich-review/` and
`.runtime/responsive-review/`.
