const e = (s) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const safe = (u) =>
  typeof u === "string" &&
  !/[\u0000-\u0020\\]/.test(u) &&
  /^(\/[^/]|https?:\/\/)/i.test(u)
    ? u
    : "#";
const link = (u, t) => `<a href="${e(safe(u))}">${e(t)}</a>`;
const more = (params, key, offset, label) => {
  const p = new URLSearchParams(params);
  p.set(key, String(offset));
  return `<p class="ui-pagination"><a class="ui-button" href="${e("/search/?" + p)}">${e(label)}</a></p>`;
};
export function articleResults(data, params) {
  if (data.error)
    return `<p class="ui-status ui-status-error" role="status">${e(data.error)}</p>`;
  return `<p class="ui-result-meta">${data.truncated ? "At least " : ""}${data.total} matching articles</p>${data.articles.length ? data.articles.map((p) => `<section class="ui-result-row"><p class="ui-result-meta">Article</p><h2>${link(p.url, p.title)}</h2><p class="ui-result-snippet">${e(p.snippet)}</p><p class="ui-result-meta">${e(p.topic)}${p.heading ? " · " + e(p.heading) : ""}</p></section>`).join("") : '<p class="ui-empty">No matching articles.</p>'}${data.nextOffset !== null ? more(params, "offset", data.nextOffset, "More articles") : ""}`;
}
export function traceResults(data, params) {
  if (data.pending)
    return '<p class="ui-result-meta" role="status">Searching conversations…</p>';
  if (data.error)
    return `<p class="ui-status ui-status-error" role="status">${e(data.error)}</p>`;
  if (!(params.get("q") || "").trim())
    return '<p class="ui-empty">Enter a search term to find trace dialogue.</p>';
  if (!data.indexed)
    return '<p class="ui-empty">Trace dialogue search is not available for this archive yet.</p>';
  return `${data.total !== undefined ? `<p class="ui-result-meta">${Number(data.total).toLocaleString("en")} matching ${data.match === "conversation" ? "conversations" : "passages"}</p>` : ""}${data.results.length ? data.results.map((p) => `<section class="ui-result-row"><p class="ui-result-meta">${e(p.format || p.harness || "Agent")} trace${p.machine ? " · " + e(p.machine) : ""}</p><h2>${link(p.url, p.title)}</h2><p class="ui-result-snippet">${e(p.snippet)}</p><p>${link(p.url, p.line ? "Open passage · line " + p.line : "Open conversation")}</p>${p.snapshot_count > 1 ? `<details><summary>Seen in ${Number(p.snapshot_count)} snapshots</summary><ul>${(p.provenance || []).map((c) => `<li>${link(c.url, "Source line " + c.line)}</li>`).join("")}</ul>${p.provenance_nextOffset !== null ? link("/traces/provenance/?key=" + encodeURIComponent(p.logical_key), "All source citations") : ""}</details>` : ""}</section>`).join("") : '<p class="ui-empty">No matching trace passages.</p>'}${data.nextOffset !== null ? more(params, "traceOffset", data.nextOffset, "More trace passages") : ""}`;
}
