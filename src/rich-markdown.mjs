import { createLowlight, common } from "lowlight";
const lowlight = createLowlight(common);
const text = (value) => ({ type: "text", value });
const element = (tagName, properties, children) => ({
  type: "element",
  tagName,
  properties,
  children,
});
const labels = {
  __proto__: null,
  note: "Note",
  tip: "Tip",
  important: "Important",
  warning: "Warning",
  caution: "Caution",
};
// Only named, inert structures are accepted. Author attributes never become HTML.
export function richStructures() {
  return (tree, file) => {
    function visit(node) {
      if (node.type === "blockquote") {
        const first = node.children?.[0]?.children?.[0];
        const match =
          first?.type === "text" &&
          /^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\](?:\n|$)/.exec(
            first.value,
          );
        if (match) {
          const kind = match[1].toLowerCase();
          first.value = first.value.slice(match[0].length);
          node.data = {
            hName: "aside",
            hProperties: { className: ["callout", `callout-${kind}`] },
          };
          node.children.unshift({
            type: "paragraph",
            data: { hProperties: { className: ["callout-title"] } },
            children: [text(labels[kind])],
          });
        }
      }
      if (
        ["containerDirective", "leafDirective", "textDirective"].includes(
          node.type,
        )
      ) {
        const name = node.name;
        if (
          node.type === "containerDirective" &&
          (labels[name] ||
            ["details", "tabs", "tab", "figure", "caption"].includes(name))
        ) {
          const tags = {
            details: "details",
            tabs: "div",
            tab: "section",
            figure: "figure",
            caption: "figcaption",
          };
          node.data = {
            hName: tags[name] || "aside",
            hProperties: {
              className: [
                labels[name] ? "callout" : `md-${name}`,
                ...(labels[name] ? [`callout-${name}`] : []),
              ],
            },
          };
          if (name === "details" || name === "tab" || labels[name]) {
            node.children.unshift({
              type: "paragraph",
              data: {
                hName:
                  name === "details" ? "summary" : name === "tab" ? "h4" : "p",
                hProperties: {
                  className: [
                    name === "tab" ? "md-tab-title" : "callout-title",
                  ],
                },
              },
              children: [
                text(
                  String(
                    node.attributes?.title ||
                      labels[name] ||
                      (name === "tab" ? "Tab" : "Details"),
                  ).slice(0, 200),
                ),
              ],
            });
          }
        } else {
          node.type = node.type === "textDirective" ? "inlineCode" : "code";
          node.value = String(file).slice(
            node.position.start.offset,
            node.position.end.offset,
          );
          node.children = undefined;
          node.lang = "text";
        }
      }
      node.children?.forEach(visit);
    }
    visit(tree);
  };
}
// Runs after sanitization: highlight output is produced by the trusted library.
export function richCode() {
  return (tree) => {
    function visit(node) {
      node.children = node.children?.map((child) => {
        if (
          child.tagName === "pre" &&
          child.children?.[0]?.tagName === "code"
        ) {
          const code = child.children[0];
          const source = code.children.map((n) => n.value || "").join("");
          const lang =
            (code.properties.className || [])
              .find((c) => c.startsWith("language-"))
              ?.slice(9) || "text";
          if (source.length <= 100_000 && lowlight.registered(lang)) {
            try {
              code.children = lowlight.highlight(lang, source).children;
            } catch {
              /* Keep exact source. */
            }
          }
          const controls = element("div", { className: ["code-toolbar"] }, [
            element("span", {}, [text(lang)]),
            element("button", { type: "button", className: ["copy-code"] }, [
              text("Copy code"),
            ]),
          ]);
          if (lang === "mermaid")
            return element("figure", { className: ["diagram"] }, [
              element("figcaption", {}, [text("Mermaid diagram")]),
              element(
                "button",
                { type: "button", className: ["render-diagram"] },
                [text("Show diagram")],
              ),
              element("div", { className: ["diagram-output"] }, []),
              element("details", { open: true }, [
                element("summary", {}, [text("Diagram source")]),
                controls,
                child,
              ]),
            ]);
          return element("div", { className: ["code-block"] }, [
            controls,
            child,
          ]);
        }
        visit(child);
        return child;
      });
    }
    visit(tree);
  };
}
export function namespaceFootnotes(prefix) {
  return (tree) => {
    if (!prefix) return;
    const visit = (node) => {
      if (node.properties) {
        for (const key of ["id", "href", "ariaDescribedBy"]) {
          const value = node.properties[key];
          const rename = (s) =>
            typeof s === "string" &&
            /^(#?)(?:user-content-)?(?:fn-|fnref-|footnote-label)/.test(s)
              ? s.replace(/^(#?)/, `$1${prefix}-`)
              : s;
          if (value)
            node.properties[key] = Array.isArray(value)
              ? value.map(rename)
              : rename(value);
        }
      }
      node.children?.forEach(visit);
    };
    visit(tree);
  };
}
