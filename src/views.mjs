import { ArticlesCatalog, SearchPage } from "../ui/components/library.mjs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ArticleCard, UpdatePeriod } from "../ui/components/site.mjs";
import { articleResults, traceResults } from "../public/search-results.js";
import { catalogOptions, sortedSnapshots, sessions } from "./trace-catalog.mjs";
import {
  shell,
  escape as e,
  link,
  list,
  date,
  queryLink,
  articleHeader,
  sources,
  renderMarkdown,
} from "./render.mjs";
import { WikiError } from "./errors.mjs";
const option = (value, label, selected) =>
  `<option value="${e(value)}"${value === selected ? " selected" : ""}>${e(label)}</option>`;
const empty = (text) => `<p class="empty">${e(text)}</p>`;
const topicNames = (wiki) =>
  [...new Set(wiki.catalog().map((p) => p.topic))].sort();
const topicSelect = (wiki, selected) =>
  `<label>Topic<select name="topic" aria-label="Topic">${option("", "All topics", selected)}${topicNames(
    wiki,
  )
    .map((t) => option(t, t, selected))
    .join("")}</select></label>`;
export function home(wiki, params) {
  const range = ["today", "week"].includes(params.get("range"))
    ? params.get("range")
    : "all";
  const now = new Date();
  const start =
    range === "today"
      ? Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
      : range === "week"
        ? now.valueOf() - 7 * 86400000
        : 0;
  const pages = wiki
    .catalog()
    .sort((a, b) => b.updated_at.localeCompare(a.updated_at));
  const recent = pages
    .filter((p) => new Date(p.updated_at).valueOf() >= start)
    .slice(0, 12);
  const questions = [...wiki.pages.values()]
    .flatMap((p) => p.questions.map((q) => ({ q, p })))
    .slice(0, 6);
  return shell(
    "Home",
    `<div class="layout home-layout"><div class="home-feed"><h1>Recent updates</h1><p class="lede">The latest from your wiki.</p>${renderToStaticMarkup(createElement(UpdatePeriod, { range }))}${
      recent.length
        ? recent
            .map((p) => {
              return renderToStaticMarkup(
                createElement(ArticleCard, {
                  title: p.title,
                  href: p.url,
                  description: p.description,
                  metadata: `${date(p.updated_at)} · ${p.number === 1 ? "Created" : "Updated"}`,
                  changesHref:
                    p.number > 1
                      ? queryLink(`/wiki/${p.id}/compare/`, {
                          from: p.number - 1,
                          to: p.number,
                        })
                      : undefined,
                }),
              );
            })
            .join("")
        : empty("No updates in this period.")
    }<p class="pagination">${link("/wiki/", "Browse all articles →")}</p></div><aside class="sidebar"><section><h2>Open questions</h2>${questions.length ? questions.map(({ q, p }) => `<p>${e(q)}<br>${link(`/wiki/${p.id}/`, p.title)}</p>`).join("") : empty("No open questions recorded.")}</section><section><h2>Explore topics</h2>${list(topicNames(wiki).map((t) => link(queryLink("/wiki/", { topic: t }), t)))}</section><section><h2>Follow the evidence</h2><p>Read the original conversations behind your articles.</p>${link("/traces/", "Browse conversations →")}</section></aside></div>`,
    { active: "Home", className: "home-page" },
  );
}
export function topics(wiki, params) {
  const topic = params.get("topic") || "",
    sort = params.get("sort") === "updated" ? "updated" : "title";
  const pages = wiki
    .catalog()
    .filter((p) => !topic || p.topic === topic)
    .sort((a, b) =>
      sort === "updated"
        ? b.updated_at.localeCompare(a.updated_at)
        : a.title.localeCompare(b.title),
    );
  return shell(
    "Articles",
    renderToStaticMarkup(
      createElement(ArticlesCatalog, {
        pages,
        topics: topicNames(wiki),
        topic,
        sort,
      }),
    ),
    { active: "Articles" },
  );
}
function comparisonForm(id, history, from, to) {
  return `<form class="toolbar" action="/wiki/${id}/compare/"><label>From revision<select name="from">${history.map((h) => option(String(h.number), `Revision ${h.number} · ${date(h.created_at)}`, String(from))).join("")}</select></label><label>To revision<select name="to">${history.map((h) => option(String(h.number), `Revision ${h.number} · ${date(h.created_at)}`, String(to))).join("")}</select></label><button>Compare</button></form>`;
}
function latestKnown(wiki, id) {
  return wiki.current(id) || wiki.revision(id, wiki.history(id).at(-1)?.number);
}
export function historyView(wiki, id) {
  const p = latestKnown(wiki, id);
  if (!p) return null;
  const history = wiki.history(id),
    from = Math.max(1, p.number - 1);
  return shell(
    `${p.title} history`,
    `${articleHeader(p, "History")}<div class="layout"><div><h2>Article history</h2>${comparisonForm(id, history, from, p.number)}<table class="revision-table"><thead><tr><th>Revision</th><th>What changed</th><th>Date</th><th>Actions</th></tr></thead><tbody>${history
      .slice()
      .reverse()
      .map(
        (h) =>
          `<tr${h.number === p.number ? ' class="latest"' : ""}><td data-label="Revision">${h.number}</td><td data-label="What changed">${e(h.summary)}</td><td data-label="Date">${date(h.created_at)}</td><td data-label="Actions"><div class="actions">${link(h.url, "View")}${link(queryLink(`/wiki/${id}/compare/`, { from: Math.max(1, h.number - 1), to: h.number }), "Compare")}</div></td></tr>`,
      )
      .join(
        "",
      )}</tbody></table></div><aside class="sidebar"><h2>About this history</h2><p>Each revision is preserved in Git. Compare two revisions to see the recorded changes.</p>${link(p.url, "Current article")}</aside></div>`,
    { active: "Articles" },
  );
}
// Bounded line alignment. Large replacements use common prefix/suffix rather
// than allocating an unbounded quadratic matrix. Every source line is retained.
export function diffLines(before, after) {
  const a = before.split("\n"),
    b = after.split("\n");
  let prefix = 0,
    suffix = 0;
  while (prefix < a.length && prefix < b.length && a[prefix] === b[prefix])
    prefix++;
  while (
    suffix < a.length - prefix &&
    suffix < b.length - prefix &&
    a[a.length - 1 - suffix] === b[b.length - 1 - suffix]
  )
    suffix++;
  const x = a.slice(prefix, a.length - suffix),
    y = b.slice(prefix, b.length - suffix),
    operations = [];
  const emit = (kind, text) => operations.push({ kind, text });
  a.slice(0, prefix).forEach((t) => emit("same", t));
  if (x.length * y.length > 500000) {
    x.forEach((t) => emit("remove", t));
    y.forEach((t) => emit("add", t));
  } else {
    const width = y.length + 1,
      dp = new Uint32Array((x.length + 1) * width);
    for (let i = x.length - 1; i >= 0; i--)
      for (let j = y.length - 1; j >= 0; j--)
        dp[i * width + j] =
          x[i] === y[j]
            ? 1 + dp[(i + 1) * width + j + 1]
            : Math.max(dp[(i + 1) * width + j], dp[i * width + j + 1]);
    let i = 0,
      j = 0;
    while (i < x.length || j < y.length) {
      if (i < x.length && j < y.length && x[i] === y[j]) {
        emit("same", x[i++]);
        j++;
      } else if (
        i < x.length &&
        (j === y.length || dp[(i + 1) * width + j] >= dp[i * width + j + 1])
      )
        emit("remove", x[i++]);
      else emit("add", y[j++]);
    }
  }
  a.slice(a.length - suffix).forEach((t) => emit("same", t));
  const groups = [];
  for (const op of operations) {
    const same = op.kind === "same";
    if (!groups.length || groups.at(-1).same !== same)
      groups.push({ same, before: [], after: [] });
    if (op.kind !== "add") groups.at(-1).before.push(op.text);
    if (op.kind !== "remove") groups.at(-1).after.push(op.text);
  }
  return groups;
}
export async function compareView(wiki, id, params) {
  const p = latestKnown(wiki, id);
  if (!p) return null;
  const from = Number(params.get("from") || Math.max(1, p.number - 1)),
    to = Number(params.get("to") || p.number);
  if (
    !Number.isSafeInteger(from) ||
    !Number.isSafeInteger(to) ||
    from < 1 ||
    to < 1
  )
    throw new WikiError("INVALID_REVISION", "Invalid comparison revisions");
  const a = wiki.revision(id, from),
    b = wiki.revision(id, to);
  if (!a || !b) return null;
  const metadata = ["title", "description", "topic"].filter(
    (k) => a[k] !== b[k],
  );
  const groups = diffLines(a.body, b.body);
  const rows = (
    await Promise.all(
      groups
        .filter((g) => g.before.join("\n").trim() || g.after.join("\n").trim())
        .map(async (g, i) => {
          const cells = await Promise.all(
            /** @type {[string[],string,number][]} */ ([
              [g.before, "removed", from],
              [g.after, "added", to],
            ]).map(async ([lines, kind, rev]) => {
              const rendered = (await renderMarkdown(lines.join("\n")))
                .replace(/ id="[^"]*"/g, "")
                .replace(/href="#/g, `href="/wiki/${id}/revision/${rev}/#`);
              return `<div class="diff-cell ${g.same ? "" : lines.length ? kind : "empty"}"><span class="diff-label">${g.same ? "Unchanged" : kind === "removed" ? "− Removed" : "+ Added"} · Revision ${rev}</span><div class="diff-prose">${rendered}</div></div>`;
            }),
          );
          return `<div class="diff-row${g.same ? " unchanged" : ""}">${cells.join("")}</div>`;
        }),
    )
  ).join("");
  const raw = groups
    .map(
      (g) =>
        `<div class="diff-row${g.same ? " unchanged" : ""}"><div class="diff-cell ${g.same ? "" : "removed"}"><span class="diff-label">Revision ${from}</span><pre>${e(g.before.join("\n"))}</pre></div><div class="diff-cell ${g.same ? "" : "added"}"><span class="diff-label">Revision ${to}</span><pre>${e(g.after.join("\n"))}</pre></div></div>`,
    )
    .join("");
  return shell(
    `${p.title} comparison`,
    `${articleHeader(p, "History")}<h2>Compare revisions</h2>${comparisonForm(id, wiki.history(id), from, to)}<p>${link(`/wiki/${id}/history/`, "Back to history")}</p>${metadata.length ? `<h3>Article details changed</h3>${metadata.map((k) => `<p><strong>${e(k)}</strong>: ${e(a[k])} → ${e(b[k])}</p>`).join("")}` : ""}<p class="meta">Removed and added text is labeled in reading order.</p><div class="diff-heading"><span>Revision ${from}</span><span>Revision ${to}</span></div>${rows}<details><summary>View Markdown comparison</summary>${raw}</details><section class="entry"><h2>Recorded change summaries</h2>${
      from === to
        ? empty("The same revision is selected on both sides.")
        : list(
            wiki
              .history(id)
              .filter(
                (h) =>
                  h.number > Math.min(from, to) &&
                  h.number <= Math.max(from, to),
              )
              .map((h) => `Revision ${h.number}: ${e(h.summary)}`),
          )
    }<p>${link(`/wiki/${id}/sources/?revision=${to}`, `Sources in revision ${to}`)}</p></section>`,
    { active: "Articles" },
  );
}
export function sourcesView(wiki, id, params) {
  const rev = params.get("revision");
  if (rev && !/^[1-9][0-9]*$/.test(rev))
    throw new WikiError("INVALID_REVISION", "Invalid source revision");
  const p = rev ? wiki.revision(id, Number(rev)) : wiki.current(id);
  if (!p) return null;
  const evidence = sources(p);
  return shell(
    `${p.title} sources`,
    `${articleHeader(p, "Sources", { historical: !!rev })}<div class="layout"><div><h2>Supporting evidence</h2><p class="muted">Links recorded in this article’s Markdown and source metadata.</p>${evidence.length ? evidence.map((s, i) => `<section class="entry" id="source-${i + 1}"><h3>${i + 1}. ${e(s.title)}</h3><p class="meta">${s.url.startsWith("/traces/") ? "Agent trace" : "Source link"}</p>${s.quote ? `<blockquote>${e(s.quote)}</blockquote>` : ""}<p>${link(s.url, "Open original passage")}</p><details><summary>Source details</summary><p class="meta">${e(s.url)}</p></details></section>`).join("") : empty("No source links are recorded in this revision.")}</div><aside class="sidebar"><h2>Article context</h2><p>Revision ${p.number} · ${date(p.created_at)}</p>${link(rev ? `/wiki/${id}/revision/${p.number}/` : p.url, "Read article")}</aside></div>`,
    { active: "Articles" },
  );
}
export function editorView(p, write) {
  if (!write)
    return shell(
      "Read-only",
      `<h1>This wiki is read-only</h1><p>${link(p.url, "Return to article")}</p>`,
      { active: "Articles" },
    );
  return shell(
    `Edit ${p.title}`,
    `<p class="breadcrumb">${link("/wiki/", "Articles")} / ${link(p.url, p.title)} / Edit</p><h1>Edit article</h1><p class="meta" id="editing-revision">Editing revision ${p.number}</p><form id="editor" data-id="${p.id}"><label>Title<input name="title" required maxlength="200"></label><label>Description<input name="description" required maxlength="600"></label><label>Topic<input name="topic" required maxlength="100"></label><div class="tabs" role="tablist" aria-label="Editor view"><button type="button" role="tab" aria-selected="true" data-editor-mode="write">Write</button><button type="button" role="tab" aria-selected="false" data-editor-mode="preview">Preview</button><button type="button" role="tab" aria-selected="false" class="split-control" data-editor-mode="split">Split</button></div><div class="editor-panes" data-mode="write"><div class="write-pane"><label>Markdown<textarea name="body" required maxlength="100000" rows="24"></textarea></label></div><div class="preview-pane"><h2 id="preview-title"></h2><p id="preview-description" class="muted"></p><article id="preview-body" class="typeset typeset-docs"></article><p id="preview-status" aria-live="polite"></p></div></div><label>Change summary<input name="summary" required maxlength="1000"></label><p class="muted">If someone saves a newer revision, you’ll need to review it before saving your draft.</p><div class="actions editor-actions"><button type="submit" disabled>Save revision</button><a class="button secondary" href="${p.url}">Cancel</a></div><p role="status" id="status">Loading current revision…</p></form>`,
    { active: "Articles" },
  );
}
function traceProvenance(hit) {
  if (!(hit.snapshot_count > 1)) return "";
  return `<details><summary>Seen in ${hit.snapshot_count} snapshots</summary>${list(hit.provenance.map((p) => link(p.url, `Imported ${date(p.imported_at)} · line ${p.line}`)))}${hit.provenance_nextOffset !== null ? `<p>${link(`/traces/provenance/?key=${hit.logical_key}`, "All source citations")}</p>` : ""}</details>`;
}
export function searchView(
  wiki,
  params,
  articles,
  traces,
  evidenceAccess = true,
) {
  return shell(
    "Search",
    renderToStaticMarkup(
      createElement(SearchPage, {
        params,
        topics: topicNames(wiki),
        articleHTML: articleResults(articles, params),
        traceHTML: traceResults(traces, params),
        evidenceAccess,
        pending: traces.pending,
        fallbackURL: queryLink(
          "/search/",
          Object.fromEntries([...params.entries(), ["sync", "1"]]),
        ),
      }),
    ),
    { className: "search-page" },
  );
}
export function tracesView(catalog, params, search, catalogResult = null) {
  const q = params.get("q") || "",
    format = ["codex", "pi"].includes(params.get("format"))
      ? params.get("format")
      : "";
  const options = catalogOptions(params),
    { offset } = options;
  const session_id = options.session_id;
  const grouped = !q && params.get("view") !== "snapshots" && !session_id;
  const sorted = grouped
    ? sessions(catalog, options)
    : sortedSnapshots(catalog, options);
  const selected = q
      ? search.results
      : catalogResult
        ? grouped
          ? catalogResult.sessions
          : catalogResult.snapshots
        : sorted.slice(offset, offset + 20),
    next = catalogResult
      ? catalogResult.nextOffset
      : q
        ? search.nextOffset
        : offset + 20 < sorted.length
          ? offset + 20
          : null;
  const entry = (item) => {
    const t = grouped ? item.latest : item;
    const snapshotsUrl = queryLink("/traces/", {
      view: "snapshots",
      format: t.format,
      session_id: item.session_id,
    });
    return `<section class="entry"><h2>${link(t.url, t.title)}</h2><p class="meta">${e(t.format)}${grouped ? ` · ${item.snapshot_count} ${item.snapshot_count === 1 ? "snapshot" : "snapshots"} · Latest import ${date(t.imported_at)}` : `${t.records ? ` · ${t.records} source records` : ""}${t.imported_at ? ` · Imported ${date(t.imported_at)}` : ""}`}</p>${grouped && item.session_id ? `<p>${link(snapshotsUrl, "View session snapshots")}</p>` : ""}${t.snippet ? `<p>${e(t.snippet)}</p><p>${link(t.url, `Open passage · line ${t.line}`)}</p>${traceProvenance(t)}` : ""}</section>`;
  };
  return shell(
    "Conversations",
    `<h1>Conversations</h1><p class="lede">Original conversations, decisions, and supporting evidence.</p><nav class="tabs" aria-label="Trace catalog view">${link("/traces/", "Sessions")}${link("/traces/?view=snapshots", "All snapshots")}</nav><form class="search-form" action="/traces/" role="search"><label class="sr-only" for="trace-query">Search conversations</label><input id="trace-query" name="q" type="search" value="${e(q)}" maxlength="300" placeholder="Search conversations"><input type="hidden" name="format" value="${format}"><button>Search</button></form><div class="filter-layout"><details class="filter-panel" data-responsive-details open><summary>Filters</summary><form class="filter-form" action="/traces/"><input type="hidden" name="q" value="${e(q)}"><input type="hidden" name="view" value="${grouped ? "sessions" : "snapshots"}">${session_id ? `<input type="hidden" name="session_id" value="${e(session_id)}">` : ""}<label>Harness<select name="format">${option("", "All", format)}${option("codex", "Codex", format)}${option("pi", "pi", format)}</select></label><button>Apply filters</button></form></details><div><p class="meta">${q ? "Matching dialogue passages" : `${catalogResult?.total ?? sorted.length} ${grouped ? "sessions" : "snapshots"} · Most recently imported first`}</p>${session_id ? `<p>Session: ${e(session_id)}</p>` : ""}${search.error ? `<p class="notice warning" role="status">${e(search.error)}</p>` : q && !search.indexed ? empty("Trace dialogue search is not available for this archive yet.") : selected.length ? selected.map(entry).join("") : empty(q ? "No matching trace passages." : "No traces have been imported.")}<nav class="pagination" aria-label="Trace pages">${offset > 0 ? link(queryLink("/traces/", { q, format, view: grouped ? "sessions" : "snapshots", session_id, offset: Math.max(0, offset - 20) }), "Previous") : ""}${next !== null ? link(queryLink("/traces/", { q, format, view: grouped ? "sessions" : "snapshots", session_id, offset: next }), "Next") : ""}</nav></div></div>`,
    { active: "Conversations" },
  );
}
