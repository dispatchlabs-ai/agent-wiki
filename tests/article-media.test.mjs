import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  ArticleMediaStore,
  publishArticleMedia,
} from "../src/article-media.mjs";

const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);
const read = async (stream) => {
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  return Buffer.concat(chunks);
};

test("operator publication creates immutable hashed media and provenance", async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "article-media-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const sourceFile = path.join(directory, "logo.png");
  const root = path.join(directory, "published");
  fs.writeFileSync(sourceFile, png);
  const published = await publishArticleMedia({
    root,
    sourceFile,
    source: "brand-guide:logo",
    sourceUrl: "https://example.org/brand/logo",
    sourceDate: "2026-09-20",
    now: new Date("2026-09-21T12:00:00Z"),
  });
  assert.match(published.asset, /^[a-f0-9]{64}\.png$/);
  assert.equal(published.url, `/article-media/${published.asset}`);
  assert.equal(published.manifest.provenance.source, "brand-guide:logo");
  assert.equal(
    fs.statSync(path.join(root, "assets", published.asset)).mode & 0o777,
    0o400,
  );
  const manifestFile = path.join(root, "manifests", published.asset + ".json");
  const originalManifest = fs.readFileSync(manifestFile, "utf8");

  const repeated = await publishArticleMedia({
    root,
    sourceFile,
    source: "brand-guide:logo",
    sourceUrl: "https://example.org/brand/logo",
    sourceDate: "2026-09-20",
    now: new Date("2026-09-22T12:00:00Z"),
  });
  assert.equal(repeated.asset, published.asset);
  assert.equal(fs.readFileSync(manifestFile, "utf8"), originalManifest);
  await assert.rejects(
    publishArticleMedia({
      root,
      sourceFile,
      source: "different-source",
    }),
    /different publication provenance/,
  );

  const store = new ArticleMediaStore(root);
  const opened = await store.open(published.asset, "bytes=1-4");
  assert.equal(opened.status, 206);
  assert.equal(opened.headers["Content-Type"], "image/png");
  assert.deepEqual(await read(opened.stream), png.subarray(1, 5));
  await opened.close();
  assert.equal(
    ArticleMediaStore.asset("/article-media/../../secret.pdf"),
    null,
  );
  assert.equal(ArticleMediaStore.asset(`/media/${published.asset}`), null);
});

test("an interruption between atomic asset and manifest installs is retryable", async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "article-media-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const sourceFile = path.join(directory, "logo.png");
  const root = path.join(directory, "published");
  fs.writeFileSync(sourceFile, png);
  const realLink = fs.promises.link;
  let links = 0;
  fs.promises.link = async (...arguments_) => {
    links += 1;
    if (links === 2) {
      const error = Error("interrupted before manifest install");
      error.code = "EIO";
      throw error;
    }
    return realLink(...arguments_);
  };
  try {
    await assert.rejects(
      publishArticleMedia({
        root,
        sourceFile,
        source: "brand-guide:logo",
        now: new Date("2026-09-21T12:00:00Z"),
      }),
      /interrupted/,
    );
  } finally {
    fs.promises.link = realLink;
  }
  assert.equal(
    fs.readdirSync(root).filter((name) => name.startsWith(".")).length,
    0,
  );
  const recovered = await publishArticleMedia({
    root,
    sourceFile,
    source: "brand-guide:logo",
    now: new Date("2026-09-21T12:00:00Z"),
  });
  const opened = await new ArticleMediaStore(root).open(recovered.asset);
  assert.deepEqual(await read(opened.stream), png);
  await opened.close();
});

test("publication rejects disguised files and serving rejects changed bytes", async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "article-media-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const sourceFile = path.join(directory, "image.png");
  const root = path.join(directory, "published");
  fs.writeFileSync(sourceFile, "<html>not an image</html>");
  await assert.rejects(
    publishArticleMedia({ root, sourceFile, source: "fixture" }),
    /do not match/,
  );
  fs.writeFileSync(sourceFile, png);
  const published = await publishArticleMedia({
    root,
    sourceFile,
    source: "fixture",
  });
  fs.chmodSync(path.join(root, "assets", published.asset), 0o600);
  fs.appendFileSync(path.join(root, "assets", published.asset), "changed");
  await assert.rejects(
    new ArticleMediaStore(root).open(published.asset),
    (error) => error.code === "NOT_FOUND",
  );
});
