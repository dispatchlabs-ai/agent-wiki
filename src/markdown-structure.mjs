import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import remarkDirective from "remark-directive";

export const markdownParser = unified()
  .use(remarkParse)
  .use(remarkGfm)
  .use(remarkMath)
  .use(remarkDirective);
export function nodeText(node) {
  if (node.type === "image") return node.alt || "";
  if (typeof node.value === "string") return node.value;
  return (node.children || [])
    .map(nodeText)
    .join(
      ["root", "list", "table", "tableRow"].includes(node.type) ? "\n" : "",
    );
}
export function headingIds() {
  return (tree) => {
    const seen = new Map();
    const used = new Set();
    for (const node of tree.children) {
      if (node.type !== "heading") continue;
      const base =
        "section-" +
        (nodeText(node)
          .toLowerCase()
          .replace(/[^\p{L}\p{N}\s-]/gu, "")
          .trim()
          .replace(/\s+/g, "-") || "heading");
      let count = seen.get(base) || 0;
      let id = base + (count ? `-${count}` : "");
      while (used.has(id)) id = `${base}-${++count}`;
      seen.set(base, count + 1);
      used.add(id);
      node.data = {
        ...node.data,
        hProperties: {
          ...node.data?.hProperties,
          id,
        },
      };
    }
  };
}
export function sections(body) {
  const tree = markdownParser.parse(body);
  headingIds()(tree);
  const result = [
    { heading: "Overview", anchor: "", body: "", states: new Set() },
  ];
  const headings = [];
  for (const node of tree.children) {
    if (node.type === "heading") {
      headings.length = node.depth - 1;
      headings[node.depth - 1] = nodeText(node);
      result.push({
        heading: headings.filter(Boolean).join(" › "),
        anchor: node.data.hProperties.id,
        body: "",
        states: new Set(),
      });
    } else {
      const section = result.at(-1);
      section.body +=
        nodeText(node).replace(
          /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g,
          (_, id, label) => label || id,
        ) + "\n";
      function tasks(n) {
        if (n.type === "listItem") {
          if (n.checked === true) section.states.add("done");
          else if (n.checked === false) section.states.add("pending");
          else if (
            /^\[w\](?:\s|$)/.test(nodeText(n)) &&
            body
              .slice(n.children?.[0]?.children?.[0]?.position?.start.offset)
              .startsWith("[w]")
          )
            section.states.add("wip");
        }
        n.children?.forEach(tasks);
      }
      tasks(node);
    }
  }
  return result.map((s) => ({ ...s, states: [...s.states] }));
}
