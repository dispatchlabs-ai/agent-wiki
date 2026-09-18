import { markdownParser, headingIds, nodeText } from "./markdown-structure.mjs";
import { WikiError } from "./errors.mjs";

// Reuse the renderer/search anchor algorithm, including duplicate headings.
// Slice source offsets rather than serializing the AST: Markdown stays exact.
export function articleSections(body) {
  const tree = markdownParser.parse(body);
  headingIds()(tree);
  const headings = tree.children.filter((node) => node.type === "heading");
  const result = [
    {
      anchor: "",
      heading: "Overview",
      depth: 0,
      start: 0,
      end: headings[0]?.position.start.offset ?? body.length,
    },
    ...headings.map((node) => ({
      anchor: node.data.hProperties.id,
      heading: nodeText(node),
      depth: node.depth,
      start: node.position.start.offset,
      end: body.length,
    })),
  ];
  const ancestors = [];
  for (const entry of result.slice(1)) {
    while (ancestors.length && ancestors.at(-1).depth >= entry.depth)
      ancestors.pop().end = entry.start;
    ancestors.push(entry);
  }
  return result;
}

export function articleReadOptions(params) {
  for (const key of ["section", "fields"])
    if (params.getAll(key).length > 1)
      throw new WikiError("INVALID_ARTICLE_SELECTION", `Specify ${key} once`);
  const section = params.has("section") ? params.get("section") : undefined;
  const fields = params.has("fields")
    ? params.get("fields").split(",")
    : undefined;
  if (
    fields &&
    (fields.length > 32 ||
      fields.some((field) => !/^[a-zA-Z][a-zA-Z0-9_]*$/.test(field)))
  )
    throw new WikiError(
      "INVALID_ARTICLE_SELECTION",
      "Use a section anchor and comma-separated top-level field names",
    );
  return { section, fields };
}

export function selectArticle(article, { section, fields }) {
  if (section === undefined && fields === undefined) return article;
  const result = { ...article };
  if (section !== undefined || fields?.includes("sections")) {
    const outline = articleSections(article.body);
    if (fields?.includes("sections"))
      result.sections = outline.map(({ start, end, ...entry }) => entry);
    if (section !== undefined) {
      const selected = outline.find((entry) => entry.anchor === section);
      if (!selected)
        throw new WikiError(
          "UNKNOWN_ARTICLE_SECTION",
          "Unknown section anchor in this article revision",
          404,
        );
      const { start, end, ...identity } = selected;
      result.body = article.body.slice(start, end);
      result.section = identity;
    }
  }
  const identity = ["id", "revision_id", "number", "commit", "url"];
  const output =
    fields === undefined
      ? result
      : Object.fromEntries(
          [...new Set([...identity, ...fields])]
            .filter((field) => Object.hasOwn(result, field))
            .map((field) => [field, result[field]]),
        );
  if (section !== undefined) output.section = result.section;
  output.partial = true;
  output.url =
    `/wiki/${article.id}/revision/${article.number}/` +
    (section ? `#${encodeURIComponent(section)}` : "");
  return output;
}
