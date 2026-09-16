// @ts-check
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { once } from "node:events";
import { pipeline } from "node:stream/promises";
import { Transform } from "node:stream";
import { MAX_TRACE_BYTES, TRACE_PAGE_SIZE } from "./traces.mjs";

// Verify into private temporary storage before preparing any response. The
// verified copy also prevents a second source read from racing a source mutation.
/** @param {string} root @param {import("./contracts.mjs").TraceMetadata} metadata @param {number} start @param {number} end @param {string} directory
 * @returns {Promise<import("./contracts.mjs").SpoolResult|null>} */
export async function spoolTraceLines(root, metadata, start, end, directory) {
  const verified = path.join(directory, "verified.jsonl"),
    output = path.join(directory, "response.json");
  const source = path.join(root, metadata.id, "source.jsonl");
  if ((await fs.promises.stat(source)).size > MAX_TRACE_BYTES)
    throw Error("Trace exceeds 128 MiB");
  let bytes = 0;
  const hash = createHash("sha256");
  await pipeline(
    fs.createReadStream(source),
    new Transform({
      transform(chunk, encoding, callback) {
        bytes += chunk.length;
        if (bytes > MAX_TRACE_BYTES)
          return callback(Error("Trace exceeds 128 MiB"));
        hash.update(chunk);
        callback(null, chunk);
      },
    }),
    fs.createWriteStream(verified, { flags: "wx", mode: 0o600 }),
  );
  if (hash.digest("hex") !== metadata.id)
    throw Error("Trace integrity check failed");
  const out = fs.createWriteStream(output, { flags: "wx", mode: 0o600 });
  let outputError;
  out.on("error", (error) => {
    outputError = error;
  });
  const write = async (text) => {
    if (outputError) throw outputError;
    if (!out.write(text)) await once(out, "drain");
  };
  let line = 1,
    ordinal = 0,
    position = 0,
    lineStart = 0,
    lineLength = 0,
    nonblank = false,
    first = true,
    opened = false;
  let decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
  const consume = async (bytes) => {
    if (!bytes.length) return;
    const text = decoder.decode(bytes, { stream: true });
    lineLength += bytes.length;
    if (/\S/u.test(text)) nonblank = true;
    if (line >= start && line <= end) {
      if (!opened) {
        await write((first ? "" : ",") + `{"line":${line},"raw":"`);
        first = false;
        opened = true;
      }
      await write(JSON.stringify(text).slice(1, -1));
    }
  };
  const finish = async () => {
    if (line >= start && line <= end) {
      if (!opened) {
        await write((first ? "" : ",") + `{"line":${line},"raw":"`);
        first = false;
      }
      await write(JSON.stringify(decoder.decode()).slice(1, -1) + '","value":');
      if (nonblank) {
        // Raw JSON was validated at import and hash-verified above. Stream it
        // directly, avoiding a parsed object and a second giant string.
        let from = lineStart;
        if (line === 1) {
          const fd = await fs.promises.open(verified, "r");
          try {
            const b = Buffer.alloc(3);
            await fd.read(b, 0, 3, 0);
            if (b.equals(Buffer.from([239, 187, 191]))) from += 3;
          } finally {
            await fd.close();
          }
        }
        for await (const chunk of fs.createReadStream(verified, {
          start: from,
          end: lineStart + lineLength - 1,
        }))
          await write(chunk);
      } else await write("null");
      await write(
        ',"url":' +
          JSON.stringify(
            nonblank
              ? `/traces/${metadata.id}/?page=${Math.floor(ordinal / TRACE_PAGE_SIZE) + 1}#line-${line}`
              : null,
          ) +
          "}",
      );
    }
    if (nonblank) ordinal++;
    line++;
    lineLength = 0;
    nonblank = false;
    opened = false;
    decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
  };
  try {
    await write(
      '{"id":' +
        JSON.stringify(metadata.id) +
        ',"format":' +
        JSON.stringify(metadata.format) +
        ',"start":' +
        start +
        ',"lines":[',
    );
    for await (const chunk of fs.createReadStream(verified)) {
      let at = 0;
      for (let i = 0; i < chunk.length; i++)
        if (chunk[i] === 10) {
          await consume(chunk.subarray(at, i));
          await finish();
          lineStart = position + i + 1;
          at = i + 1;
        }
      await consume(chunk.subarray(at));
      position += chunk.length;
    }
    if (lineLength) await finish();
    const total = line - 1;
    await write(
      '],"end":' +
        Math.min(end, total) +
        ',"total_lines":' +
        total +
        ',"nextStart":' +
        (end < total ? end + 1 : "null") +
        "}",
    );
    out.end();
    await once(out, "close");
    if (outputError) throw outputError;
    await fs.promises.unlink(verified);
    if (start > total) return null;
    return {
      transport: "file",
      path: output,
      directory,
      size: (await fs.promises.stat(output)).size,
    };
  } catch (error) {
    out.destroy();
    throw error;
  }
}
