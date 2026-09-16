import { textWindowOptions, textWindow } from "../src/text-window.mjs";
import http from "node:http";
import { once } from "node:events";
export const evidenceId = "chat-" + "a".repeat(24);
export const fileId = "b".repeat(64) + ".bin";
export const imageId = "c".repeat(64) + ".png";
export const pdfId = "d".repeat(64) + ".pdf";
export async function evidenceFixture() {
  const state = {
    delay: 0,
    failure: false,
    offline: false,
    requests: [],
    harness: "claude",
  };
  const files = [
    {
      name: "notes.md",
      status: "available",
      kind: "text",
      url: "/media/" + fileId,
      size: 32,
      preview: "# Captured notes\n\nLiteral <script>bad()</script>",
      preview_truncated: true,
      provenance: "Synthetic fixture",
    },
    {
      name: "diagram.png",
      status: "available",
      kind: "image",
      url: "/media/" + imageId,
      size: 68,
    },
    {
      name: "paper.pdf",
      status: "available",
      kind: "pdf",
      url: "/media/" + pdfId,
      size: 30,
    },
    { name: "missing.docx", status: "not_captured", kind: "file" },
  ];
  const messages = Array.from({ length: 102 }, (_, i) => ({
    id: "event-" + i,
    aliases: i === 101 ? ["old-event"] : [],
    kind: "dialogue",
    role: i % 2 ? "assistant" : "user",
    text:
      i === 0
        ? "Prototype conversation with **source text**."
        : i === 2
          ? '# Files mentioned by the user:\n\n## diagram.png: /tmp/codex-remote-attachments/example/diagram.png\n\n## My request:\n# Please inspect this diagram\n\n<image name=[Image #1] path="/tmp/codex-remote-attachments/example/diagram.png">\n</image>'
          : "Recorded message " + i,
    timestamp: "2026-01-01T10:00:00Z",
    line: i + 1,
    snapshot: "e".repeat(64),
    inherited: i === 0,
    rolled_back: i === 1,
    attachments: i === 0 ? files : i === 2 ? [files[1]] : [],
  }));
  const tool = {
    id: "tool-event",
    aliases: ["old-tool"],
    kind: "tool",
    role: "tool",
    text: "Recorded tool output",
    line: 200,
    timestamp: "2026-01-01T10:01:00Z",
  };
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, "http://fixture.invalid");
    state.requests.push(url.pathname + url.search);
    const json = (status, data) => {
      res.writeHead(status, { "Content-Type": "application/json" });
      res.end(JSON.stringify(data));
    };
    if (state.failure) {
      await new Promise((resolve) => setTimeout(resolve, state.delay));
      return json(503, { error: "restricted source detail" });
    }
    if (state.offline) return json(503, { error: "offline" });
    const route = url.pathname.replace("/v1/", "");
    const hit = {
      id: evidenceId,
      title: "Prototype archive discussion",
      machine: "fixture-host",
      format: "claude",
      start: "2026-01-01T10:00:00Z",
      end: "2026-01-02T12:30:00Z",
      url: "/conversations/" + evidenceId + "/",
      snippet: "A captured prototype decision.",
    };
    if (route === "health") {
      if (state.delay)
        await new Promise((resolve) => setTimeout(resolve, state.delay));
      return json(200, { state: "ready", conversations: 1 });
    }
    if (route === "search") {
      if (state.delay) await new Promise((r) => setTimeout(r, state.delay));
      const included =
        !url.searchParams.get("machine") ||
        url.searchParams.get("machine") === "fixture-host";
      return json(200, {
        indexed: true,
        total: included ? 1 : 0,
        match: "conversation",
        results: included ? [hit] : [],
        nextOffset: null,
      });
    }
    if (route === "catalog")
      return json(200, { total: 1, items: [hit], nextOffset: null });
    if (route === "traces/" + evidenceId) {
      let kind = url.searchParams.get("kind") || "dialogue",
        offset = Number(url.searchParams.get("offset") || 0);
      const event = url.searchParams.get("event");
      const window = textWindowOptions(url.searchParams);
      if (event === "old-tool" || event === "tool-event") kind = "tool";
      if (event === "old-event" || event === "event-101") offset = 100;
      const after = url.searchParams.get("after") || "",
        before = url.searchParams.get("before") || "";
      const limit = Number(url.searchParams.get("limit") || 100);
      const selected = (
        kind === "tool" ? [tool] : kind === "dialogue" ? messages : []
      ).filter(
        (m) =>
          (!after || Date.parse(m.timestamp) >= Date.parse(after)) &&
          (!before || Date.parse(m.timestamp) < Date.parse(before)),
      );

      return json(200, {
        ...hit,
        harness: state.harness,
        thread_id: "fixture-thread",
        parent_thread: "fixture-parent",
        kind,
        offset,
        limit,
        after,
        before,
        total: selected.length,
        nextOffset: offset + limit < selected.length ? offset + limit : null,
        previousOffset: offset > 0 ? Math.max(0, offset - limit) : null,
        counts: { dialogue: 102, tool: 1 },
        messages: (event && window.textOffset !== undefined
          ? selected.filter((m) => m.id === event || m.aliases?.includes(event))
          : selected.slice(offset, offset + limit)
        )
          .map((m) => ({
            ...m,
            attachments: (m.attachments || []).map((f) => {
              const { preview, preview_truncated, ...meta } = f;
              return url.searchParams.get("attachments") === "preview"
                ? f
                : meta;
            }),
          }))
          .map((m) => textWindow(m, window)),
        eventFound: event
          ? ["old-tool", "tool-event", "old-event", "event-101"].includes(event)
          : null,
        related: { siblings: [], relations: [] },
        recovery_notes: ["A source segment is unavailable."],
      });
    }
    if (route.startsWith("attachments/"))
      return json(200, {
        attachment:
          files.find((f) => f.url === "/media/" + route.slice(12)) || null,
      });
    if (route.startsWith("assets/")) {
      const asset = route.slice(7);
      let data = Buffer.from("Captured file bytes for download."),
        type = "application/octet-stream";
      if (asset === imageId) {
        data = Buffer.from(
          "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l1sAAAAASUVORK5CYII=",
          "base64",
        );
        type = "image/png";
      }
      if (asset === pdfId) {
        data = Buffer.from("%PDF-1.4\nSynthetic PDF fixture\n");
        type = "application/pdf";
      }
      if (![fileId, imageId, pdfId].includes(asset))
        return json(404, { error: "missing" });
      const range = req.headers.range?.match(/^bytes=(\d+)-(\d+)$/);
      const start = range ? Number(range[1]) : 0,
        end = range
          ? Math.min(Number(range[2]), data.length - 1)
          : data.length - 1;
      res.writeHead(range ? 206 : 200, {
        "Content-Type": type,
        "Content-Length": end - start + 1,
        "Accept-Ranges": "bytes",
        ...(range
          ? { "Content-Range": `bytes ${start}-${end}/${data.length}` }
          : {}),
      });
      res.end(data.subarray(start, end + 1));
      return;
    }
    json(404, { error: "missing" });
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  return {
    state,
    url: `http://127.0.0.1:${server.address().port}/v1/`,
    close: () => new Promise((r) => server.close(r)),
    files,
  };
}
