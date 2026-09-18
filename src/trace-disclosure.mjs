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
  function* projectParts() {
    let index = 0;
    for (const event of events) {
      const { value, blocks, ...metadata } = event;
      const base = {
        ...metadata,
        sourceUrl: `/traces/${id}/?page=${Math.floor(index++ / 100) + 1}#line-${event.line}`,
      };
      if (blocks?.length) {
        const texts = blocks
          .filter((b) => b.type === "text")
          .map((b) => b.text || "");
        const extra = blocks
          .filter((b) => b.type !== "text")
          .map((block) => ({
            ...base,
            kind: ["toolCall", "tool_use", "tool_result"].includes(block.type)
              ? "tool"
              : block.type === "thinking"
                ? "reasoning"
                : "context",
            text:
              block.type === "thinking"
                ? block.thinking || block.text || ""
                : JSON.stringify(block),
          }));
        yield* [
          ...(texts.length
            ? [
                {
                  ...base,
                  kind: event.kind,
                  text: texts.join("\n\n"),
                },
              ]
            : []),
          ...extra,
        ];
      } else yield base;
    }
  }
  const category = (m) =>
    ["user", "assistant"].includes(m.kind)
      ? "dialogue"
      : ["tool", "reasoning"].includes(m.kind)
        ? m.kind
        : "context";
  const { kind, after, before, page } = options;
  const counts = { dialogue: 0, tool: 0, reasoning: 0, context: 0 },
    messages = [];
  let total = 0,
    undatedCount = 0,
    previousLine,
    part = 0;
  for (const item of projectParts()) {
    part = item.line === previousLine ? part + 1 : 0;
    previousLine = item.line;
    const m = { ...item, id: `line-${item.line}-part-${part}` };
    const categoryName = category(m),
      time = eventTime(m);
    counts[categoryName]++;
    if (categoryName === kind && !Number.isFinite(time)) undatedCount++;
    if (
      categoryName !== kind ||
      (options.event && m.id !== options.event) ||
      ((after || before) &&
        (!Number.isFinite(time) ||
          (after && time < Date.parse(after)) ||
          (before && time >= Date.parse(before))))
    )
      continue;
    if (total >= (page - 1) * 100 && total < page * 100)
      messages.push(textWindow(m, options));
    total++;
  }
  return {
    id,
    kind,
    after,
    before,
    page,
    pages: Math.max(1, Math.ceil(total / 100)),
    total,
    nextPage: page * 100 < total ? page + 1 : null,
    undatedCount,
    counts,
    eventFound: options.event ? total > 0 : null,
    messages,
  };
}
