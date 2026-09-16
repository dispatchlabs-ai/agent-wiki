import { createElement as h } from "react";
import {
  Badge,
  Button,
  Field,
  PageHeading,
  EmptyState,
  SourceTime,
} from "./primitives.mjs";
import { SearchForm } from "./search.mjs";
const options = (entries) =>
  entries.map(([value, label]) => h("option", { key: value, value }, label));
const select = (label, name, value, entries) =>
  h(
    Field,
    { label, id: `library-${name}` },
    h("select", { name, defaultValue: value }, ...options(entries)),
  );
const hidden = (name, value) => h("input", { type: "hidden", name, value });
export function ArticlesCatalog({ pages, topics, topic, sort }) {
  return h(
    "div",
    { className: "library-page" },
    h(PageHeading, {
      title: "Articles",
      description: "Browse the people, organizations, and ideas in your wiki.",
    }),
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
        h("summary", null, "Filter articles"),
        h(
          "form",
          { className: "filter-form", action: "/wiki/" },
          select("Topic", "topic", topic, [
            ["", "All topics"],
            ...topics.map((t) => [t, t]),
          ]),
          select("Sort", "sort", sort, [
            ["title", "Title A–Z"],
            ["updated", "Recently updated"],
          ]),
          h(Button, { type: "submit" }, "Apply filters"),
          (topic || sort !== "title") &&
            h(
              "a",
              { className: "catalog-clear", href: "/wiki/" },
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
            `${pages.length.toLocaleString("en")} ${pages.length === 1 ? "article" : "articles"}`,
          ),
          h("p", null, sort === "updated" ? "Recently updated" : "Title A–Z"),
        ),
        pages.length
          ? h(
              "div",
              { className: "ui-result-list" },
              ...pages.map((p) =>
                h(
                  "section",
                  { className: "ui-result-row", key: p.id },
                  p.topic &&
                    h(
                      "div",
                      { className: "ui-result-meta" },
                      h(Badge, null, p.topic),
                    ),
                  h(
                    "h2",
                    null,
                    h(
                      "a",
                      { href: `/wiki/${encodeURIComponent(p.id)}/` },
                      p.title,
                    ),
                  ),
                  p.description &&
                    h("p", { className: "ui-result-snippet" }, p.description),
                  h(
                    "dl",
                    { className: "catalog-times" },
                    h(SourceTime, { label: "Updated", value: p.updated_at }),
                  ),
                ),
              ),
            )
          : h(
              EmptyState,
              { title: "No articles match this topic" },
              "Choose another topic or clear the filters.",
            ),
      ),
    ),
  );
}
export function SearchPage({
  params,
  topics,
  articleHTML,
  traceHTML,
  pending,
  fallbackURL,
  evidenceAccess = true,
}) {
  const q = params.get("q") || "";
  const type = !evidenceAccess
    ? "articles"
    : ["articles", "traces"].includes(params.get("type"))
      ? params.get("type")
      : "all";
  const state = params.get("state") || "",
    topic = params.get("topic") || "",
    format = params.get("format") || "",
    machine = params.get("machine") || "";
  const types = !evidenceAccess
    ? [["articles", "Articles"]]
    : [
        ["all", "All"],
        ["articles", "Articles"],
        ["traces", "Conversations"],
      ];
  const result = (title, id, html, loading) =>
    h(
      "section",
      { className: "search-result-group", "aria-labelledby": `${id}-heading` },
      h("h2", { id: `${id}-heading` }, title),
      h("div", {
        id,
        "aria-live": "polite",
        "data-pending": loading ? "true" : undefined,
        dangerouslySetInnerHTML: { __html: html },
      }),
      loading &&
        h(
          "noscript",
          null,
          h("a", { href: fallbackURL }, "Load conversation results"),
        ),
    );
  return h(
    "div",
    { className: "library-page" },
    h(PageHeading, {
      title: "Search the wiki",
      description: evidenceAccess
        ? "Find articles and the conversations behind them."
        : "Find published articles.",
    }),
    h(SearchForm, {
      id: "search-query",
      query: q,
      hidden: { type, state, topic, format, machine },
      live: true,
      label: "Search query",
    }),
    h(
      "nav",
      { className: "ui-link-tabs", "aria-label": "Search type" },
      ...types.map(([value, label]) => {
        const next = new URLSearchParams(params);
        next.set("type", value);
        next.delete("offset");
        next.delete("traceOffset");
        return h(
          "a",
          {
            key: value,
            href: "/search/?" + next,
            "aria-current": value === type ? "page" : undefined,
          },
          label,
        );
      }),
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
        h("summary", null, "Filter results"),
        h(
          "form",
          { className: "filter-form", action: "/search/" },
          hidden("q", q),
          select("Type", "type", type, types),
          h(
            "fieldset",
            { className: "ui-filter-group" },
            h("legend", null, "Articles"),
            select("Topic", "topic", topic, [
              ["", "All topics"],
              ...topics.map((t) => [t, t]),
            ]),
            select("Task status", "state", state, [
              ["", "Any status"],
              ["pending", "Pending"],
              ["wip", "In progress"],
              ["done", "Done"],
            ]),
          ),
          evidenceAccess &&
            h(
              "fieldset",
              { className: "ui-filter-group" },
              h("legend", null, "Conversations"),
              select("Trace harness", "format", format, [
                ["", "All"],
                ["codex", "Codex"],
                ["pi", "pi"],
                ["claude", "Claude Code"],
              ]),
              h(
                Field,
                { label: "Trace machine", id: "library-machine" },
                h("input", {
                  name: "machine",
                  defaultValue: machine,
                  maxLength: 100,
                  placeholder: "Any machine",
                }),
              ),
            ),
          h(Button, { type: "submit" }, "Apply filters"),
          h(
            "a",
            {
              className: "catalog-clear",
              href: "/search/?" + new URLSearchParams({ q }),
              "data-clear-search-filters": true,
            },
            "Clear filters",
          ),
        ),
      ),
      h(
        "div",
        { className: "catalog-results" },
        type !== "traces" &&
          result("Articles", "article-results", articleHTML, false),
        type !== "articles" &&
          result("Conversations", "trace-results", traceHTML, pending),
      ),
    ),
  );
}
