import { createElement as h } from "react";
import { Button } from "./primitives.mjs";

export function SearchIcon() {
  return h(
    "svg",
    {
      className: "search-icon",
      viewBox: "0 0 24 24",
      width: 18,
      height: 18,
      fill: "none",
      stroke: "currentColor",
      strokeWidth: 2,
      strokeLinecap: "round",
      "aria-hidden": true,
    },
    h("circle", { cx: 10.5, cy: 10.5, r: 6.5 }),
    h("path", { d: "m16 16 4.5 4.5" }),
  );
}

export function SearchForm({
  id = "header-query",
  compact = false,
  query = "",
  hidden = {},
  live = false,
  required = false,
  label = "Search the wiki",
}) {
  return h(
    "form",
    {
      className: compact
        ? "header-search"
        : live
          ? "search-form catalog-search ui-field"
          : "search-form",
      action: "/search/",
      role: "search",
      "data-live-search": live ? true : undefined,
    },
    h(
      "label",
      { htmlFor: id, className: compact || live ? "sr-only" : undefined },
      label,
    ),
    h("input", {
      id,
      name: "q",
      type: "search",
      maxLength: 300,
      placeholder: "Articles and conversations…",
      required,
      defaultValue: query,
    }),
    ...Object.entries(hidden).map(([name, value]) =>
      h("input", { key: name, type: "hidden", name, value }),
    ),
    h(
      live ? Button : "button",
      { type: "submit", ...(live ? { variant: "primary" } : {}) },
      "Search",
    ),
  );
}
