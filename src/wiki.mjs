import { markdownParser } from "./markdown-structure.mjs";
export function references(body) {
  const tree = markdownParser.parse(body);
  wikiLinks()(tree);
  const definitions = new Map();
  function collect(n) {
    if (n.type === "definition" && !definitions.has(n.identifier))
      definitions.set(n.identifier, n.url);
    n.children?.forEach(collect);
  }
  collect(tree);
  const out = new Set();
  function walk(n) {
    const url =
      n.type === "link"
        ? n.url
        : n.type === "linkReference"
          ? definitions.get(n.identifier)
          : null;
    const article = url?.match(/^\/wiki\/([^/?#]+)(?:[/?#]|$)/);
    if (article) out.add(article[1]);
    n.children?.forEach(walk);
  }
  walk(tree);
  return [...out];
}
export function wikiLinks() {
  return (tree) => {
    function walk(n) {
      if (!n.children || ["link", "code", "inlineCode"].includes(n.type))
        return;
      n.children = n.children.flatMap((c) => {
        if (c.type !== "text") {
          walk(c);
          return [c];
        }
        const chunks = [];
        let end = 0;
        for (const m of c.value.matchAll(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g)) {
          chunks.push(
            { type: "text", value: c.value.slice(end, m.index) },
            {
              type: "link",
              url: "/wiki/" + m[1] + "/",
              children: [
                { type: "text", value: m[2] || m[1].replaceAll("-", " ") },
              ],
            },
          );
          end = m.index + m[0].length;
        }
        chunks.push({ type: "text", value: c.value.slice(end) });
        return chunks;
      });
    }
    walk(tree);
  };
}
