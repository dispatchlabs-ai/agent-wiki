import test from "node:test";
import assert from "node:assert/strict";
import { conversationText } from "../src/conversation-text.mjs";
import { evidenceView } from "../src/evidence-views.mjs";
const path = "/tmp/codex-remote-attachments/example/photo.png";
const marker = `<image name=[Image #1] path="${path}">\n</image>`;
const wrap = (body) =>
  `# Files mentioned by the user:\n\n## photo.png: ${path}\n\n## My request:\n${body}`;
const message = (body) => ({
  role: "user",
  text: wrap(body),
  attachments: [{ name: "photo.png", kind: "image", status: "not_captured" }],
});
test("recognized envelope uses attachment cards while preserving the original", async () => {
  const m = { ...message(`Please inspect this.\n${marker}`), id: "event-1" };
  const before = structuredClone(m);
  assert.equal(conversationText(m, "codex"), "Please inspect this.\n");
  const html = await evidenceView(
    {
      id: "chat-" + "a".repeat(24),
      harness: "codex",
      messages: [m],
      kind: "dialogue",
      total: 1,
      offset: 0,
      limit: 100,
      nextOffset: null,
      previousOffset: null,
    },
    { pages: new Map() },
  );
  assert.match(
    html,
    /<div class="prose typeset typeset-chat"><p>Please inspect this\.<\/p>/,
  );
  assert.match(
    html,
    /Original recorded message<\/summary><pre># Files mentioned/,
  );
  assert.match(html, /&lt;image name=/);
  assert.match(html, /Not included in this capture/);
  assert.deepEqual(m, before);
});
test("ambiguous, missing, partial and unrelated envelopes remain literal", () => {
  const m = message(marker);
  for (const sample of [
    { ...m, role: "assistant" },
    { ...m, attachments: [] },
    { ...m, attachments: [...m.attachments, ...m.attachments] },
    { ...m, text: "Intro\n" + m.text },
    { ...m, text: m.text.replace("## My request:", "## Actual heading:") },
    {
      ...m,
      text: m.text.replace(
        "## My request:",
        "Important information\n## My request:",
      ),
    },
    { ...m, text: "# Real user heading\n" + marker },
  ])
    assert.equal(conversationText(sample, "codex"), sample.text);
  assert.equal(conversationText(m, "pi"), m.text);
});
test("code, escaped markers, unknown paths and nonempty tags are preserved", () => {
  for (const body of [
    "```html\n" + marker + "\n```",
    "`" + marker.replace("\n", "") + "`",
    "    " + marker.replace("\n", ""),
    "\\" + marker,
    marker.replace(path, "/tmp/unknown.png"),
    marker.replace("\n", "caption"),
  ])
    assert.equal(conversationText(message(body), "codex"), body);
});
test("multiple files and CRLF envelopes retain the prompt's Markdown", () => {
  const m = message("# A real heading\n\n    indented code\n" + marker);
  m.text = m.text
    .replace("## My request:", "## notes.md: /tmp/notes.md\n\n## My request:")
    .replaceAll("\n", "\r\n");
  m.attachments.push({
    name: "notes.md",
    kind: "text",
    status: "not_captured",
  });
  assert.equal(
    conversationText(m, "codex"),
    "# A real heading\r\n\r\n    indented code\r\n",
  );
});
