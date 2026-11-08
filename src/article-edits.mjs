// @ts-check
import { articleSections } from "./article-read.mjs";
import { WikiError } from "./errors.mjs";
import { markdownParser } from "./markdown-structure.mjs";

const invalid = (message) => new WikiError("INVALID_EDIT", message);
const conflict = (code, message) => new WikiError(code, message, 409);
const isText = (value) => typeof value === "string";

function lines(body, offsets) {
  const numbers = [];
  let line = 1;
  let position = 0;
  for (const offset of offsets) {
    for (; position < offset; position++) if (body[position] === "\n") line++;
    numbers.push(line);
  }
  return numbers.join(", ");
}

function replaceText(
  body,
  { old_text: old, new_text: next, replace_all: all },
) {
  if (!isText(old) || !old || !isText(next))
    throw invalid("old_text must be non-empty and new_text must be a string");
  if (all !== undefined && typeof all !== "boolean")
    throw invalid("replace_all must be a boolean");
  const offsets = [];
  for (let i = body.indexOf(old); i >= 0; i = body.indexOf(old, i + old.length))
    offsets.push(i);
  if (!offsets.length)
    throw conflict(
      "EDIT_NO_MATCH",
      "old_text was not found; read the current article or section and copy the exact text",
    );
  if (offsets.length > 1 && !all)
    throw conflict(
      "EDIT_AMBIGUOUS",
      `old_text matched ${offsets.length} times (lines ${lines(body, offsets)}); add surrounding text or set replace_all`,
    );
  // Split and join keep replacement text literal; String.replace expands "$".
  return body.split(old).join(next);
}

function findSection(body, anchor) {
  const section = articleSections(body).find((s) => s.anchor === anchor);
  if (!section)
    throw new WikiError(
      "UNKNOWN_ARTICLE_SECTION",
      "Unknown section anchor; read fields=sections for the current anchors",
      404,
    );
  return section;
}

function replaceSection(body, anchor, next) {
  const { start, end } = findSection(body, anchor);
  const text = body.slice(start, end);
  if (!next.trim()) {
    const remaining = body.slice(0, start) + body.slice(end);
    return end === body.length ? remaining.trimEnd() + "\n" : remaining;
  }
  const trailing = text.slice(text.trimEnd().length);
  const separator =
    end === body.length
      ? trailing || "\n"
      : trailing.includes("\n\n")
        ? trailing
        : "\n\n";
  return body.slice(0, start) + next.trimEnd() + separator + body.slice(end);
}

function appendText(body, anchor, addition) {
  if (!addition.trim()) throw invalid("append must not be empty");
  if (anchor === undefined) return `${body.trimEnd()}\n\n${addition.trim()}\n`;
  const { start, end } = findSection(body, anchor);
  const kept = body.slice(start, end).trimEnd();
  const separator = end === body.length ? "\n" : "\n\n";
  return (
    body.slice(0, start) +
    (kept ? `${kept}\n\n` : "") +
    addition.trim() +
    separator +
    body.slice(end)
  );
}

/** Applies ordered edits to the current body; later edits see earlier results. */
export function applyArticleEdits(body, edits, hasRevision) {
  if (!Array.isArray(edits)) throw invalid("edits must be an array");
  return edits.reduce((text, edit) => {
    if (!edit || typeof edit !== "object") throw invalid("Invalid edit");
    if ("old_text" in edit) {
      if ("section" in edit || "append" in edit)
        throw invalid("Use old_text without section or append");
      return replaceText(text, edit);
    }
    if ("section" in edit && !isText(edit.section))
      throw invalid("section must be a section anchor");
    if ("append" in edit) {
      if (!isText(edit.append) || "new_text" in edit)
        throw invalid("append must be text and cannot be used with new_text");
      return appendText(text, edit.section, edit.append);
    }
    if ("section" in edit && isText(edit.new_text)) {
      // Unlike old_text, this overwrites text the caller may never have seen.
      if (!hasRevision)
        throw invalid("Replacing a section requires expected_revision_id");
      return replaceSection(text, edit.section, edit.new_text);
    }
    throw invalid("Each edit needs old_text, section with new_text, or append");
  }, body);
}

/** @param {string} body @param {Map<string, string|null>} targets */
export function repairArticleLinks(body, targets) {
  const tree = markdownParser.parse(body);
  const definitions = new Map();
  (
    /** @param {any} node */ function collect(node) {
      if (node.type === "definition" && !definitions.has(node.identifier))
        definitions.set(node.identifier, node.url);
      node.children?.forEach(collect);
    }
  )(tree);
  const linkedArticle = (url) => {
    const id = url?.match(/^\/wiki\/([^/?#]+)(?:[/?#]|$)/)?.[1];
    return id !== undefined && targets.has(id) ? id : null;
  };
  /** @type {{start:number,end:number,text:string}[]} */
  const changes = [];
  const bounds = (node) => [
    node.position.start.offset,
    node.position.end.offset,
  ];
  const label = (node) => {
    if (!node.children?.length) return "";
    return body.slice(
      node.children[0].position.start.offset,
      node.children.at(-1).position.end.offset,
    );
  };
  const retarget = (node, id) => {
    const [start, end] = bounds(node);
    const source = body.slice(start, end);
    const at = source.lastIndexOf(node.url);
    changes.push({
      start: start + at,
      end: start + at + node.url.length,
      text: `/wiki/${targets.get(id)}/`,
    });
  };
  (
    /** @param {any} node */ function walk(node) {
      if (node.type === "definition") {
        const id = linkedArticle(node.url);
        if (id && targets.get(id)) retarget(node, id);
        else if (id) {
          const [start, end] = bounds(node);
          changes.push({
            start,
            end: end + Number(body[end] === "\n"),
            text: "",
          });
        }
        return;
      }
      if (node.type === "link") {
        const id = linkedArticle(node.url);
        if (id && targets.get(id)) retarget(node, id);
        else if (id) {
          const [start, end] = bounds(node);
          changes.push({ start, end, text: label(node) });
        }
        return;
      }
      if (node.type === "linkReference") {
        const id = linkedArticle(definitions.get(node.identifier));
        if (id) {
          // A replacement retargets the shared definition instead.
          if (!targets.get(id)) {
            const [start, end] = bounds(node);
            changes.push({ start, end, text: label(node) });
          }
          return;
        }
      }
      if (node.type === "text") {
        const [start, end] = bounds(node);
        // Table cells keep their escaped alias separator in the source.
        for (const match of body
          .slice(start, end)
          .matchAll(/\[\[([^\]|\\]+)(?:(\\?\|)([^\]]+))?\]\]/g)) {
          const [source, destination, separator, alias] = match;
          // Matches references(): the article ID ends at a path, query or anchor.
          const id = destination.split(/[/?#]/, 1)[0];
          if (!targets.has(id)) continue;
          const replacement = targets.get(id);
          changes.push({
            start: start + match.index,
            end: start + match.index + source.length,
            text: replacement
              ? `[[${replacement}${alias ? separator + alias : ""}]]`
              : alias || id.replaceAll("-", " "),
          });
        }
        return;
      }
      node.children?.forEach(walk);
    }
  )(tree);
  return changes
    .sort((a, b) => b.start - a.start)
    .reduce(
      (text, change) =>
        text.slice(0, change.start) + change.text + text.slice(change.end),
      body,
    );
}

const pick = (source, keys) =>
  Object.fromEntries(
    keys.filter((key) => source[key] !== undefined).map((k) => [k, source[k]]),
  );

/** Converts one wiki.edit request into the shared atomic save draft. */
export function articleEditDraft(input) {
  return {
    operation_id: input?.operation_id,
    updates: [
      {
        ...pick(input ?? {}, [
          "id",
          "summary",
          "expected_revision_id",
          "title",
          "description",
          "topic",
          "related",
          "questions",
        ]),
        edits: input?.edits ?? [],
      },
    ],
  };
}

/** Converts one wiki.delete request into the shared atomic save draft. */
export function articleDeleteDraft(input) {
  return {
    operation_id: input?.operation_id,
    updates: [
      {
        ...pick(input ?? {}, [
          "id",
          "summary",
          "expected_revision_id",
          "replace_with",
        ]),
        delete: true,
      },
    ],
  };
}
