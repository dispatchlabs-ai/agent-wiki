export const mediaPattern =
  /^\/media\/([a-f0-9]{64}\.(?:png|jpg|jpeg|gif|webp|pdf|bin))$/;
// Keep raw HTML visible as source text and distinguish the existing [w] task marker.
export function markdownEnhancements() {
  return (tree, file) => {
    function visit(node) {
      if (node.type === "html") node.type = "text";
      const p = node.type === "listItem" && node.children?.[0];
      const text = p?.type === "paragraph" && p.children?.[0];
      if (
        text?.type === "text" &&
        /^\[w\](?:\s|$)/.test(text.value) &&
        String(file).slice(text.position?.start.offset).startsWith("[w]")
      ) {
        text.value = text.value.slice(3).trimStart();
        p.children.unshift({ type: "text", value: "◐ In progress: " });
      }
      node.children?.forEach(visit);
    }
    visit(tree);
  };
}
const el = (tagName, properties, children) => ({
  type: "element",
  tagName,
  properties,
  children,
});
const text = (value) => ({ type: "text", value });
export function capturedMedia() {
  return (tree) => {
    function visit(node, insideLink = false) {
      if (!node.children) return;
      const isLink = node.tagName === "a";
      node.children = node.children.map((child) => {
        if (child.tagName === "img") {
          const { src, alt = "Image" } = child.properties;
          if (
            !mediaPattern.test(String(src)) ||
            !/\.(png|jpg|jpeg|gif|webp)$/.test(String(src))
          ) {
            return el("span", { className: ["unavailable-image"] }, [
              text(`${alt} (image not captured)`),
            ]);
          }
          Object.assign(child.properties, {
            loading: "lazy",
            decoding: "async",
          });
          if (isLink || insideLink) return child;
          return el("span", { className: ["embedded-image"] }, [
            el(
              "a",
              {
                href: src,
                target: "_blank",
                rel: ["noopener"],
                ariaLabel: `Open original: ${alt}`,
              },
              [child],
            ),
            el(
              "a",
              { href: src, download: "", className: ["image-download"] },
              [text("Download image")],
            ),
          ]);
        }
        visit(child, insideLink || isLink);
        if (
          child.tagName === "p" &&
          child.children.length === 1 &&
          child.children[0].tagName === "a"
        ) {
          const a = child.children[0];
          const asset = mediaPattern.exec(String(a.properties.href))?.[1];
          if (asset && /\.(pdf|bin)$/.test(asset)) {
            return el("section", { className: ["file-card"] }, [
              a,
              el("p", { className: ["file-actions"] }, [
                el("a", { href: `/files/${asset}/` }, [
                  text("Preview and file details"),
                ]),
                text(" · "),
                el("a", { href: a.properties.href, download: "" }, [
                  text("Download"),
                ]),
              ]),
            ]);
          }
        }
        return child;
      });
      if (
        isLink &&
        node.children.length === 1 &&
        node.children[0].tagName === "img" &&
        node.properties.href === node.children[0].properties.src
      )
        Object.assign(node.properties, { target: "_blank", rel: ["noopener"] });
    }
    visit(tree);
  };
}
