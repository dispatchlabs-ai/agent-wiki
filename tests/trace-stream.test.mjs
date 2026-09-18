import test from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  readRecords,
  inspectTrace,
  parseRecords,
  digest,
} from "../src/trace-source.mjs";
import { importTrace } from "../src/traces.mjs";

test("incremental input preserves bytes, physical lines, UTF-8 boundaries and prefix identities", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "wiki-stream-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const source = path.join(root, "source.jsonl");
  const bytes = Buffer.from(
    '\uFEFF{"type":"session","id":"synthetic"}\r\n\r\n' +
      JSON.stringify({
        type: "context",
        data: "x".repeat(65500) + "🙂".repeat(20000),
      }) +
      '\r\n{"type":"context"}',
  );
  fs.writeFileSync(source, bytes);
  assert.deepEqual([...readRecords(source)], parseRecords(bytes));
  const inspected = inspectTrace(source);
  assert.equal(inspected.id, digest(bytes));
  assert.equal(inspected.bytes, bytes.length);
  assert.equal(inspected.records, 3);
  for (const record of readRecords(source, { prefixes: true })) {
    const prefix = bytes.subarray(
      0,
      record.line === 4 ? bytes.length : bytes.indexOf(10),
    );
    if (record.line === 1 || record.line === 4)
      assert.equal(record.prefix, digest(prefix));
  }
  fs.appendFileSync(source, '\n{"type":');
  assert.throws(
    () => importTrace(path.join(root, "archive"), source),
    /Invalid JSON on source line 5/,
  );
  assert.deepEqual(fs.readdirSync(path.join(root, "archive")), []);
  fs.writeFileSync(source, Buffer.concat([bytes, Buffer.from([10, 0xff])]));
  assert.throws(() => inspectTrace(source), /encoded data was not valid/);
});

test(
  "snapshots above the former maximum import, index and read with a smaller heap",
  { timeout: 120000 },
  () => {
    const directory = fs.mkdtempSync(
      path.join(os.tmpdir(), "wiki-large-trace-"),
    );
    const script = path.join(directory, "check.mjs");
    try {
      fs.writeFileSync(
        script,
        `
      import fs from 'node:fs'; import path from 'node:path'; import assert from 'node:assert/strict';
      import { importTrace, TraceStore } from '${new URL("../src/traces.mjs", import.meta.url)}';
      import { indexTraces, searchTraces } from '${new URL("../src/trace-search.mjs", import.meta.url)}';
      const root = ${JSON.stringify(directory)}, source = path.join(root, 'input.jsonl');
      const fd = fs.openSync(source, 'wx');
      fs.writeSync(fd, JSON.stringify({type:'session_meta',payload:{id:'synthetic-large'}})+'\\n');
      fs.writeSync(fd, JSON.stringify({type:'event_msg',payload:{type:'user_message',message:'firstmarker'}})+'\\n');
      const record = Buffer.from(JSON.stringify({type:'context',data:'x'.repeat(8192)})+'\\n');
      for(let i=0;i<66000;i++) fs.writeSync(fd,record);
      fs.writeSync(fd, JSON.stringify({type:'event_msg',payload:{type:'agent_message',message:'lastmarker'}})+'\\n');
      fs.closeSync(fd);
      assert.ok(fs.statSync(source).size > 536870912);
      const store = new TraceStore(path.join(root,'archive'));
      try {
        const m = importTrace(store.root,source);
        assert.equal(m.records,66003);
        assert.equal(m.bytes,fs.statSync(source).size);
        assert.equal(importTrace(store.root,source).id,m.id);
        assert.equal(indexTraces(store.root).added,1);
        assert.equal(searchTraces(store.root,'lastmarker').results[0].line,66003);
        assert.equal((await store.read(m.id,1)).records[1].text,'firstmarker');
        assert.equal((await store.read(m.id,661)).records.at(-1).text,'lastmarker');
        const disclosed=await store.readDisclosure(m.id,{kind:'dialogue',page:1,after:'',before:''});
        assert.equal(disclosed.total,2);
        assert.equal(disclosed.messages[1].text,'lastmarker');
        const lines = await store.readLines(m.id,66003,66003);
        assert.equal(lines.lines[0].value.payload.message,'lastmarker');
        assert.equal(lines.total_lines,66003);
        console.log(JSON.stringify({bytes:m.bytes,records:m.records}));
      } finally { store.close(); }
    `,
      );
      const output = execFileSync(
        process.execPath,
        ["--max-old-space-size=128", script],
        {
          encoding: "utf8",
          timeout: 115000,
          env: { ...process.env, WIKI_TRACE_MAX_BYTES: "1" },
        },
      );
      assert.equal(JSON.parse(output.trim()).records, 66003);
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  },
);
