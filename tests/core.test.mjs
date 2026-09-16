import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  GitWiki,
  git,
  markdown,
  parsePage,
  commitFiles,
} from "../src/git-wiki.mjs";
import { saveGitEdits } from "../src/editor.mjs";
import { WikiSearch } from "../src/wiki-search.mjs";
import { renderMarkdown } from "../src/render.mjs";
import { references } from "../src/wiki.mjs";
import { sections } from "../src/markdown-structure.mjs";
import { fixture, commit, update } from "./helpers.mjs";
test("coordinated edits, receipts, conflicts and original metadata survive", (t) => {
  const repo = fixture(t),
    draft = {
      operation_id: "first",
      updates: [
        update("parent", "See [[child]]."),
        update("child", "See [[parent]]."),
      ],
    };
  const saved = saveGitEdits(repo, draft);
  assert.equal(git(repo, ["status", "--porcelain"]), "");
  assert.equal(saveGitEdits(repo, draft).state, "already-saved");
  assert.equal(git(repo, ["rev-parse", "HEAD"]), saved.commit);
  assert.throws(
    () => saveGitEdits(repo, { ...draft, updates: [update("other")] }),
    /identity/,
  );
  assert.throws(
    () =>
      saveGitEdits(repo, {
        operation_id: "stale",
        updates: [update("parent")],
      }),
    /Conflict/,
  );
  const wiki = new GitWiki(repo),
    original = wiki.current("guide");
  saveGitEdits(repo, {
    operation_id: "guide-edit",
    updates: [
      {
        ...update("guide", "Changed."),
        expected_revision_id: original.revision_id,
      },
    ],
  });
  wiki.refresh();
  assert.deepEqual(wiki.current("guide").custom, { preserved: true });
  assert.equal(wiki.current("guide").sources[0].title, "Source");
  assert.equal(wiki.revision("guide", 1).body, "Start here.\n");
  assert.equal(
    wiki.revision("guide", wiki.current("guide").commit).body,
    "Changed.",
  );
});
test("dirty files and invalid linked batches cannot be committed", (t) => {
  const repo = fixture(t),
    before = git(repo, ["rev-parse", "HEAD"]),
    wiki = new GitWiki(repo);
  assert.throws(
    () =>
      saveGitEdits(repo, {
        operation_id: "broken",
        updates: [update("bad", "[[missing]]")],
      }),
    /Broken/,
  );
  assert.equal(git(repo, ["rev-parse", "HEAD"]), before);
  fs.appendFileSync(path.join(repo, "wiki/guide.md"), "Uncommitted text.");
  assert.equal(wiki.refresh(), false);
  assert.doesNotMatch(wiki.current("guide").body, /Uncommitted/);
  assert.throws(
    () =>
      saveGitEdits(repo, { operation_id: "dirty", updates: [update("new")] }),
    /Working tree/,
  );
  assert.match(
    fs.readFileSync(path.join(repo, "wiki/guide.md"), "utf8"),
    /Uncommitted/,
  );
});
test("invalid committed trees leave the last valid reader snapshot intact", (t) => {
  const repo = fixture(t),
    wiki = new GitWiki(repo),
    before = wiki.head;
  fs.appendFileSync(path.join(repo, "wiki/guide.md"), "[[missing]]");
  commit(repo, "Invalid link");
  assert.throws(() => wiki.refresh(), /Broken/);
  assert.equal(wiki.head, before);
  assert.equal(wiki.current("guide").body, "Start here.\n");
  fs.writeFileSync(
    path.join(repo, "wiki/guide.md"),
    markdown({ title: "Fixed", description: "Fixed article" }, "Recovered."),
  );
  commit(repo, "Repair");
  assert.equal(wiki.refresh(), true);
  assert.equal(wiki.current("guide").body, "Recovered.");
});
test("history follows stable basenames through directory moves and first-parent merges", (t) => {
  const repo = fixture(t);
  fs.mkdirSync(path.join(repo, "wiki/guides"));
  git(repo, ["mv", "wiki/guide.md", "wiki/guides/guide.md"]);
  commit(repo, "Move");
  git(repo, ["switch", "-c", "addition"]);
  fs.writeFileSync(
    path.join(repo, "wiki/added.md"),
    markdown(
      { title: "Added", description: "Merged article" },
      "From a branch.",
    ),
  );
  commit(repo, "Branch article");
  git(repo, ["switch", "main"]);
  git(repo, ["merge", "--no-ff", "addition", "-m", "Merge article"]);
  const wiki = new GitWiki(repo);
  assert.equal(wiki.history("guide").length, 2);
  assert.equal(wiki.revision("guide", 1).body, "Start here.\n");
  assert.equal(wiki.current("added").number, 1);
});
test("compare-and-swap refuses an outdated commit even with a clean checkout", (t) => {
  const repo = fixture(t),
    head = git(repo, ["rev-parse", "HEAD"]);
  git(repo, ["commit", "--allow-empty", "-m", "Concurrent change"]);
  const current = git(repo, ["rev-parse", "HEAD"]);
  assert.throws(() =>
    commitFiles(
      repo,
      head,
      { "wiki/new.md": markdown({ title: "New", description: "New" }, "New") },
      "Stale write",
    ),
  );
  assert.equal(git(repo, ["rev-parse", "HEAD"]), current);
  assert.equal(fs.existsSync(path.join(repo, "wiki/new.md")), false);
});
test("only data frontmatter and safe regular Markdown paths are accepted", (t) => {
  const repo = fixture(t);
  assert.throws(
    () =>
      parsePage(
        '---javascript\n(globalThis.wikiExecuted = true, {title:"X",description:"X"})\n---\nBody',
        "wiki/x.md",
        "x",
      ),
    /frontmatter/,
  );
  assert.equal(globalThis.wikiExecuted, undefined);
  assert.throws(
    () =>
      parsePage(
        "---\ntitle: Cycle\ndescription: Test\ncustom: &ref {self: *ref}\n---\nBody",
        "wiki/cycle.md",
        "x",
      ),
    /circular/,
  );
  assert.throws(() =>
    parsePage(
      "---\ntitle: !!js/function >\n  function(){}\ndescription: x\n---\nBody",
      "wiki/x.md",
      "x",
    ),
  );
  fs.symlinkSync("/etc/passwd", path.join(repo, "wiki/link.md"));
  commit(repo, "Invalid symlink");
  assert.throws(() => new GitWiki(repo), /regular/);
});
test("sanitized rendering, heading anchors and link discovery agree", async () => {
  const body =
    "## A heading\nSee [[guide|The guide]].\n\n## A heading\n\n`[[code-only]]`\n\n<script>alert(1)</script>\n\n[bad](javascript:alert%281%29)\n\n<img src=x onerror=alert(1)>";
  const html = await renderMarkdown(body);
  assert.doesNotMatch(html, /<script|<[^>]+\bonerror=|href="javascript:/);
  assert.match(html, /href="\/wiki\/guide\/"/);
  assert.deepEqual(references(body), ["guide"]);
  for (const s of sections(body).filter((s) => s.anchor))
    assert.ok(html.includes(`id="${s.anchor}"`));
});
test("disk search indexes only changed blobs, deletes stale passages and rebuilds", (t) => {
  const repo = fixture(t),
    db = path.join(repo, ".git", "search.sqlite3"),
    index = new WikiSearch(db);
  t.after(() => index.close());
  const wiki = new GitWiki(repo);
  assert.equal(index.sync(wiki).changed, 1);
  assert.equal(index.sync(wiki).changed, 0);
  saveGitEdits(repo, {
    operation_id: "search",
    updates: [
      update(
        "sensor",
        "## Monitoring\nGreenhouse humidity sensor. See [[guide]].",
      ),
    ],
  });
  wiki.refresh();
  assert.equal(index.sync(wiki).changed, 1);
  assert.equal(index.search("humid").articles[0].id, "sensor");
  assert.equal(
    index.search('"Greenhouse humidity"').articles[0].anchor,
    "section-monitoring",
  );
  assert.equal(index.backlinks("guide")[0].id, "sensor");
  assert.throws(() => index.search("x", { limit: 0 }), /Invalid/);
  assert.doesNotThrow(() => index.search('" OR DROP TABLE pages; --'));
  git(repo, ["rm", "wiki/sensor.md"]);
  commit(repo, "Delete sensor");
  wiki.refresh();
  assert.equal(index.sync(wiki).deleted, 1);
  assert.equal(index.search("humid").articles.length, 0);
  assert.deepEqual(index.backlinks("guide"), []);
  const rebuilt = new WikiSearch(":memory:");
  t.after(() => rebuilt.close());
  assert.equal(rebuilt.sync(wiki).changed, 1);
  assert.equal(rebuilt.search("Start").articles[0].id, "guide");
});

test("article catalog links save and refresh without becoming article references", (t) => {
  const repo = fixture(t);
  const body =
    "[All articles](/wiki/) [Filter](/wiki/?q=guide) [Top](/wiki/#top) [Guide](/wiki/guide/#section-start) [History](/wiki/guide/history/)";
  assert.deepEqual(references(body), ["guide"]);
  saveGitEdits(repo, {
    operation_id: "catalog-link",
    updates: [update("navigation", body)],
  });
  const wiki = new GitWiki(repo);
  assert.equal(wiki.current("navigation").body.trim(), body);
  fs.writeFileSync(
    path.join(repo, "wiki/direct.md"),
    markdown({ title: "Direct", description: "Direct Git edit" }, body),
  );
  commit(repo, "Link directly to article catalog");
  assert.equal(wiki.refresh(), true);
  assert.equal(wiki.current("direct").body.trim(), body);
  assert.throws(
    () =>
      saveGitEdits(repo, {
        operation_id: "missing-link",
        updates: [update("broken", "[Missing](/wiki/missing/#section)")],
      }),
    /Broken/,
  );
});

test("colliding heading suffixes stay unique in HTML and rebuilt search indexes", async (t) => {
  const repo = fixture(t),
    filename = path.join(repo, ".git", "anchors.sqlite3");
  const body =
    "## Status\nFirst\n\n## Status\nSecond\n\n## Status-1\nNeedlethird\n\n## Status\nFourth\n\n## Status-1-1\nFifth";
  const html = await renderMarkdown(body);
  const ids = [...html.matchAll(/id="([^"]+)"/g)].map((match) => match[1]);
  assert.equal(new Set(ids).size, 5);
  assert.deepEqual(
    sections(body)
      .filter((section) => section.anchor)
      .map((section) => section.anchor),
    ids,
  );
  saveGitEdits(repo, {
    operation_id: "heading-collisions",
    updates: [update("headings", body)],
  });
  const wiki = new GitWiki(repo),
    old = new WikiSearch(filename);
  try {
    old.sync(wiki);
    old.db
      .prepare("UPDATE meta SET value=? WHERE key='schema'")
      .run("markdown-sections-v2");
    old.db.exec("UPDATE passages SET anchor='stale-anchor'");
  } finally {
    old.close();
  }
  const index = new WikiSearch(filename);
  t.after(() => index.close());
  assert.equal(index.sync(wiki).changed, 2);
  assert.equal(index.search("Needlethird").articles[0].anchor, ids[2]);
});

test("reference-style links agree with rendering, validation and backlinks", async (t) => {
  const repo = fixture(t);
  const body =
    "[Guide][Target] and [guide][] and [guide].\n\n[Target]: /wiki/guide/#section-start\n[guide]: /wiki/guide/\n\n`[[ignored]]`\n\n| Link |\n| --- |\n| [[guide]] |";
  assert.deepEqual(references(body), ["guide"]);
  assert.match(
    await renderMarkdown(body),
    /href="\/wiki\/guide\/#section-start"/,
  );
  saveGitEdits(repo, {
    operation_id: "references",
    updates: [update("linked", body)],
  });
  const index = new WikiSearch(":memory:");
  t.after(() => index.close());
  index.sync(new GitWiki(repo));
  assert.equal(index.backlinks("guide")[0].id, "linked");
  assert.throws(
    () =>
      saveGitEdits(repo, {
        operation_id: "missing-reference",
        updates: [
          update("broken", "[Missing][target]\n\n[target]: /wiki/missing/"),
        ],
      }),
    /Broken article link/,
  );
});
