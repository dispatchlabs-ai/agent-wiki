import test from "node:test";
import assert from "node:assert/strict";
import { project } from "../src/trace-format.mjs";
import { disclose, disclosureOptions } from "../src/trace-disclosure.mjs";
test("mixed pi records disclose dialogue before tool and thinking blocks", () => {
  const records = [
    {
      line: 1,
      value: {
        type: "message",
        timestamp: "2026-01-01T10:00:00Z",
        message: {
          role: "assistant",
          content: [
            { type: "text", text: "Answer" },
            {
              type: "toolCall",
              name: "exec",
              arguments: { command: "TOOL CONTENT" },
            },
            { type: "thinking", thinking: "RECORDED REASONING" },
          ],
        },
      },
    },
    {
      line: 2,
      value: {
        type: "message",
        timestamp: "2026-01-01T10:01:00Z",
        message: { role: "toolResult", content: "RESULT" },
      },
    },
  ];
  const events = project(records, "pi");
  const get = (q) =>
    disclose(events, "a".repeat(64), disclosureOptions(new URLSearchParams(q)));
  const dialogue = get("");
  assert.equal(dialogue.messages[0].text, "Answer");
  assert.doesNotMatch(
    JSON.stringify(dialogue),
    /TOOL CONTENT|RECORDED REASONING|RESULT|arguments/,
  );
  assert.equal(dialogue.counts.tool, 2);
  assert.match(
    get("kind=tool&after=2026-01-01T10:00:00Z&before=2026-01-01T10:01:00Z")
      .messages[0].text,
    /TOOL CONTENT/,
  );
  assert.equal(
    get("kind=tool&after=2026-01-01T10:01:00Z").messages[0].text,
    "RESULT",
  );
  assert.equal(get("kind=reasoning").messages[0].text, "RECORDED REASONING");
  assert.ok(
    events[0].value.message.content[1].arguments.command === "TOOL CONTENT",
  );
  assert.match(dialogue.messages[0].sourceUrl, /#line-1$/);
});
test("range selection precedes paging and preserves original source coordinates", () => {
  const events = Array.from({ length: 205 }, (_, i) => ({
    line: i + 1,
    value: { secret: "SOURCE" },
    kind: i < 2 ? "context" : "tool",
    text: String(i),
    timestamp: "2026-01-01T10:00:00Z",
  }));
  events.push({ line: 206, value: {}, kind: "tool", text: "undated" });
  const options = disclosureOptions(
    new URLSearchParams("kind=tool&after=2026-01-01T10:00:00Z&page=2"),
  );
  const result = disclose(events, "b".repeat(64), options);
  assert.equal(result.total, 203);
  assert.equal(result.messages[0].line, 103);
  assert.equal(result.nextPage, 3);
  assert.equal(result.undatedCount, 1);
  assert.doesNotMatch(JSON.stringify(result), /SOURCE/);
  for (const q of [
    "after=today",
    "before=2026-01-01T00:00:00",
    "after=2026-01-02T00:00:00Z&before=2026-01-01T00:00:00Z",
  ])
    assert.throws(() => disclosureOptions(new URLSearchParams(q)), /Invalid/);
});

test("recorded numeric pi timestamps remain eligible for time windows", () => {
  const stamp = Date.parse("2026-01-01T10:00:00Z");
  const events = project(
    [
      {
        line: 1,
        value: {
          type: "message",
          message: { role: "user", timestamp: stamp, content: "Question" },
        },
      },
    ],
    "pi",
  );
  const result = disclose(
    events,
    "a".repeat(64),
    disclosureOptions(
      new URLSearchParams(
        "after=2026-01-01T10:00:00Z&before=2026-01-01T10:01:00Z",
      ),
    ),
  );
  assert.equal(result.messages[0].timestamp, stamp);
  assert.equal(result.undatedCount, 0);
});

test("imported event ids select only the requested mixed-record part for optional chunks", () => {
  const events = project(
    [
      {
        line: 5,
        value: {
          type: "message",
          message: {
            role: "assistant",
            content: [
              { type: "text", text: "Answer" },
              { type: "toolCall", name: "first", arguments: "abcdef" },
              { type: "toolCall", name: "second", arguments: "uvwxyz" },
            ],
          },
        },
      },
    ],
    "pi",
  );
  const read = (q) =>
    disclose(events, "a".repeat(64), disclosureOptions(new URLSearchParams(q)));
  const all = read("kind=tool");
  assert.equal(all.messages.length, 2);
  assert.notEqual(all.messages[0].id, all.messages[1].id);
  const id = all.messages[1].id;
  const part = read(`kind=tool&event=${id}&textOffset=3&textLimit=7`);
  assert.equal(part.messages.length, 1);
  assert.equal(part.messages[0].text, all.messages[1].text.slice(3, 10));
  assert.equal(part.messages[0].textWindow.nextTextOffset, 10);
  assert.equal(
    read(`kind=tool&event=${id}`).messages[0].text,
    all.messages[1].text,
  );
  assert.equal(read("event=line-999-part-0&textLimit=5").eventFound, false);
});
