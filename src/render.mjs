import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { SiteHeader, SiteFooter } from "../ui/components/site.mjs";
import rehypeKatex from "rehype-katex";
import {
  richStructures,
  richCode,
  namespaceFootnotes,
} from "./rich-markdown.mjs";
import {
  markdownEnhancements,
  capturedMedia,
} from "./markdown-enhancements.mjs";
import { attachmentsHTML } from "./attachments.mjs";
import remarkRehype from "remark-rehype";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import rehypeStringify from "rehype-stringify";
import { wikiLinks } from "./wiki.mjs";
import {
  headingIds,
  markdownParser,
  nodeText,
  sections,
} from "./markdown-structure.mjs";
export const escape = (s) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
function tableRegions() {
  return (tree) => {
    const visit = (node) => {
      node.children?.forEach((child, i) => {
        if (child.tagName === "table") {
          const elements = (n) =>
            (n?.children || []).filter((c) => c.type === "element");
          const head = elements(child).find((c) => c.tagName === "thead"),
            body = elements(child).find((c) => c.tagName === "tbody");
          const headers = elements(elements(head)[0]);
          const rows = elements(body);
          if (
            body &&
            headers.length > 0 &&
            headers.length <= 4 &&
            rows.every((row) => elements(row).length === headers.length)
          ) {
            child.properties = {
              ...child.properties,
              className: ["record-table"],
              role: "table",
            };
            head.properties = { ...head.properties, role: "rowgroup" };
            body.properties = { ...body.properties, role: "rowgroup" };
            elements(head)[0].properties = { role: "row" };
            headers.forEach((h) => {
              h.properties = {
                ...h.properties,
                scope: "col",
                role: "columnheader",
              };
            });
            rows.forEach((row) => {
              row.properties = { role: "row" };
              elements(row).forEach((cell, i) => {
                cell.properties = {
                  ...cell.properties,
                  dataLabel: nodeText(headers[i]),
                  role: "cell",
                };
                cell.children = [
                  {
                    type: "element",
                    tagName: "div",
                    properties: { className: ["cell-value"] },
                    children: cell.children,
                  },
                ];
              });
            });
          }
          node.children[i] = {
            type: "element",
            tagName: "div",
            properties: {
              className: ["table-scroll"],
              tabIndex: 0,
              role: "region",
              ariaLabel: "Article table",
            },
            children: [child],
          };
        } else visit(child);
      });
    };
    visit(tree);
  };
}
const parser = markdownParser()
  .use(markdownEnhancements)
  .use(richStructures)
  .use(headingIds)
  .use(wikiLinks)
  .use(remarkRehype)
  .use(rehypeSanitize, {
    ...defaultSchema,
    clobberPrefix: "",
    tagNames: [
      ...defaultSchema.tagNames,
      "aside",
      "figure",
      "figcaption",
      "details",
      "summary",
    ],
    attributes: {
      ...defaultSchema.attributes,
      "*": [
        ...defaultSchema.attributes["*"],
        ["className", /^callout(?:-\w+)?$/, /^md-[\w-]+$/],
      ],
      section: [
        ...(defaultSchema.attributes.section || []).filter(
          (a) => a[0] !== "className",
        ),
        ["className", "footnotes", "md-tab"],
      ],
      h4: [
        ...(defaultSchema.attributes.h4 || []).filter(
          (a) => a[0] !== "className",
        ),
        ["className", "sr-only", "md-tab-title"],
      ],
      code: [
        ...defaultSchema.attributes.code,
        ["className", /^language-./, "math-inline", "math-display"],
      ],
    },
  })
  .use(rehypeKatex, {
    output: "mathml",
    trust: false,
    strict: "warn",
    maxExpand: 1000,
    maxSize: 20,
  })
  .use(richCode)
  .use(capturedMedia)
  .use(tableRegions)
  .use(rehypeStringify);
export const renderMarkdown = async (body, namespace = "") =>
  String(
    await parser()
      .use(() => namespaceFootnotes(namespace.replace(/[^a-zA-Z0-9-]/g, "-")))
      .process(body),
  );
export const safeUrl = (url) => {
  if (typeof url !== "string" || /[\u0000-\u0020\\]/.test(url)) return null;
  if (/^https?:\/\//i.test(url) || /^\/(?!\/)/.test(url) || /^[?#]/.test(url))
    return url;
  return null;
};
export const link = (url, title) =>
  `<a href="${escape(safeUrl(url) || "#")}">${escape(title)}</a>`;
export const date = (value) => {
  const d = new Date(value);
  return Number.isNaN(d.valueOf())
    ? "Date unavailable"
    : new Intl.DateTimeFormat("en", {
        year: "numeric",
        month: "short",
        day: "numeric",
        timeZone: "UTC",
      }).format(d);
};
export const list = (items) =>
  `<ul class="link-list">${items.map((item) => `<li>${item}</li>`).join("")}</ul>`;
export const queryLink = (pathname, params) =>
  pathname +
  "?" +
  new URLSearchParams(
    Object.entries(params).filter(
      ([, v]) => v !== "" && v !== null && v !== undefined,
    ),
  ).toString();
export function shell(
  title,
  body,
  { active = "", className = "", signedOut = false } = {},
) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="color-scheme" content="light dark"><link rel="icon" href="/assets/favicon.svg" type="image/svg+xml"><title>${escape(title)} · Agentic Wiki</title><script src="/assets/theme.js"></script><link rel="stylesheet" href="/assets/theme.css"><link rel="stylesheet" href="/assets/typeset.css"><link rel="stylesheet" href="/assets/style.css"><link rel="stylesheet" href="/assets/ui.css"><script type="module" src="/assets/vendor/ui.js"></script><script type="module" src="/assets/client.js"></script></head><body><a class="skip-link" href="#main">Skip to content</a>${renderToStaticMarkup(createElement(SiteHeader, { active, signedOut }))}<main id="main" class="${escape(className)}">${body}</main>${renderToStaticMarkup(createElement(SiteFooter, { signedOut }))}</body></html>`;
}
export function sources(page) {
  const found = new Map();
  const add = (url, title, quote, identity = url) => {
    if (!safeUrl(url) || url.startsWith("#") || url.startsWith("/wiki/"))
      return;
    if (!found.has(identity))
      found.set(identity, {
        url,
        title: title || url,
        quote: typeof quote === "string" ? quote : "",
      });
  };
  for (const [i, s] of (Array.isArray(page.evidence) ? page.evidence : [])
    .filter(Boolean)
    .entries())
    add(
      s.url ||
        (s.conversation && s.event
          ? `/conversations/${s.conversation}/#${s.event}`
          : ""),
      s.title ||
        `${s.attribution || "Source"} · ${s.session_start || "Recorded passage"}`,
      s.quote,
      "evidence-" + i,
    );
  for (const s of page.sources || [])
    add(s.url, typeof s.title === "string" ? s.title : s.url, s.quote);
  const tree = markdownParser.parse(page.body),
    definitions = new Map();
  const collect = (n) => {
    if (n.type === "definition") definitions.set(n.identifier, n.url);
    n.children?.forEach(collect);
  };
  collect(tree);
  const visit = (n) => {
    if (n.type === "link") add(n.url, nodeText(n));
    if (n.type === "linkReference")
      add(definitions.get(n.identifier), nodeText(n));
    n.children?.forEach(visit);
  };
  visit(tree);
  return [...found.values()];
}
export function articleHeader(
  p,
  active = "Article",
  { write = false, historical = false } = {},
) {
  return `<p class="breadcrumb">${link("/wiki/", "Articles")} / ${link(queryLink("/wiki/", { topic: p.topic }), p.topic)}</p>${historical ? `<div class="notice warning">Earlier revision · Revision ${p.number} · ${link(`/wiki/${p.id}/`, "View current article")}</div>` : ""}<h1>${escape(p.title)}</h1><p class="lede">${escape(p.description)}</p><nav class="tabs" aria-label="Article views">${[
    [`/wiki/${p.id}/`, "Article"],
    [`/wiki/${p.id}/history/`, "History"],
    [
      `/wiki/${p.id}/sources/${historical ? `?revision=${p.number}` : ""}`,
      "Sources",
    ],
  ]
    .map(
      ([url, label]) =>
        `<a href="${url}"${active === label ? ' aria-current="page"' : ""}>${label}${label === "History" ? ` · ${p.revisionCount}` : label === "Sources" ? ` · ${sources(p).length}` : ""}</a>`,
    )
    .join("")}</nav>`;
}
export async function article(
  wiki,
  index,
  id,
  revision,
  { write = false } = {},
) {
  const p = revision ? wiki.revision(id, revision) : wiki.current(id);
  if (!p) return null;
  const toc = sections(p.body).filter((s) => s.anchor);
  const tocLinks = list(toc.map((s) => link("#" + s.anchor, s.heading)));
  const related = (p.related || [])
    .map((id) => wiki.current(id))
    .filter(Boolean);
  return shell(
    p.title,
    `<div class="layout article-layout"><div>${articleHeader(p, "Article", { write, historical: !!revision })}<div class="revision-meta"><p class="meta">Revision ${p.number} · Updated ${date(p.created_at)}</p>${write && !revision ? `<a class="edit-article" href="/wiki/${p.id}/edit/">Edit article</a>` : ""}</div>${revision ? `<nav class="actions" aria-label="Revision navigation">${p.number > 1 ? link(`/wiki/${id}/revision/${p.number - 1}/`, "Previous revision") : ""}${p.number < p.revisionCount ? link(`/wiki/${id}/revision/${p.number + 1}/`, "Next revision") : ""}${link(queryLink(`/wiki/${id}/compare/`, { from: p.number, to: p.revisionCount }), "Compare with current")}</nav>` : `<div class="notice">Latest change: ${escape(p.summary)}${p.number > 1 ? ` · ${link(queryLink(`/wiki/${id}/compare/`, { from: p.number - 1, to: p.number }), "View changes →")}` : ""}</div>`}${toc.length ? `<details class="mobile-toc"><summary>On this page</summary>${tocLinks}</details>` : ""}<article class="typeset typeset-docs">${await renderMarkdown(p.body)}${await attachmentsHTML(p.attachments || [])}${
      (Array.isArray(p.evidence) ? p.evidence : []).length
        ? `<section class="article-evidence"><h2>Source passages</h2>${(Array.isArray(
            p.evidence,
          )
            ? p.evidence
            : []
          )
            .filter(Boolean)
            .map(
              (s, i) =>
                `<section id="source-${i + 1}"><blockquote>${escape(s.quote || "")}</blockquote><p>${link(s.url || `/conversations/${s.conversation}/#${s.event}`, `${s.attribution || "Source"} · ${s.session_start || "Open recorded passage"}`)}</p></section>`,
            )
            .join("")}</section>`
        : ""
    }</article></div><aside class="sidebar">${toc.length ? `<section class="desktop-toc"><h2>On this page</h2>${tocLinks}</section>` : ""}<div class="article-side-links">${related.length ? `<section><h2>Related articles</h2>${list(related.map((p) => link(p.url, p.title)))}</section>` : ""}<section><h2>Linked from</h2>${index.backlinks(id).length ? list(index.backlinks(id).map((p) => link(`/wiki/${p.id}/`, p.title))) : '<p class="muted">No incoming article links yet.</p>'}</section></div></aside></div>`,
    { active: "Articles" },
  );
}
