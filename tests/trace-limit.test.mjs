import test from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";

const cwd = new URL("../", import.meta.url);
const run = (code, value) => {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "wiki-limit-script-"),
  );
  const script = path.join(directory, "check.mjs");
  try {
    fs.writeFileSync(
      script,
      code.replaceAll("'./src/", "'" + new URL("src/", cwd).href),
    );
    return execFileSync(process.execPath, [script], {
      cwd,
      env: { ...process.env, WIKI_TRACE_MAX_BYTES: value },
      encoding: "utf8",
    });
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
};

test("the configured limit applies to import, worker rendering, indexing and source ranges", () => {
  const output = run(
    `
    import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
    import assert from 'node:assert/strict';
    import { importTrace, TraceStore, MAX_TRACE_BYTES, parseRecords } from './src/traces.mjs';
    import { indexTraces } from './src/trace-search.mjs';
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wiki-limit-'));
    const source = path.join(root, 'input.jsonl');
    const bytes = Buffer.from(JSON.stringify({type:'session',id:'synthetic'})+'\\n'+JSON.stringify({type:'message',id:'m1',message:{role:'user',content:[{type:'text',text:'a'.repeat(512)}]}})+'\\n');
    const store = new TraceStore(path.join(root,'archive'));
    try {
      assert.equal(MAX_TRACE_BYTES, 1024);
      fs.writeFileSync(source, bytes);
      const metadata=importTrace(store.root,source);
      assert.equal((await store.read(metadata.id)).total_records,2);
      assert.equal((await store.readLines(metadata.id,1,2)).lines.length,2);
      indexTraces(store.root);
      assert.throws(()=>parseRecords(Buffer.alloc(1025)),/1024 byte limit/);
      fs.writeFileSync(source,Buffer.alloc(1025));
      assert.throws(()=>importTrace(store.root,source),/1024 byte limit/);
      console.log('passed');
    } finally { store.close(); fs.rmSync(root,{recursive:true,force:true}); }
  `,
    "1024",
  );
  assert.match(output, /passed/);
});

test("invalid trace byte limits fail before serving or importing", () => {
  for (const value of ["", "0", "-1", "1.5", "garbage", "536870913"]) {
    const result = spawnSync(
      process.execPath,
      ["--input-type=module", "-e", "await import('./src/traces.mjs')"],
      {
        cwd,
        env: { ...process.env, WIKI_TRACE_MAX_BYTES: value },
        encoding: "utf8",
      },
    );
    assert.notEqual(result.status, 0, value);
    assert.match(result.stderr, /WIKI_TRACE_MAX_BYTES must be an integer/);
  }
});
