import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import http from "node:http";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { GitWiki, git } from "../src/git-wiki.mjs";
import { createWiki } from "../src/server.mjs";
import { fixture, update } from "./helpers.mjs";

const editor = fileURLToPath(new URL("../src/editor.mjs", import.meta.url));

function runWriter(t, repo, draft) {
  const input = Buffer.from(JSON.stringify(draft));
  const boundary = input.indexOf(Buffer.from("😀")) + 1;
  assert.ok(boundary > 65536, "the UTF-8 split must follow a large prefix");
  const child = spawn(process.execPath, [editor], {
    env: {
      ...process.env,
      WIKI_REPO: repo,
      WIKI_GIT_LOCKED: "0",
      WIKI_PUSH: "0",
      WIKI_HTTP_WRITE: "0",
      WIKI_CONTROL: "",
      WIKI_SESSION: "",
      WIKI_AGENT_TOKEN: "",
      WIKI_AGENT_AUDIENCE: "",
      WIKI_EVIDENCE_URL: "",
    },
    stdio: ["pipe", "pipe", "pipe"],
  });
  t.after(() => child.kill());
  let out = "";
  let err = "";
  child.stdout.on("data", (chunk) => (out += chunk));
  child.stderr.on("data", (chunk) => (err += chunk));
  child.stdin.on("error", () => {});
  const closed = once(child, "close");

  const write = (chunk) =>
    new Promise((resolve, reject) => {
      child.stdin.write(chunk, (error) => (error ? reject(error) : resolve()));
    });

  return (async () => {
    // Wait until the large prefix has been accepted before continuing. The
    // split leaves the first byte of a UTF-8 character in that prefix and the
    // remaining bytes in later chunks.
    await write(input.subarray(0, boundary));
    await new Promise((resolve) => setImmediate(resolve));
    for (let offset = boundary; offset < input.length; offset += 4093) {
      await write(input.subarray(offset, offset + 4093));
      await new Promise((resolve) => setImmediate(resolve));
    }
    child.stdin.end();
    const [code] = await closed;
    assert.equal(code, 0, err);
    return JSON.parse(out);
  })();
}

test(
  "writer consumes a large, chunked UTF-8 draft from piped stdin",
  { timeout: 15000 },
  async (t) => {
    const repo = fixture(t);
    const draft = {
      operation_id: "chunked-stdin",
      updates: [
        update("large-a", "a".repeat(70000) + "😀" + "b".repeat(1000)),
        update("large-b", "c".repeat(70000)),
      ],
    };
    const receipt = await runWriter(t, repo, draft);
    assert.equal(receipt.state, "saved");
    assert.deepEqual(
      receipt.articles.map(({ id }) => id),
      ["large-a", "large-b"],
    );
    assert.equal(
      new GitWiki(repo).current("large-a").body,
      draft.updates[0].body,
    );
    assert.equal(git(repo, ["status", "--porcelain"]), "");
  },
);

test(
  "HTTP writer saves and exactly retries a large coordinated batch",
  { timeout: 15000 },
  async (t) => {
    const repo = fixture(t);
    const app = createWiki({
      repo,
      origin: "http://wiki.test",
      write: true,
    });
    app.listen(0, "127.0.0.1");
    await once(app, "listening");
    t.after(
      () =>
        new Promise((resolve) => {
          app.close(resolve);
          app.closeAllConnections();
        }),
    );

    const draft = {
      operation_id: "large-http-batch",
      updates: Array.from({ length: 4 }, (_, index) =>
        update(`large-http-${index}`, String(index).repeat(90000)),
      ),
    };
    const save = () =>
      new Promise((resolve, reject) => {
        const req = http.request(
          `http://127.0.0.1:${app.address().port}/api/articles/edits`,
          {
            method: "POST",
            headers: {
              Host: "wiki.test",
              Origin: "http://wiki.test",
              "X-Wiki-Write": "1",
              "Content-Type": "application/json",
            },
          },
          (res) => {
            const chunks = [];
            res.on("data", (chunk) => chunks.push(chunk));
            res.on("end", () =>
              resolve({
                status: res.statusCode,
                body: JSON.parse(Buffer.concat(chunks).toString("utf8")),
              }),
            );
          },
        );
        req.on("error", reject);
        req.end(JSON.stringify(draft));
      });

    const first = await save();
    assert.equal(first.status, 200, JSON.stringify(first.body));
    assert.equal(first.body.state, "saved");
    assert.equal(first.body.articles.length, 4);
    const retry = await save();
    assert.equal(retry.status, 200, JSON.stringify(retry.body));
    assert.equal(retry.body.state, "already-saved");
    assert.equal(retry.body.commit, first.body.commit);
    assert.deepEqual(retry.body.articles, first.body.articles);
    for (const article of first.body.articles)
      assert.equal(new GitWiki(repo).history(article.id).length, 1);
    assert.equal(new GitWiki(repo).head, first.body.commit);
    assert.equal(git(repo, ["status", "--porcelain"]), "");
  },
);
