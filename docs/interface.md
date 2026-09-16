# Responsive interface

The same server-rendered pages serve desktop and mobile. The interface covers
home activity, the article catalog, articles, history, comparisons, sources, editing, article
and trace search, the trace catalog, and trace reading.

## Layout and appearance

`public/theme.css` owns semantic color tokens. Light mode uses restrained blue
links (`#1a65a6`); dark mode uses `#8ab4f8`. `public/style.css` owns layout and
typography. The desktop shell is capped at 1536px, with a bounded reading column and sidebar.
Article and conversation prose use shadcn Typeset with system sans serif. Mobile uses compact
metadata spacing and a separate Edit link outside the reading tabs. At 760px and below, sidebars move into the reading flow, filters
collapse into disclosures, comparisons stack, and revision selectors fill their
rows. Simple Markdown tables with up to four columns become labeled records;
larger tables have a keyboard-focusable horizontal scrolling region.

The header Mode Toggle uses a sun/moon icon and a shadcn/Base UI menu offering
Light, Dark, and System, with a check beside the selected preference. System is
the default. System follows the
browser preference. Explicit preferences persist in local storage and are read
before paint by `public/theme.js`. With JavaScript disabled, system appearance
and ordinary article navigation still work.

## Reading and evidence

The home feed shows the twelve most recently updated current articles, optionally
filtered to today or this week. It is not a complete revision activity log. Topics
can be filtered and sorted; search groups article and trace matches. The trace
catalog groups snapshots by harness and session ID, with links to every capture.
It supports harness filtering and dialogue search when its index exists.

Article tabs expose Git history and sources from the selected revision. Sources
are deduplicated links from Markdown and source metadata; their presence does not
establish independent verification. Trace citations retain their page and record
anchors. The trace reader preserves every original record and supports Dialogue
and Source records display modes.

Comparisons align source lines using a bounded algorithm and show rendered
Markdown fragments, changed title/description/topic metadata, and recorded change
summaries. Splitting Markdown structures can change fragment presentation; exact
Markdown for each group remains available in a disclosure. Other custom
frontmatter is preserved in Git but is not included in this comparison view.

## Editing

The editor offers Write, Preview, and desktop Split modes. Preview uses the same
sanitized Markdown renderer as articles, without changing Git. Switching modes
preserves the draft, and the browser warns before leaving an unsaved edit. Drafts
are not persisted across closing or reloading. Saving retains existing revision
checks, atomic commits, and retry receipts. A stale revision requires reconciliation.

## Verification

Run `npm run check` and `npm run test:browser`. Browser fixtures use temporary
synthetic content and trace repositories. Coverage includes eleven routes at
320px, 390px, 768px, 1024px, 1440px, 1920px, and 2560px in both themes, document overflow, appearance persistence,
mobile filters, trace anchors, preview sanitization, draft retention, and saving.
Responsive and rich Markdown checks run each screen-size and theme combination
as a separate test, with a fresh browser context and the default test timeout.
Review screenshots are written under ignored `.runtime/responsive-review/`.

The synthetic example articles cite the bundled immutable traces at their original
answer lines. To refresh an existing demo, review and commit the example Markdown
into its content repository explicitly; startup never replaces existing articles
or rewrites their history. Maintenance commits remain visible in historical views.

See [existing archive integration](external-evidence.md) for the optional provider,
its API differences, native conversation URLs, files, and concurrent search.

The [Markdown profile](markdown-profile.md) documents rich blocks and browser
asset setup. Shadcn/Base UI supplies the search dialog and content tabs; ordinary
server-rendered navigation and forms retain native behavior. Search opens with
Ctrl/Command+K. Rich-feature tests cover keyboard focus, no-JavaScript reading,
isolated Mermaid rendering, preview parity and live content commits.

Article sidebars move below the reading column through 1000px, avoiding a cramped
tablet column. General filter/editor breakpoints remain at 760px.

## Identity assets

The header pairs a compact, open-book mark with live system-font lettering.
The decorative mark uses the link color token; the wordmark uses the text token,
so both follow System, Light, Dark, and forced-color appearance. The logo remains
a single home link with readable text when images or styles are unavailable.

`public/brand-mark.svg` is the transparent vector symbol. Transparent lockups
are `brand-light.svg`, `brand-dark.svg`, and `brand-mono.svg`; their lettering
remains editable system-font text rather than outlined proprietary type.
`favicon.svg` uses the same silhouette on a pale tile for either browser theme.
Regenerate these assets with `node scripts/build-brand.mjs`. The geometry was
manually constructed following an AI-generated concept and independent design
review; the shipped SVGs contain no embedded raster images or external resources.

## Shared shell components

`ui/components/site.mjs` defines Brand, SiteNavigation, SiteHeader, SiteFooter,
UpdatePeriod and ArticleCard. Node renders these React components to static HTML
on each page render; there is no content compilation or full-page hydration.
`ui/components/search.mjs` shares SearchForm and SearchIcon between the shell,
results page and `quick-search.jsx` dialog. Base UI still owns dialog behavior.

Navigation says Articles and Conversations; topic remains an article filter.
Existing `/wiki/`, `/traces/`, API routes and search filter values are unchanged.
The home page has one Recent updates heading, 22px mobile feed titles and a
Search trigger with an icon. Cards show an excerpt of the article description
(up to 180 characters at a word boundary), rather than the internal edit summary.
The title opens the article; View changes opens the revision comparison. Full
descriptions and original change summaries remain on article and history pages.

Authenticated pages integrate an AccountMenu beside search in the shared header.
The Base UI menu contains the identity, account link, manager-only access link and
sign-out action; keyboard focus, Escape and outside-click dismissal use the same
component on every page. Mobile search and account buttons retain 44px targets;
primary navigation stays visible on its own row. Account controls no longer
create a separate strip above the brand.

The Mode Toggle sits in the top-right header beside the account menu, and remains
available while signed out. On narrow phones, signed-in header controls occupy
a separate row above navigation to preserve 44px targets. Short pages use the
viewport's available space; the footer stays in document flow and respects the
bottom safe area.

## Agents and connections

The Agents workspace uses shadcn-style cards, badges, buttons, native selects,
Base UI tabs, and the shared shadcn/Base UI dialog. Semantic color tokens preserve
light and dark appearance. Agent cards keep everyday status visible; dialogs
contain definition editing and permission management. Connections have their own
tab, with explicit disconnect actions. Mobile cards stack, controls retain 44px
minimum targets, and dialogs scroll within the viewport. Server-side checks remain
authoritative for every operation; the UI only exposes the caller's available controls.

Conversation catalog entries label the source start timestamp as Started and show
date, time, and timezone. The browser uses the reader's local timezone; server
HTML falls back to UTC. Missing starts are explicitly unavailable. These dates
represent the recorded conversation or work-period start, not archive ingestion.

Conversation entries also show Last activity from the latest recorded event.
The evidence catalog orders by last activity before pagination, with start as a
fallback when the end is unavailable; the UI labels missing activity explicitly.
Dialogue search retains relevance ranking. Resuming an existing period preserves
its start timestamp while its latest recorded activity moves it up in browsing.

## Shared component contract

`ui/components/primitives.mjs` owns server-safe Button, Badge, Field, PageHeading,
EmptyState, Pagination and SourceTime components. Native controls and links work
without client mounting; Base UI wrappers own interactive dialogs, menus and tabs.
`public/components.css` owns their scoped styles. Do not add global element rules
there: prose remains under Typeset and page layout stays separate.

`ui/components/conversations.mjs` is the first complete catalog using this layer.
Node renders it for every request using current evidence data. Search and filters
use native GET forms; pagination keeps the query and filters. Agents reuses the
same buttons, fields and badges and is dynamically imported only on its page.
Do not hydrate static markup or put source content into the asset build.

Next migrations: reader metadata and editing controls. Migrate one complete workflow at a time and preserve
keyboard, no-JavaScript, print, citation and live-content behavior.

Articles and search now compose the shared primitives through
`ui/components/library.mjs`. Search result fragments retain their shared server/
browser renderer in `public/search-results.js`, using the same scoped list styles
for initial HTML and asynchronous updates. Filter groups distinguish article
metadata from conversation sources; type navigation remains ordinary links.

Sign-in, local account setup, account settings and agent consent compose shared
primitives in `ui/components/auth.mjs`. The server renders these pages per request;
existing auth clients retain CSRF, return destinations and explicit consent decisions.
Consent keeps client identity, access and revocation information visible, with the
return address in a native disclosure. Status live regions remain in the accessibility
tree before messages arrive. Provider navigation works without JavaScript; local
password operations continue to require the existing auth client.
