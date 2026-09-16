// @ts-check
import { disclose } from "./trace-disclosure.mjs";
import { WikiError } from "./errors.mjs";
import { spoolTraceLines } from "./trace-lines.mjs";
import fs from "node:fs";
import path from "node:path";
import { parentPort, workerData } from "node:worker_threads";
import {
  digest,
  parseRecords,
  detectFormat,
  MAX_TRACE_BYTES,
  TRACE_PAGE_SIZE as PAGE_SIZE,
} from "./traces.mjs";
import { escape, link, renderMarkdown, shell } from "./render.mjs";
import { project } from "./trace-format.mjs";
export { project } from "./trace-format.mjs";
const json = (value) =>
  typeof value === "string" ? value : JSON.stringify(value, null, 2);
async function renderEvent(event, id, positionByLine) {
  const { value: r, line, kind } = event;
  const anchor = (target) =>
    `/traces/${id}/?page=${Math.floor(positionByLine.get(target) / PAGE_SIZE) + 1}#line-${target}`;
  const notice = `${event.branch ? `<p class="trace-notice">Branch change · parent ${event.parentLine ? link(anchor(event.parentLine), `source line ${event.parentLine}`) : escape(r.parentId) + " (not in this snapshot)"}</p>` : ""}${event.superseded ? '<p class="trace-notice">Superseded entry revision; original retained.</p>' : ""}${event.mirrorOf ? `<p>Duplicate event representation of ${link(anchor(event.mirrorOf), `source line ${event.mirrorOf}`)}.</p>` : ""}`;
  let content = "";
  if (event.blocks?.length) {
    for (const [blockIndex, block] of event.blocks.entries()) {
      if (block.type === "text")
        content += await renderMarkdown(
          block.text || "",
          `line-${line}-block-${blockIndex}`,
        );
      else if (block.type === "thinking")
        content += `<details><summary>Thinking</summary>${await renderMarkdown(block.thinking || block.text || "", `line-${line}-block-${blockIndex}`)}</details>`;
      else if (block.type === "toolCall")
        content += `<details><summary>Tool call · ${escape(block.name)}</summary><pre>${escape(json(block))}</pre></details>`;
      else
        content += `<p>Recorded ${escape(block.type || "content")} block — inspect the source record below.</p>`;
    }
  } else if (event.text)
    content =
      kind === "tool"
        ? `<pre>${escape(event.text)}</pre>`
        : await renderMarkdown(event.text, `line-${line}`);
  const body = `<div class="typeset typeset-chat">${content}</div><details><summary>Original source record</summary><pre>${escape(JSON.stringify(r, null, 2))}</pre></details>`;
  const heading = `${escape(["user", "assistant"].includes(kind) ? kind : event.label)} · ${link(anchor(line), `line ${line}`)}${event.timestamp != null ? ` · ${escape(event.timestamp)}` : ""}`;
  return `<section id="line-${line}" class="trace-event" data-kind="${escape(kind)}">${notice}${!["user", "assistant"].includes(kind) || event.mirrorOf || event.superseded ? `<details><summary>${heading}</summary>${body}</details>` : `<h2>${heading}</h2>${body}`}</section>`;
}
/** @param {import("./contracts.mjs").WorkerRequest} request
 * @returns {Promise<import("./contracts.mjs").RenderedTrace|import("./contracts.mjs").DisclosedTrace|import("./contracts.mjs").SpoolResult|null>} */
async function run({
  root,
  metadata,
  page,
  start,
  end,
  directory,
  disclosure,
}) {
  if (start !== undefined)
    return spoolTraceLines(root, metadata, start, end, directory);
  const filename = path.join(root, metadata.id, "source.jsonl");
  if (fs.statSync(filename).size > MAX_TRACE_BYTES)
    throw new Error("Trace exceeds 128 MiB");
  const bytes = fs.readFileSync(filename);
  if (digest(bytes) !== metadata.id)
    throw new Error("Trace integrity check failed");
  const records = parseRecords(bytes);
  if (detectFormat(records) !== metadata.format)
    throw new Error("Trace format mismatch");
  const events = project(records, metadata.format),
    pages = Math.max(1, Math.ceil(events.length / PAGE_SIZE));
  if (disclosure) return disclose(events, metadata.id, disclosure);
  if (page > pages) return null;
  const selected = events.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE),
    positions = new Map(events.map((event, index) => [event.line, index]));
  const pagination = `<nav>${page > 1 ? link(`?page=${page - 1}`, "Previous") + " · " : ""}Page ${page} of ${pages}${page < pages ? " · " + link(`?page=${page + 1}`, "Next") : ""}</nav>`;
  const header = records[0].value;
  const parent =
    header.parentSession ||
    header.lineage?.parentSessionId ||
    header.payload?.forked_from_id ||
    header.payload?.history_base;
  const html = shell(
    metadata.title,
    `<p class="breadcrumb">${link("/traces/", "Conversations")} / ${escape(metadata.format)}</p><h1>${escape(metadata.title)}</h1><p class="lede">${events.length} source records · ${escape(metadata.format)} conversation</p><div class="layout"><div>${parent ? '<p class="trace-notice">This session references earlier history. This snapshot displays only records it contains; parent history is not automatically imported.</p>' : ""}<div class="tabs" role="group" aria-label="Trace display"><button type="button" data-trace-mode="dialogue" aria-pressed="true">Dialogue</button><button type="button" data-trace-mode="records" aria-pressed="false">Source records</button></div><p class="meta">Dialogue is expanded; tool and context records remain available below.</p>${pagination}${(await Promise.all(selected.map((event) => renderEvent(event, metadata.id, positions)))).join("")}${pagination}</div><aside class="sidebar"><details data-responsive-details open><summary>Conversation details</summary><dl class="trace-details"><dt>Harness</dt><dd>${escape(metadata.format)}</dd><dt>Source records</dt><dd>${events.length}</dd><dt>Snapshot</dt><dd>${escape(metadata.id)}</dd>${metadata.session_id ? `<dt>Session</dt><dd>${escape(metadata.session_id)}</dd>` : ""}</dl></details><section><h2>On this page</h2><ul class="link-list">${selected
      .filter((ev) => ["user", "assistant"].includes(ev.kind) && !ev.mirrorOf)
      .slice(0, 20)
      .map(
        (ev) =>
          `<li>${link(`#line-${ev.line}`, `${ev.kind} · line ${ev.line}`)}</li>`,
      )
      .join("")}</ul></section><!-- cited-by --></aside></div>`,
    { active: "Conversations" },
  );
  return {
    id: metadata.id,
    format: metadata.format,
    page,
    pages,
    total_records: events.length,
    records: selected,
    html,
  };
}
/** @param {import("./contracts.mjs").WorkerMessage} message */
function reply(message) {
  parentPort.postMessage(message);
}
if (parentPort)
  run(workerData).then(
    (result) =>
      reply({
        type: "result",
        result,
        size:
          result && "transport" in result
            ? 0
            : Buffer.byteLength(JSON.stringify(result)),
      }),
    (error) =>
      reply({
        type: "error",
        error: error.message,
        code: error instanceof WikiError ? error.code : undefined,
        status: error instanceof WikiError ? error.status : undefined,
      }),
  );
