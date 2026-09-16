import { createElement as h } from "react";
import {
  Badge,
  Button,
  Field,
  PageHeading,
  EmptyState,
  Pagination,
  SourceTime,
} from "./primitives.mjs";
const harnesses = [
  ["", "All tools"],
  ["codex", "Codex"],
  ["pi", "pi"],
  ["claude", "Claude Code"],
];
const hidden = (name, value) => h("input", { type: "hidden", name, value });
function pageLink({ q, format, machine, offset }) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries({ q, format, machine, offset }))
    if (value !== "") params.set(key, value);
  return "/traces/?" + params;
}
function safeLink(value) {
  return typeof value === "string" &&
    !/[\u0000-\u0020\\]/.test(value) &&
    (/^\/(?!\/)/.test(value) || /^https?:\/\//i.test(value))
    ? value
    : "#";
}
export function ConversationsCatalog({ q, format, machine, offset, result }) {
  const items = result.items || result.results || [];
  const total = Number(result.total || 0);
  return h(
    "div",
    { className: "conversation-catalog" },
    h(PageHeading, {
      title: "Conversations",
      description:
        "Explore recorded conversations across your machines and tools.",
    }),
    h(
      "form",
      {
        className: "catalog-search ui-field",
        action: "/traces/",
        role: "search",
      },
      h(
        "label",
        { htmlFor: "trace-query", className: "sr-only" },
        "Search conversations",
      ),
      h("input", {
        id: "trace-query",
        name: "q",
        type: "search",
        defaultValue: q,
        maxLength: 300,
        placeholder: "Search conversations…",
      }),
      hidden("format", format),
      hidden("machine", machine),
      h(Button, { variant: "primary", type: "submit" }, "Search"),
    ),
    h(
      "div",
      { className: "catalog-layout" },
      h(
        "details",
        {
          className: "catalog-filters",
          "data-responsive-details": true,
          open: true,
        },
        h("summary", null, "Filters"),
        h(
          "form",
          { className: "filter-form", action: "/traces/" },
          hidden("q", q),
          h(
            Field,
            { label: "Harness", id: "catalog-harness" },
            h(
              "select",
              { name: "format", defaultValue: format },
              ...harnesses.map(([value, label]) =>
                h("option", { key: value, value }, label),
              ),
            ),
          ),
          h(
            Field,
            { label: "Machine", id: "catalog-machine" },
            h("input", {
              name: "machine",
              defaultValue: machine,
              placeholder: "Any machine",
              maxLength: 100,
            }),
          ),
          h(Button, { type: "submit" }, "Apply filters"),
          (q || format || machine) &&
            h(
              "a",
              { className: "catalog-clear", href: "/traces/" },
              "Clear filters",
            ),
        ),
      ),
      h(
        "div",
        { className: "catalog-results" },
        h(
          "div",
          { className: "catalog-summary" },
          h(
            "p",
            null,
            `${total.toLocaleString("en")} ${q ? (total === 1 ? "matching conversation" : "matching conversations") : total === 1 ? "conversation period" : "conversation periods"}`,
          ),
          h(
            "p",
            null,
            q ? "Most relevant first" : "Most recent activity first",
          ),
        ),
        items.length
          ? h(
              "div",
              { className: "catalog-list" },
              ...items.map((t) =>
                h(
                  "section",
                  { key: t.id, className: "catalog-row" },
                  h(
                    "div",
                    { className: "catalog-origin" },
                    h(
                      Badge,
                      null,
                      harnesses.find(
                        ([key]) => key === (t.format || t.harness),
                      )?.[1] ||
                        t.format ||
                        t.harness,
                    ),
                    h("span", null, t.machine),
                  ),
                  h("h2", null, h("a", { href: safeLink(t.url) }, t.title)),
                  t.snippet &&
                    h("p", { className: "catalog-snippet" }, t.snippet),
                  h(
                    "dl",
                    { className: "catalog-times" },
                    h(SourceTime, { value: t.end, label: "Last activity" }),
                    h(SourceTime, { value: t.start, label: "Started" }),
                  ),
                ),
              ),
            )
          : h(
              EmptyState,
              { title: "No matching conversations" },
              "Try another search or clear the filters.",
            ),
        h(Pagination, {
          label: "Trace pages",
          previous:
            offset > 0
              ? pageLink({
                  q,
                  format,
                  machine,
                  offset: Math.max(0, offset - 20),
                })
              : null,
          next:
            result.nextOffset != null
              ? pageLink({ q, format, machine, offset: result.nextOffset })
              : null,
        }),
      ),
    ),
  );
}
