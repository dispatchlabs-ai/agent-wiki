import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ConversationsCatalog } from "../ui/components/conversations.mjs";
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
export function evidenceCatalog(params, result) {
  return shell(
    "Conversations",
    renderToStaticMarkup(
      h(ConversationsCatalog, {
        q: params.get("q") || "",
        format: params.get("format") || "",
        machine: params.get("machine") || "",
        offset: Number(params.get("offset") || 0),
        result,
      }),
    ),
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
