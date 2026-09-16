import { createElement as h } from "react";
import { SearchForm, SearchIcon } from "./search.mjs";

const destinations = [
  ["/", "Home"],
  ["/wiki/", "Articles"],
  ["/traces/", "Conversations"],
];

export function Brand() {
  return h(
    "a",
    { href: "/", className: "brand" },
    h(
      "span",
      { className: "brand-lockup" },
      h("span", { className: "brand-mark", "aria-hidden": true }),
      h("span", null, "Agent Wiki"),
    ),
    h(
      "span",
      { className: "brand-subtitle" },
      "Memory, with a path back to the evidence",
    ),
  );
}

export function SiteNavigation({ active }) {
  return h(
    "nav",
    { className: "site-nav", "aria-label": "Main navigation" },
    destinations.map(([href, label]) =>
      h(
        "a",
        {
          key: href,
          href,
          "aria-current": active === label ? "page" : undefined,
        },
        label,
      ),
    ),
  );
}

export function SiteHeader({ active, signedOut = false }) {
  return h(
    "header",
    { className: signedOut ? "site-header signed-out-header" : "site-header" },
    h(Brand),
    !signedOut && h(SiteNavigation, { active }),
    h(
      "div",
      { className: "header-actions" },
      !signedOut && h(SearchForm, { compact: true }),
      !signedOut && h("span", { id: "quick-search" }),
      !signedOut &&
        h(
          "a",
          {
            className: "mobile-search",
            href: "/search/",
            "aria-label": "Search",
          },
          h(SearchIcon),
          h("span", { className: "search-trigger-text" }, "Search"),
        ),
      h("span", { id: "theme-toggle" }),
      !signedOut && h("span", { id: "account-menu" }),
    ),
  );
}

export function SiteFooter({ signedOut = false }) {
  return h(
    "footer",
    { className: "site-footer" },
    h(
      "span",
      { className: "footer-links" },
      "Agent Wiki",
      !signedOut && " · ",
      !signedOut &&
        h("a", { href: "/api/articles/authoring.json" }, "Agent API"),
    ),
    h("noscript", null, "Appearance follows your device settings."),
  );
}

export function UpdatePeriod({ range }) {
  return h(
    "nav",
    { className: "tabs", "aria-label": "Update period" },
    [
      ["today", "Today"],
      ["week", "This week"],
      ["all", "All changes"],
    ].map(([value, label]) =>
      h(
        "a",
        {
          key: value,
          href: `/?range=${value}`,
          "aria-current": value === range ? "page" : undefined,
        },
        label,
      ),
    ),
  );
}

// Show a bounded excerpt of the article description, not internal edit instructions.
// The complete description and original change summaries remain on article/history pages.
function excerpt(description) {
  const text = String(description).replace(/\s+/g, " ").trim();
  if (text.length <= 180) return text;
  const end = text.lastIndexOf(" ", 180);
  return text.slice(0, end > 120 ? end : 180).trimEnd() + "…";
}

export function ArticleCard({
  title,
  href,
  description,
  metadata,
  changesHref,
}) {
  return h(
    "section",
    { className: "entry article-card" },
    h("p", { className: "eyebrow" }, metadata),
    h("h2", null, h("a", { href }, title)),
    h("p", { className: "article-excerpt" }, excerpt(description)),
    changesHref
      ? h(
          "div",
          { className: "actions" },
          h(
            "a",
            { href: changesHref, "aria-label": `View changes to ${title}` },
            "View changes",
          ),
        )
      : null,
  );
}
