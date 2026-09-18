// Incremental JSONL input. Memory depends on a record, not the snapshot's bytes.
import fs from "node:fs";
import { createHash } from "node:crypto";
import { projectionContext } from "./trace-format.mjs";

export const digest = (bytes) =>
  createHash("sha256").update(bytes).digest("hex");

function parseLine(text, line) {
  if (!text.trim()) return null;
  let value;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error(`Invalid JSON on source line ${line}`);
  }
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error(`Expected object on source line ${line}`);
  return { line, value };
}

export function parseRecords(bytes) {
  return new TextDecoder("utf-8", { fatal: true })
    .decode(bytes)
    .split(/\r?\n/)
    .flatMap((text, index) => parseLine(text, index + 1) || []);
}

/** @returns {import("./contracts.mjs").Harness} */
export function detectFormat(records) {
  const first = records[0]?.value;
  if (first?.type === "session_meta") return "codex";
  if (first?.type === "session") return "pi";
  throw new Error("Expected a Codex session_meta or pi session header");
}

// Consumers must exhaust the iterator before publishing results: the final hash
// verifies every byte, including unselected records and a terminating newline.
/**
 * @typedef {{id: string, bytes: number, records: number, header: any, format: import("./contracts.mjs").Harness}} TraceInspection
 */
/** @param {string} filename
 * @param {{expectedId?: string, summary?: Partial<TraceInspection>, prefixes?: boolean}} options */
export function* readRecords(
  filename,
  { expectedId, summary = {}, prefixes = false } = {},
) {
  const fd = fs.openSync(filename, "r"),
    chunk = Buffer.alloc(64 * 1024);
  const hash = createHash("sha256");
  let fragments = [],
    line = 1,
    bytes = 0,
    records = 0,
    header;
  const decode = (last) => {
    const raw = fragments.length ? Buffer.concat([...fragments, last]) : last;
    fragments = [];
    const text = new TextDecoder("utf-8", {
      fatal: true,
      ignoreBOM: line !== 1,
    }).decode(raw);
    return parseLine(text, line);
  };
  try {
    let size;
    while ((size = fs.readSync(fd, chunk))) {
      bytes += size;
      let at = 0;
      while (at < size) {
        const newline = chunk.indexOf(10, at);
        const end = newline >= 0 && newline < size ? newline : size;
        const part = chunk.subarray(at, end);
        hash.update(part);
        if (end === size) {
          fragments.push(Buffer.from(part));
          break;
        }
        const record = decode(part);
        if (record) {
          header ??= record.value;
          records++;
          yield {
            ...record,
            ...(prefixes ? { prefix: hash.copy().digest("hex") } : {}),
          };
        }
        hash.update(chunk.subarray(end, end + 1));
        line++;
        at = end + 1;
      }
    }
    if (fragments.length) {
      const record = decode(Buffer.alloc(0));
      if (record) {
        header ??= record.value;
        records++;
        yield {
          ...record,
          ...(prefixes ? { prefix: hash.copy().digest("hex") } : {}),
        };
      }
    }
    const id = hash.digest("hex");
    if (expectedId && id !== expectedId)
      throw Error("Trace integrity check failed");
    Object.assign(summary, {
      id,
      bytes,
      records,
      header,
      format: detectFormat(header ? [{ value: header }] : []),
    });
  } finally {
    fs.closeSync(fd);
  }
}

/** @param {string} filename
 * @param {{expectedId?: string, project?: boolean}} options */
export function inspectTrace(filename, { expectedId, project = false } = {}) {
  const summary = /** @type {TraceInspection} */ ({});
  const records = readRecords(filename, { expectedId, summary });
  const context = project ? projectionContext(records) : undefined;
  if (!project)
    for (const _record of records) {
      /* validate the complete input */
    }
  return { ...summary, context };
}
