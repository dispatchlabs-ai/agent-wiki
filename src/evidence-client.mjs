import { textWindowOptions } from "./text-window.mjs";
import { WikiError } from "./errors.mjs";

// Operator-selected read-only service. No content URL can select an upstream host.
export class EvidenceClient {
  constructor(base) {
    this.base = new URL(base.endsWith("/") ? base : base + "/");
    if (
      !["http:", "https:"].includes(this.base.protocol) ||
      this.base.username ||
      this.base.password ||
      this.base.search ||
      this.base.hash
    )
      throw Error("Invalid evidence service URL");
  }
  async response(route, params = {}, headers = {}, timeout = 120000) {
    const url = new URL(route, this.base);
    for (const [key, value] of Object.entries(params))
      if (value !== undefined && value !== null && value !== "")
        url.searchParams.set(key, String(value));
    try {
      return await fetch(url, {
        headers,
        redirect: "error",
        signal: AbortSignal.timeout(timeout),
      });
    } catch {
      throw new WikiError(
        "EVIDENCE_UNAVAILABLE",
        "The evidence service is temporarily unavailable.",
        503,
      );
    }
  }
  async json(route, params = {}, timeout = 120000) {
    const response = await this.response(route, params, {}, timeout);
    if (!response.ok)
      throw new WikiError(
        response.status === 404 ? "NOT_FOUND" : "EVIDENCE_UNAVAILABLE",
        response.status === 404
          ? "This archived item is unavailable."
          : response.status === 400
            ? "Invalid evidence query or page."
            : "The evidence service is temporarily unavailable.",
        [400, 404].includes(response.status) ? response.status : 503,
      );
    try {
      return await response.json();
    } catch {
      throw new WikiError(
        "EVIDENCE_UNAVAILABLE",
        "Invalid evidence service response.",
        503,
      );
    }
  }
  validateQuery(q, options) {
    if (
      typeof q !== "string" ||
      q.length > 300 ||
      !Number.isSafeInteger(Number(options.offset ?? 0)) ||
      Number(options.offset ?? 0) < 0 ||
      Number(options.offset ?? 0) > 1000000 ||
      !Number.isSafeInteger(Number(options.limit ?? 20)) ||
      Number(options.limit ?? 20) < 1 ||
      Number(options.limit ?? 20) > 100 ||
      String(options.machine || "").length > 100 ||
      !["", "codex", "pi", "claude"].includes(
        options.format || options.harness || "",
      )
    )
      throw new WikiError(
        "INVALID_SEARCH",
        "Invalid evidence search parameters.",
      );
  }
  async search(q, options = {}) {
    this.validateQuery(q, options);
    const result = await this.json(
      "search",
      { q, ...options, harness: options.format || options.harness },
      15000,
    );
    if (!Array.isArray(result.results))
      throw new WikiError(
        "EVIDENCE_UNAVAILABLE",
        "Invalid evidence search response.",
        503,
      );
    return result;
  }
  catalog(params = {}) {
    this.validateQuery(params.q || "", params);
    return this.json(
      "catalog",
      { ...params, harness: params.format || params.harness },
      15000,
    );
  }
  /** @param {string} id @param {Record<string, any>} [params] */
  read(id, params = {}) {
    const { page, ...query } = params;
    const limit = Number(query.limit ?? 100);
    const offset = Number(query.offset ?? 0);
    if (
      !/^chat-[a-f0-9]{24}$/.test(id) ||
      ![
        "dialogue",
        "tool",
        "thinking",
        "reasoning",
        "context",
        "analysis",
      ].includes(query.kind || "dialogue") ||
      !Number.isSafeInteger(limit) ||
      limit < 1 ||
      limit > 100 ||
      !Number.isSafeInteger(offset) ||
      offset < 0 ||
      offset > 1000000 ||
      String(query.event || "").length > 300 ||
      Object.keys(query).some(
        (k) =>
          ![
            "kind",
            "offset",
            "limit",
            "event",
            "after",
            "before",
            "attachments",
            "textOffset",
            "textLimit",
          ].includes(k),
      )
    )
      throw new WikiError("INVALID_TRACE_PAGE", "Invalid evidence page");
    try {
      const window = textWindowOptions(new URLSearchParams(query));
      if (query.kind === "analysis" && window.textOffset !== undefined)
        throw Error("Aggregate analysis is not an event text window");
    } catch (error) {
      throw new WikiError("INVALID_TRACE_PAGE", error.message);
    }
    const validTime = (v) =>
      !v ||
      (typeof v === "string" &&
        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(
          v,
        ) &&
        Number.isFinite(Date.parse(v)) &&
        new Date(v.slice(0, 10) + "T00:00:00Z")
          .toISOString()
          .startsWith(v.slice(0, 10)));
    if (
      (query.kind === "analysis" && (query.after || query.before)) ||
      !validTime(query.after) ||
      !validTime(query.before) ||
      (query.after &&
        query.before &&
        Date.parse(query.after) >= Date.parse(query.before)) ||
      !["metadata", "preview"].includes(query.attachments || "metadata")
    )
      throw new WikiError(
        "INVALID_TRACE_PAGE",
        "Invalid evidence range or attachments",
      );
    if (page !== undefined) {
      const number = Number(page),
        position = (number - 1) * limit;
      if (
        !Number.isSafeInteger(number) ||
        number < 1 ||
        position > 1000000 ||
        (query.offset !== undefined && offset !== position)
      )
        throw new WikiError(
          "INVALID_TRACE_PAGE",
          "Page and offset must identify the same evidence page",
        );
      query.offset = position;
    }
    return this.json("traces/" + encodeURIComponent(id), query);
  }
  attachment(asset) {
    return this.json("attachments/" + encodeURIComponent(asset));
  }
  async health() {
    const results = await Promise.allSettled([
      this.json("health", {}, 5000),
      this.search("", { limit: 1 }),
    ]);
    const state = (r) =>
      r.status === "fulfilled"
        ? { state: "ready" }
        : { state: "degraded", error: r.reason.message };
    return { traceArchive: state(results[0]), traceSearch: state(results[1]) };
  }
}
