// Shared shadcn adaptations (MIT): semantic native HTML for server pages and islands.
// See docs/shadcn-license.txt. Interactive focus management belongs to Base UI wrappers.
import { createElement as h, cloneElement, useId } from "react";
export function Button({
  variant = "outline",
  className = "",
  type = "button",
  ...props
}) {
  return h("button", {
    ...props,
    type,
    className: `ui-button ui-button-${variant} ${className}`,
  });
}
export function Badge({ children, className = "" }) {
  return h("span", { className: `ui-badge ${className}` }, children);
}
export function Field({ label, children, hint, id: suppliedId }) {
  const generatedId = useId();
  const id = suppliedId || generatedId;
  return h(
    "div",
    { className: "ui-field" },
    h("label", { htmlFor: id }, label),
    cloneElement(children, {
      id,
      "aria-describedby":
        [children.props["aria-describedby"], hint && id + "-hint"]
          .filter(Boolean)
          .join(" ") || undefined,
    }),
    hint && h("small", { id: id + "-hint" }, hint),
  );
}
export function PageHeading({ title, description }) {
  return h(
    "header",
    { className: "ui-page-heading" },
    h("h1", null, title),
    description && h("p", null, description),
  );
}
export function EmptyState({ title, children }) {
  return h(
    "div",
    { className: "ui-empty" },
    h("h2", null, title),
    children && h("p", null, children),
  );
}
export function Pagination({ previous, next, label = "Pages" }) {
  if (!previous && !next) return null;
  return h(
    "nav",
    { className: "ui-pagination", "aria-label": label },
    previous &&
      h(
        "a",
        { className: "ui-button", href: previous, rel: "prev" },
        "Previous",
      ),
    next && h("a", { className: "ui-button", href: next, rel: "next" }, "Next"),
  );
}
export function SourceTime({ value, label }) {
  const d = value ? new Date(value) : new Date(NaN);
  const valid = !Number.isNaN(d.valueOf());
  return h(
    "div",
    { className: "ui-timestamp" },
    h("dt", null, label),
    h(
      "dd",
      null,
      valid
        ? h(
            "time",
            { "data-local-time": true, dateTime: d.toISOString() },
            new Intl.DateTimeFormat("en", {
              year: "numeric",
              month: "short",
              day: "numeric",
              hour: "numeric",
              minute: "2-digit",
              timeZoneName: "short",
              timeZone: "UTC",
            }).format(d),
          )
        : "Unavailable",
    ),
  );
}
