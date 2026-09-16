import { textWindowOptions, textWindow } from "./text-window.mjs";
// Agent projection only. Raw source values remain available through traceLines.
import { WikiError } from "./errors.mjs";
export function disclosureOptions(params) {
  const kind = params.get("kind") || "dialogue";
  const after = params.get("after") || "",
    before = params.get("before") || "";
  const page = Number(params.get("page") || 1);
  const valid = (v) =>
    !v ||
    (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(
      v,
    ) &&
      Number.isFinite(Date.parse(v)) &&
      new Date(v.slice(0, 10) + "T00:00:00Z")
        .toISOString()
        .startsWith(v.slice(0, 10)));
  if (
    !["dialogue", "tool", "reasoning", "context"].includes(kind) ||
    !valid(after) ||
    !valid(before) ||
    (after && before && Date.parse(after) >= Date.parse(before)) ||
    !Number.isSafeInteger(page) ||
    page < 1
  )
    throw new WikiError(
      "INVALID_TRACE_PAGE",
      "Invalid trace category, page or time range",
    );
  let window;
  try {
    window = textWindowOptions(params);
  } catch (error) {
    throw new WikiError("INVALID_TRACE_PAGE", error.message);
  }
  const event = params.get("event") || "";
  if (event && !/^line-\d+-part-\d+$/.test(event))
    throw new WikiError("INVALID_TRACE_PAGE", "Invalid event id");
  return { kind, after, before, page, event, ...window };
}
export function disclose(events, id, options) {
  const eventTime = (m) =>
    typeof m.timestamp === "number" ? m.timestamp : Date.parse(m.timestamp);
  const projected = events.flatMap((event, index) => {
    const { value, blocks, ...metadata } = event;
    const base = {
      ...metadata,
      sourceUrl: `/traces/${id}/?page=${Math.floor(index / 100) + 1}#line-${event.line}`,
    };
    if (blocks?.length && ["user", "assistant"].includes(event.kind)) {
      const texts = blocks
        .filter((b) => b.type === "text")
        .map((b) => b.text || "");
      const extra = blocks
        .filter((b) => b.type !== "text")
        .map((block) => ({
          ...base,
          kind:
            block.type === "toolCall"
              ? "tool"
              : block.type === "thinking"
                ? "reasoning"
                : "context",
          text:
            block.type === "thinking"
              ? block.thinking || block.text || ""
              : JSON.stringify(block),
        }));
      return [
        ...(texts.length ? [{ ...base, text: texts.join("\n\n") }] : []),
        ...extra,
      ];
    }
    return [base];
  });
  const parts = new Map();
  const items = projected.map((m) => {
    const part = parts.get(m.line) || 0;
    parts.set(m.line, part + 1);
    return { ...m, id: `line-${m.line}-part-${part}` };
  });
  const category = (m) =>
    ["user", "assistant"].includes(m.kind)
      ? "dialogue"
      : ["tool", "reasoning"].includes(m.kind)
        ? m.kind
        : "context";
  const { kind, after, before, page } = options;
  const selected = items.filter(
    (m) =>
      category(m) === kind &&
      (!options.event || m.id === options.event) &&
      ((!after && !before) ||
        (Number.isFinite(eventTime(m)) &&
          (!after || eventTime(m) >= Date.parse(after)) &&
          (!before || eventTime(m) < Date.parse(before)))),
  );
  return {
    id,
    kind,
    after,
    before,
    page,
    pages: Math.max(1, Math.ceil(selected.length / 100)),
    total: selected.length,
    nextPage: page * 100 < selected.length ? page + 1 : null,
    undatedCount: items.filter(
      (m) => category(m) === kind && !Number.isFinite(eventTime(m)),
    ).length,
    counts: Object.fromEntries(
      ["dialogue", "tool", "reasoning", "context"].map((k) => [
        k,
        items.filter((m) => category(m) === k).length,
      ]),
    ),
    eventFound: options.event ? selected.length > 0 : null,
    messages: selected
      .slice((page - 1) * 100, page * 100)
      .map((m) => textWindow(m, options)),
  };
}
