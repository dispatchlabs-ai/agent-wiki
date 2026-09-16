import { unified } from "unified";
import remarkParse from "remark-parse";

// Display-only projection. The provider text and source archive stay untouched.
// Recognize the complete Codex file envelope, never arbitrary user headings.
export function conversationText(message, harness) {
  const original = message.text || "";
  if (harness !== "codex" || message.role !== "user") return original;
  const envelope =
    /^# Files mentioned by the user:\r?\n([\s\S]*?)^## My request:\r?\n/m.exec(
      original,
    );
  if (!envelope || envelope.index !== 0) return original;
  const entries = envelope[1].split(/\r?\n/).filter((line) => line.trim());
  const files = Array.isArray(message.attachments) ? message.attachments : [];
  const paths = new Set();
  const names = new Set();
  for (const entry of entries) {
    const match = /^## (.+?): (\/[^\r\n]+|[A-Za-z]:\\[^\r\n]+)$/.exec(entry);
    if (!match) return original;
    const [, name, path] = match;
    const matches = files.filter((file) => file && file.name === name);
    // Ambiguous or absent metadata is not enough evidence to hide source text.
    if (matches.length !== 1 || names.has(name)) return original;
    names.add(name);
    if (matches[0].kind === "image") paths.add(path);
  }
  if (!entries.length) return original;
  const body = original.slice(envelope[0].length);
  const protectedRanges = [];
  function visit(node) {
    if (["code", "inlineCode"].includes(node.type) && node.position)
      protectedRanges.push([
        node.position.start.offset,
        node.position.end.offset,
      ]);
    node.children?.forEach(visit);
  }
  visit(unified().use(remarkParse).parse(body));
  return body.replace(
    /<image name=\[Image #\d+\] path="([^"\r\n]+)">\s*<\/image>/g,
    (marker, path, offset) =>
      paths.has(path) &&
      body[offset - 1] !== "\\" &&
      !protectedRanges.some(
        ([start, end]) => offset < end && offset + marker.length > start,
      )
        ? ""
        : marker,
  );
}
