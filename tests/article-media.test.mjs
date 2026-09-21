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
    fs.statSync(path.join(root, "publications", published.asset, "asset"))
      .mode & 0o777,
    0o400,
  );
  const manifestFile = path.join(
    root,
    "publications",
    published.asset,
    "manifest.json",
  );
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

test("publication retries interruptions before and after the atomic rename", async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "article-media-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const sourceFile = path.join(directory, "logo.png");
  fs.writeFileSync(sourceFile, png);
  for (const afterRename of [false, true]) {
    const root = path.join(directory, String(afterRename));
    const realRename = fs.promises.rename;
    fs.promises.rename = async (...args) => {
      if (afterRename) await realRename(...args);
      throw Object.assign(Error("interrupted publication"), { code: "EIO" });
    };
    try {
      await assert.rejects(
        publishArticleMedia({
          root,
          sourceFile,
          source: "fixture",
          now: new Date("2026-09-21T12:00:00Z"),
        }),
        /interrupted/,
      );
    } finally {
      fs.promises.rename = realRename;
    }
    assert.equal(
      fs.readdirSync(root).filter((name) => name.startsWith(".")).length,
      0,
    );
    const recovered = await publishArticleMedia({
      root,
      sourceFile,
      source: "fixture",
      now: new Date("2026-09-22T12:00:00Z"),
    });
    assert.equal(
      recovered.manifest.published_at,
      afterRename ? "2026-09-21T12:00:00.000Z" : "2026-09-22T12:00:00.000Z",
    );
    const opened = await new ArticleMediaStore(root).open(recovered.asset);
    assert.deepEqual(await read(opened.stream), png);
    await opened.close();
  }
});

test("hard-link-free concurrent publishers retain exactly one provenance", async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "article-media-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const sourceFile = path.join(directory, "logo.png");
  const root = path.join(directory, "published");
  fs.writeFileSync(sourceFile, png);
  const realLink = fs.promises.link;
  fs.promises.link = async () => {
    throw Object.assign(Error("unsupported hard link"), { code: "EMLINK" });
  };
  try {
    const outcomes = await Promise.allSettled(
      ["first", "second"].map((source) =>
        publishArticleMedia({ root, sourceFile, source }),
      ),
    );
    assert.equal(outcomes.filter((x) => x.status === "fulfilled").length, 1);
    const winner = outcomes.find((x) => x.status === "fulfilled").value;
    assert.match(
      outcomes.find((x) => x.status === "rejected").reason.message,
      /different publication provenance/,
    );
    const manifest = JSON.parse(
      fs.readFileSync(
        path.join(root, "publications", winner.asset, "manifest.json"),
      ),
    );
    assert.deepEqual(manifest, winner.manifest);
    const repeated = await publishArticleMedia({
      root,
      sourceFile,
      source: winner.manifest.provenance.source,
    });
    assert.deepEqual(repeated.manifest, manifest);
    const opened = await new ArticleMediaStore(root).open(winner.asset);
    assert.deepEqual(await read(opened.stream), png);
    await opened.close();
  } finally {
    fs.promises.link = realLink;
  }
});

test("legacy pairs remain readable and immutable; partial or corrupt layouts fail closed", async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "article-media-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const sourceFile = path.join(directory, "logo.png");
  const root = path.join(directory, "published");
  fs.writeFileSync(sourceFile, png);
  const published = await publishArticleMedia({
    root,
    sourceFile,
    source: "fixture",
  });
  const paired = path.join(root, "publications", published.asset);
  fs.mkdirSync(path.join(root, "assets"));
  fs.mkdirSync(path.join(root, "manifests"));
  const legacyAsset = path.join(root, "assets", published.asset);
  const legacyManifest = path.join(
    root,
    "manifests",
    published.asset + ".json",
  );
  fs.copyFileSync(path.join(paired, "asset"), legacyAsset);
  fs.copyFileSync(path.join(paired, "manifest.json"), legacyManifest);
  fs.rmSync(paired, { recursive: true });
  const opened = await new ArticleMediaStore(root).open(published.asset);
  assert.deepEqual(await read(opened.stream), png);
  await opened.close();
  assert.deepEqual(
    (await publishArticleMedia({ root, sourceFile, source: "fixture" }))
      .manifest,
    published.manifest,
  );
  assert.equal(fs.existsSync(paired), false);
  await assert.rejects(
    publishArticleMedia({ root, sourceFile, source: "different" }),
    /different publication provenance/,
  );
  fs.mkdirSync(paired);
  await assert.rejects(
    publishArticleMedia({ root, sourceFile, source: "fixture" }),
  );
  await assert.rejects(
    new ArticleMediaStore(root).open(published.asset),
    (error) => error.code === "NOT_FOUND",
  );
  assert.deepEqual(fs.readdirSync(paired), []);
  fs.rmdirSync(paired);
  fs.symlinkSync(path.dirname(paired), paired);
  await assert.rejects(
    publishArticleMedia({ root, sourceFile, source: "fixture" }),
    /Invalid publication directory/,
  );
  fs.unlinkSync(paired);
  fs.rmSync(legacyManifest);
  await assert.rejects(
    publishArticleMedia({ root, sourceFile, source: "fixture" }),
    /Incomplete legacy/,
  );
  assert.equal(fs.existsSync(paired), false);
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
  fs.chmodSync(
    path.join(root, "publications", published.asset, "asset"),
    0o600,
  );
  fs.appendFileSync(
    path.join(root, "publications", published.asset, "asset"),
    "changed",
  );
  await assert.rejects(
    new ArticleMediaStore(root).open(published.asset),
    (error) => error.code === "NOT_FOUND",
  );
});
