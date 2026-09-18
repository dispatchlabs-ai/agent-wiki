import http from "node:http";
import { WikiError } from "./errors.mjs";

export const MCP_INLINE_BYTES = 1024 * 1024;

// This wrapper is internal, never inferred from untrusted API response fields.
export class McpResourceResult {
  constructor(uri) {
    this.uri = uri;
  }
}

/** Track loopback requests for cancellation, deadlines and shutdown. */
export class McpApiClient {
  constructor(server, origin, { timeout = 0 } = {}) {
    this.server = server;
    this.origin = origin;
    this.timeout = timeout;
    this.pending = new Set();
    this.closed = false;
  }

  /** @param {string} route @param {any} [draft] @param {AbortSignal} [signal] */
  async request(route, draft, signal, identityHeaders = {}) {
    const cancelled = () =>
      new WikiError(
        "MCP_CANCELLED",
        "MCP request cancelled; retry saves with identical input and operation_id.",
        499,
      );
    if (signal?.aborted) throw cancelled();
    if (!route.startsWith("/api/"))
      throw new Error("Invalid internal API route");
    if (this.closed)
      throw new WikiError("MCP_CLOSED", "MCP bridge is closed.", 503);
    const address = this.server.address();
    if (!address || typeof address === "string")
      throw new Error("Wiki is not listening");
    return new Promise((resolve, reject) => {
      let finished = false;
      const upstream = http.request({
        hostname: "127.0.0.1",
        port: address.port,
        path: route,
        method: draft ? "POST" : "GET",
        headers: {
          ...identityHeaders,
          Host: new URL(this.origin).host,
          Origin: this.origin,
          "Content-Type": "application/json",
          "X-Wiki-Write": "1",
        },
      });
      const finish = (error, result) => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        signal?.removeEventListener("abort", abort);
        this.pending.delete(cancel);
        upstream.destroy();
        if (error) reject(error);
        else resolve(result);
      };
      const cancel = () =>
        finish(new WikiError("MCP_CLOSED", "MCP bridge is closed.", 503));
      const abort = () => finish(cancelled());
      this.pending.add(cancel);
      const timer =
        this.timeout > 0
          ? setTimeout(
              () =>
                finish(
                  new WikiError(
                    "MCP_TIMEOUT",
                    "MCP API request timed out; retry saves with identical input and operation_id.",
                    503,
                  ),
                ),
              this.timeout,
            )
          : null;
      upstream.on("error", (error) => finish(error));
      upstream.on("response", (response) => {
        const chunks = [];
        let size = 0;
        const ok = response.statusCode >= 200 && response.statusCode < 300;
        const oversized = () => {
          // Only successful GETs have a safe, repeatable resource URL. Never
          // convert an error or POST into a misleading success/download link.
          if (ok && !draft)
            finish(
              null,
              new McpResourceResult(new URL(route, this.origin).href),
            );
          else
            finish(
              new WikiError(
                "MCP_RESPONSE_TOO_LARGE",
                "API response is too large to inline; retry saves with identical input and operation_id.",
                503,
              ),
            );
        };
        response.on("error", (error) => finish(error));
        if (Number(response.headers["content-length"]) > MCP_INLINE_BYTES) {
          oversized();
          return;
        }
        response.on("data", (chunk) => {
          if (finished) return;
          size += chunk.length;
          if (size > MCP_INLINE_BYTES) return oversized();
          chunks.push(chunk);
        });
        response.on("end", () => {
          if (finished) return;
          try {
            const result = JSON.parse(Buffer.concat(chunks).toString("utf8"));
            if (!ok)
              finish(
                new WikiError(
                  result.code || `HTTP_${response.statusCode}`,
                  result.error || `HTTP ${response.statusCode}`,
                  response.statusCode,
                ),
              );
            else finish(null, result);
          } catch (error) {
            finish(error);
          }
        });
      });
      signal?.addEventListener("abort", abort, { once: true });
      if (signal?.aborted) abort();
      else upstream.end(draft ? JSON.stringify(draft) : undefined);
    });
  }

  close() {
    this.closed = true;
    for (const cancel of this.pending) cancel();
  }
}
