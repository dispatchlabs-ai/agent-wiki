import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";

// Called by a small user-owned ~/.pi/agent/extensions/wiki.ts entry point.
export default function wikiExtension(pi, { command, args }) {
  let client;
  let instructions = "";
  pi.on("session_start", async (_event, ctx) => {
    try {
      client = new Client({ name: "agent-wiki-pi", version: "1" });
      await client.connect(
        new StdioClientTransport({ command, args, stderr: "pipe" }),
      );
      instructions = client.getInstructions() || "";
      const { tools } = await client.listTools();
      for (const tool of tools) {
        pi.registerTool({
          name: tool.name.replaceAll(".", "_"),
          label: tool.name,
          description: tool.description,
          parameters: tool.inputSchema,
          async execute(_id, params, signal) {
            if (!client)
              throw Error(
                "Wiki connection is unavailable; reload the extension.",
              );
            const result = await client.callTool(
              { name: tool.name, arguments: params },
              { signal },
            );
            const content = result.content.map((item) =>
              item.type === "text" || item.type === "image"
                ? item
                : { type: "text", text: JSON.stringify(item) },
            );
            if (result.isError)
              throw Error(
                content
                  .filter((item) => item.type === "text")
                  .map((item) => item.text)
                  .join("\n") || "Wiki tool failed",
              );
            return { content, details: {} };
          },
        });
      }
    } catch {
      await client?.close().catch(() => {});
      client = undefined;
      instructions = "";
      ctx.ui.notify(
        "Wiki connection failed. Check its registration, credentials and endpoint, then /reload.",
        "error",
      );
    }
  });
  pi.on("before_agent_start", async (event) => {
    if (instructions)
      return { systemPrompt: event.systemPrompt + "\n\n" + instructions };
  });
  pi.on("session_shutdown", async () => {
    const closing = client;
    client = undefined;
    instructions = "";
    await closing?.close();
  });
}
