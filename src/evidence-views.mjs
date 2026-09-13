import {
  shell,
  escape as e,
  link,
  date,
  queryLink,
  renderMarkdown,
  list,
  sources,
} from "./render.mjs";
import { conversationText } from "./conversation-text.mjs";
import { attachmentsHTML } from "./attachments.mjs";
const kinds = [
  ["dialogue", "Conversation"],
  ["tool", "Tool calls and results"],
  ["thinking", "Recorded thinking"],
  ["reasoning", "Reasoning"],
  ["context", "Context"],
  ["analysis", "Analysis"],
];
const choice = (value, label, selected) =>
  `<option value="${e(value)}"${value === selected ? " selected" : ""}>${e(label)}</option>`;
function sourceTime(value, label) {
  const d = value ? new Date(value) : new Date(NaN);
  if (Number.isNaN(d.valueOf())) return `${e(label)} unavailable`;
  const formatted = new Intl.DateTimeFormat("en", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
    timeZone: "UTC",
  }).format(d);
  return `${e(label)} <time data-local-time datetime="${e(d.toISOString())}">${e(formatted)}</time>`;
}
export function evidenceCatalog(params, result) {
  const q = params.get("q") || "",
    format = params.get("format") || "",
    machine = params.get("machine") || "";
  const items = result.items || result.results || [];
  const offset = Number(params.get("offset") || 0);
  return shell(
    "Conversations",
    `<h1>Conversations</h1><p class="lede">Conversations and evidence from the existing archive.</p><form class="search-form" action="/traces/" role="search"><label class="sr-only" for="trace-query">Search conversations</label><input id="trace-query" name="q" type="search" value="${e(q)}" maxlength="300" placeholder="Search conversations"><input type="hidden" name="format" value="${e(format)}"><input type="hidden" name="machine" value="${e(machine)}"><button>Search</button></form><div class="filter-layout"><details class="filter-panel" data-responsive-details open><summary>Filters</summary><form class="filter-form" action="/traces/"><input type="hidden" name="q" value="${e(q)}"><label>Harness<select name="format">${[
      ["", "All"],
      ["codex", "Codex"],
      ["pi", "pi"],
      ["claude", "Claude Code"],
    ]
      .map(([v, l]) => choice(v, l, format))
      .join(
        "",
      )}</select></label><label>Machine<input name="machine" value="${e(machine)}" placeholder="Any machine" maxlength="100"></label><button>Apply filters</button></form></details><div><p class="meta">${Number(result.total || 0).toLocaleString("en")} ${q ? "matching conversations" : "conversation periods · Most recent activity first"}</p>${items.length ? items.map((t) => `<section class="entry"><h2>${link(t.url, t.title)}</h2><p class="meta">${e(t.machine)} · ${e(t.format || t.harness)} · ${sourceTime(t.start, "Started")} · ${sourceTime(t.end, "Last activity")}</p>${t.snippet ? `<p>${e(t.snippet)}</p>` : ""}</section>`).join("") : '<p class="empty">No matching conversations.</p>'}<nav class="pagination" aria-label="Trace pages">${offset > 0 ? link(queryLink("/traces/", { q, format, machine, offset: Math.max(0, offset - 20) }), "Previous") : ""}${result.nextOffset !== null ? link(queryLink("/traces/", { q, format, machine, offset: result.nextOffset }), "Next") : ""}</nav></div></div>`,
    { active: "Conversations" },
  );
}
export async function evidenceView(data, wiki) {
  const base = `/conversations/${encodeURIComponent(data.id)}/`;
  const messages = [];
  for (const m of data.messages || []) {
    const url =
      queryLink(base, {
        after: data.after,
        before: data.before,
        limit: data.limit,
        kind: data.kind,
        offset: data.offset,
      }) +
      "#" +
      encodeURIComponent(m.id);
    const displayed = conversationText(m, data.harness);
    messages.push(
      `<section class="evidence-message" id="${e(m.id)}">${(m.aliases || []).map((id) => `<span class="message-alias" id="${e(id)}"></span>`).join("")}<header><strong>${e(m.role === "user" ? "You" : m.role === "assistant" ? "Agent" : m.role || m.kind)}</strong><span class="meta">${e(m.phase === "final_answer" ? "Final response" : m.phase === "commentary" ? "Progress update" : m.phase || "")}</span>${link(url, m.timestamp ? String(m.timestamp).slice(11, 19) : "Time not recorded")}</header>${m.inherited ? '<p class="meta">Inherited from parent history</p>' : ""}${m.rolled_back ? '<p class="notice">Part of a rolled-back turn; retained as recorded.</p>' : ""}<div class="prose typeset typeset-chat">${await renderMarkdown(displayed, m.id)}</div>${await attachmentsHTML(m.attachments)}<details class="source-location"><summary>Source location</summary>${displayed !== (m.text || "") ? `<details class="original-message"><summary>Original recorded message</summary><pre>${e(m.text)}</pre></details>` : ""}<p>Snapshot <code>${e(m.snapshot || data.snapshot || "Not recorded")}</code>${m.line ? ` · Line ${e(m.line)}` : ""}</p><p>Event <code>${e(m.id)}</code></p>${link(url, "Link to this event")}</details></section>`,
    );
  }
  const related = [
    ...(data.related?.relations || []),
    ...(data.related?.siblings || []),
  ].filter(
    (v, i, a) => v.id !== data.id && a.findIndex((x) => x.id === v.id) === i,
  );
  const cited = [...wiki.pages.values()].filter((p) =>
    sources(p).some((s) => s.url.includes(`/conversations/${data.id}/`)),
  );
  const pagination = `<nav class="pagination" aria-label="Conversation pages">${data.previousOffset !== null ? link(queryLink(base, { after: data.after, before: data.before, limit: data.limit, kind: data.kind, offset: data.previousOffset }), "Previous messages") : ""}${data.nextOffset !== null ? link(queryLink(base, { after: data.after, before: data.before, limit: data.limit, kind: data.kind, offset: data.nextOffset }), "Next messages") : ""}</nav>`;
  return shell(
    data.title,
    `<div class="evidence-reader" data-evidence-id="${e(data.id)}">${link("/traces/", "← Conversations")}<h1>${e(data.title)}</h1><p class="lede">${e(data.machine)} · ${e(data.harness)} · ${date(data.start)}</p>${[...(data.recovery_notes || []), ...(data.warnings || [])].map((w) => `<p class="notice warning">${e(w)}</p>`).join("")}${data.parent_thread || data.forked_from ? `<p class="meta">Parent thread: ${e(data.parent_thread || data.forked_from)}</p>` : ""}<nav class="tabs trace-categories" aria-label="Trace content">${kinds.map(([kind, label]) => `<a href="${e(queryLink(base, { kind, after: data.after, before: data.before, limit: data.limit }))}"${kind === data.kind ? ' aria-current="page"' : ""}>${label}${data.counts?.[kind] ? ` · ${data.counts[kind]}` : ""}</a>`).join("")}</nav>${data.eventFound === false ? '<p class="notice warning">That event is not available in this captured conversation.</p>' : ""}<p class="meta">${data.kind === "analysis" ? "Recorded analysis" : `${data.total ? data.offset + 1 : 0}–${Math.min(data.offset + data.limit, data.total)} of ${data.total} messages · ${e(data.kind)}`}</p>${pagination}<div class="evidence-messages">${messages.join("") || (data.kind === "analysis" && data.analysis ? `<pre>${e(JSON.stringify(data.analysis, null, 2))}</pre>` : '<p class="empty">No recorded content in this category.</p>')}</div>${pagination}<details class="source-location"><summary>About this record</summary><p>Rendered from the existing original archive without AI rewriting. Parent history, source aliases, gaps, and recorded optional activity remain available. Attachment previews may be shortened; downloads retain captured originals.</p><p>${e(data.producer_version || "Producer version not recorded")} · ${e(data.history_mode || "History mode not recorded")} · Thread ${e(data.thread_id || "")}</p></details>${related.length ? `<section><h2>Related conversation history</h2>${list(related.map((c) => link(`/conversations/${encodeURIComponent(c.id)}/`, c.title)))}</section>` : ""}${cited.length ? `<section><h2>Cited by</h2>${list(cited.map((p) => link(`/wiki/${p.id}/`, p.title)))}</section>` : ""}</div>`,
    { active: "Conversations" },
  );
}
export async function attachmentView(asset, file) {
  return shell(
    file?.name || "File",
    `<h1>${e(file?.name || "Captured file")}</h1>${file ? await attachmentsHTML([file]) : '<p class="notice">File details are unavailable.</p>'}<p>${link("/media/" + asset, "Open captured file")}</p>`,
    { active: "Conversations" },
  );
}
