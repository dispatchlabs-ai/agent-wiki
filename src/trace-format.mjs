import { createHash } from "node:crypto";
// Pure format interpretation. Keep original records intact; unknown variants
// remain context. Rendering, filesystem access and worker lifecycle live elsewhere.
const textOf = (value) => {
  if (typeof value === "string") return value;
  if (Array.isArray(value))
    return value.map(textOf).filter(Boolean).join("\n\n");
  if (!value || typeof value !== "object") return "";
  return (
    value.text || value.thinking || value.input_text || value.output_text || ""
  );
};
const json = (value) =>
  typeof value === "string" ? value : JSON.stringify(value, null, 2);
function describe(record, format) {
  const r = record.value,
    p = r.payload || {},
    item = p.item || {};
  const base = {
    ...record,
    timestamp: r.timestamp ?? r.message?.timestamp ?? null,
    kind: "context",
    text: "",
    label: r.type || "Unknown record",
    stream: r.type,
  };
  if (format === "pi") {
    if (r.type === "message") {
      const m = r.message || {};
      base.label = m.role || "Message";
      base.kind = ["user", "assistant"].includes(m.role) ? m.role : "tool";
      base.text = textOf(m.content) || m.output || "";
      base.blocks = Array.isArray(m.content) ? m.content : [];
    } else if (r.type === "compaction" || r.type === "branch_summary")
      base.text = r.summary || "";
    return base;
  }
  if (format === "claude") {
    const message = r.message || {},
      blocks = Array.isArray(message.content) ? message.content : [];
    base.timestamp = r.timestamp ?? null;
    base.label = r.type || message.role || "Claude record";
    base.stream = "claude";
    if (["user", "assistant"].includes(r.type)) {
      const role = ["user", "assistant"].includes(message.role)
        ? message.role
        : r.type;
      const hasText =
        typeof message.content === "string" ||
        blocks.some((block) => block?.type === "text");
      const hasTool = blocks.some((block) =>
        ["tool_use", "tool_result"].includes(block?.type),
      );
      const hasThinking = blocks.some((block) => block?.type === "thinking");
      base.kind = hasText
        ? role
        : hasTool
          ? "tool"
          : hasThinking
            ? "reasoning"
            : role;
      base.label = role;
      base.text = textOf(message.content);
      base.blocks = blocks;
    }
    return base;
  }
  if (r.type === "response_item") {
    base.label = p.type;
    if (p.type === "message") {
      base.kind = p.channel === "analysis" ? "reasoning" : p.role;
      base.text = textOf(p.content);
    } else if (p.type === "reasoning") {
      base.kind = "reasoning";
      base.text = textOf(p.summary) + "\n\n" + textOf(p.content);
    } else if (/call|output|search|image_generation/.test(p.type || "")) {
      base.kind = "tool";
      base.text = json(p.output ?? p.arguments ?? p.input ?? p);
    }
  } else if (r.type === "event_msg") {
    base.label = p.type;
    if (p.type === "user_message" || p.type === "agent_message") {
      base.kind = p.type === "user_message" ? "user" : "assistant";
      base.text = p.message || "";
    } else if (/reasoning/.test(p.type || "")) {
      base.kind = "reasoning";
      base.text = p.text || p.message || "";
    } else if (p.type === "item_completed") {
      base.stream = "typed";
      base.label = item.type || "Completed item";
      if (["UserMessage", "AgentMessage"].includes(item.type)) {
        base.kind = item.type === "UserMessage" ? "user" : "assistant";
        base.text =
          textOf(item.content) || textOf(item.text) || textOf(item.message);
      } else if (item.type === "Reasoning") {
        base.kind = "reasoning";
        base.text =
          textOf(item.summary_text) + "\n\n" + textOf(item.raw_content);
      } else {
        base.kind = "tool";
        base.text = json(item);
      }
    }
  }
  return base;
}
// Only cross-record annotations are retained between passes. Source values and
// dialogue text are never accumulated across the whole snapshot.
export function projectionContext(records) {
  const latest = new Map(),
    positions = new Map();
  let paginated = false,
    format,
    ordinal = 0;
  for (const { line, value } of records) {
    format ??=
      value.type === "session"
        ? "pi"
        : value.type === "session_meta"
          ? "codex"
          : typeof value.sessionId === "string"
            ? "claude"
            : undefined;
    positions.set(line, ordinal++);
    if (format === "pi" && value.id) latest.set(value.id, line);
    if (format === "claude" && value.uuid) latest.set(value.uuid, line);
    if (
      value.payload?.history_mode === "paginated" ||
      (value.payload?.type === "item_completed" &&
        ["UserMessage", "AgentMessage", "Reasoning"].includes(
          value.payload?.item?.type,
        ))
    )
      paginated = true;
  }
  return { latest, positions, paginated };
}

export function* projectRecords(records, format, context) {
  let previous = null,
    turn = 0,
    seen = new Map();
  for (const record of records) {
    const event = describe(record, format),
      r = event.value;
    if (format === "pi") {
      event.superseded = r.id && context.latest.get(r.id) !== event.line;
      if (r.id && r.type !== "session" && !event.superseded) {
        event.parentLine = context.latest.get(r.parentId) || null;
        event.branch = previous !== null && r.parentId !== previous;
        previous = r.id;
      }
    } else if (format === "claude") {
      event.parentLine = r.parentUuid
        ? context.latest.get(r.parentUuid) || null
        : null;
      event.branch = Boolean(r.parentUuid && !event.parentLine);
    } else {
      if (
        context.paginated &&
        r.type === "response_item" &&
        event.kind === "user"
      ) {
        event.kind = "context";
        event.label = "Recorded model context (paginated history)";
      }
      const p = r.payload || {};
      if (["task_started", "turn_started"].includes(p.type)) {
        turn++;
        seen = new Map();
      }
      event.turn = turn;
      if (["user", "assistant"].includes(event.kind) && event.text) {
        const key = createHash("sha256")
          .update(JSON.stringify([event.kind, event.text]))
          .digest("hex");
        const group = seen.get(key) || [];
        const counterpart = group.find(
          (other) => !other.streams.has(event.stream),
        );
        if (counterpart) {
          event.mirrorOf = counterpart.line;
          counterpart.streams.add(event.stream);
        } else
          group.push({ line: event.line, streams: new Set([event.stream]) });
        seen.set(key, group);
      }
      if (p.type === "thread_rolled_back" || p.type === "thread_rollback") {
        event.label = "Rollback (earlier records retained)";
        event.text = `Recorded rollback: ${json(p)}`;
      }
    }
    yield event;
  }
}

/**
 * @param {import("./contracts.mjs").SourceRecord[]} records
 * @param {"codex"|"pi"|"claude"} format
 * @returns {import("./contracts.mjs").TraceEvent[]}
 */
export function project(records, format) {
  return [...projectRecords(records, format, projectionContext(records))];
}
