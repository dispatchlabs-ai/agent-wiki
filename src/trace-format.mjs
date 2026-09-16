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
/**
 * Project source records into dialogue/context annotations without changing values.
 * @param {import("./contracts.mjs").SourceRecord[]} records
 * @returns {import("./contracts.mjs").TraceEvent[]}
 * @param {"codex"|"pi"} format
 */
export function project(records, format) {
  const events = records.map((record) => describe(record, format));
  if (format === "pi") {
    const latest = new Map();
    for (const event of events)
      if (event.value.id) latest.set(event.value.id, event);
    let previous = null;
    for (const event of events) {
      const r = event.value;
      event.superseded = r.id && latest.get(r.id) !== event;
      if (r.id && r.type !== "session" && !event.superseded) {
        event.parentLine = latest.get(r.parentId)?.line || null;
        event.branch = previous !== null && r.parentId !== previous;
        previous = r.id;
      }
    }
  } else {
    const paginated = records.some(
      ({ value }) =>
        value.payload?.history_mode === "paginated" ||
        (value.payload?.type === "item_completed" &&
          ["UserMessage", "AgentMessage", "Reasoning"].includes(
            value.payload?.item?.type,
          )),
    );
    for (const event of events) {
      if (
        paginated &&
        event.value.type === "response_item" &&
        event.kind === "user"
      ) {
        event.kind = "context";
        event.label = "Recorded model context (paginated history)";
      }
    }
    let turn = 0,
      seen = new Map();
    for (const event of events) {
      const p = event.value.payload || {};
      if (["task_started", "turn_started"].includes(p.type)) {
        turn++;
        seen = new Map();
      }
      event.turn = turn;
      if (["user", "assistant"].includes(event.kind) && event.text) {
        const key = `${event.kind}:${event.text}`;
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
  }
  return events;
}
