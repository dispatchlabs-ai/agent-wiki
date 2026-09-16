import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { performance } from "node:perf_hooks";
import { sections } from "./markdown-structure.mjs";
import { references } from "./wiki.mjs";

const SCHEMA = "markdown-sections-v4";
export class WikiSearch {
  constructor(filename) {
    if (filename !== ":memory:")
      fs.mkdirSync(path.dirname(filename), { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(filename);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=3000;
      CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY, value TEXT);
      CREATE TABLE IF NOT EXISTS pages(id TEXT PRIMARY KEY, blob TEXT, title TEXT, description TEXT, topic TEXT);
      CREATE TABLE IF NOT EXISTS links(source TEXT, target TEXT, PRIMARY KEY(source,target));
      CREATE INDEX IF NOT EXISTS incoming ON links(target);
      CREATE TABLE IF NOT EXISTS passage_map(article TEXT, passage INTEGER PRIMARY KEY);
      CREATE INDEX IF NOT EXISTS article_passages ON passage_map(article);
      CREATE VIRTUAL TABLE IF NOT EXISTS passages USING fts5(article UNINDEXED, anchor UNINDEXED, states UNINDEXED, title, aliases, heading, body, tokenize='unicode61', prefix='2 3 4');`);
    if (
      this.db.prepare("SELECT value FROM meta WHERE key='schema'").get()
        ?.value !== SCHEMA
    ) {
      this.db.exec(
        "DELETE FROM pages; DELETE FROM passages; DELETE FROM passage_map; DELETE FROM links; DELETE FROM meta;",
      );
      this.db.prepare("INSERT INTO meta VALUES('schema',?)").run(SCHEMA);
    }
  }
  sync(wiki) {
    const started = performance.now();
    if (
      this.db.prepare("SELECT value FROM meta WHERE key='commit'").get()
        ?.value === wiki.head
    )
      return { changed: 0, deleted: 0, milliseconds: 0 };
    const prior = new Map(
      this.db
        .prepare("SELECT id,blob FROM pages")
        .all()
        .map((p) => [p.id, p.blob]),
    );
    let changed = 0,
      deleted = 0;
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const remove = (id) => {
        this.db
          .prepare(
            "DELETE FROM passages WHERE rowid IN (SELECT passage FROM passage_map WHERE article=?)",
          )
          .run(id);
        this.db.prepare("DELETE FROM passage_map WHERE article=?").run(id);
        this.db.prepare("DELETE FROM links WHERE source=?").run(id);
        this.db.prepare("DELETE FROM pages WHERE id=?").run(id);
      };
      for (const id of prior.keys())
        if (!wiki.pages.has(id)) {
          remove(id);
          deleted++;
        }
      for (const p of wiki.pages.values()) {
        if (prior.get(p.id) === p.blob) continue;
        if (prior.has(p.id)) remove(p.id);
        this.db
          .prepare("INSERT INTO pages VALUES(?,?,?,?,?)")
          .run(p.id, p.blob, p.title, p.description, p.topic);
        const extracted = sections(p.body);
        extracted[0].body = p.description + "\n" + extracted[0].body;
        for (const s of extracted) {
          const inserted = this.db
            .prepare("INSERT INTO passages VALUES(?,?,?,?,?,?,?)")
            .run(
              p.id,
              s.anchor,
              s.states.join(" "),
              p.title,
              (p.aliases || []).join(" "),
              s.heading,
              s.body,
            );
          this.db
            .prepare("INSERT INTO passage_map VALUES(?,?)")
            .run(p.id, inserted.lastInsertRowid);
        }
        for (const target of new Set([...references(p.body), ...p.related]))
          this.db.prepare("INSERT INTO links VALUES(?,?)").run(p.id, target);
        changed++;
      }
      this.db
        .prepare("INSERT OR REPLACE INTO meta VALUES('commit',?)")
        .run(wiki.head);
      this.db.exec("COMMIT");
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
    return { changed, deleted, milliseconds: performance.now() - started };
  }
  backlinks(id) {
    return this.db
      .prepare(
        "SELECT p.id,p.title FROM links l JOIN pages p ON p.id=l.source WHERE target=? ORDER BY p.title",
      )
      .all(id);
  }
  search(query, { topic = "", state = "", limit = 20, offset = 0 } = {}) {
    const start = performance.now();
    if (
      typeof query !== "string" ||
      query.length > 300 ||
      !Number.isInteger(limit) ||
      limit < 1 ||
      limit > 40 ||
      !Number.isInteger(offset) ||
      offset < 0 ||
      offset > 10000 ||
      !["", "wip", "pending", "done"].includes(state)
    )
      throw Error("Invalid search");
    // Treat user text as literal terms, never SQL or raw FTS operators. Prefix
    // matching supports incremental typing. Exact phrases use double quotes.
    const terms = query.match(/"[^"]+"|[\p{L}\p{N}_-]+/gu) || [];
    if (terms.length > 30) throw Error("Too many search terms");
    const match = terms
      .map((t) => (t.startsWith('"') ? t : `"${t}"*`))
      .join(" AND ");
    let rows;
    if (match) {
      rows = this.db
        .prepare(
          `SELECT article AS id, anchor, heading, snippet(passages,6,'','',' … ',30) AS snippet,
          rank AS score, p.title,p.description,p.topic
        FROM passages JOIN pages p ON p.id=passages.article
        WHERE passages MATCH ? AND rank MATCH 'bm25(0,0,0,12,10,5,1)' AND (?='' OR p.topic=?) AND (?='' OR instr(passages.states,?)>0)
        ORDER BY rank LIMIT 400`,
        )
        .all(match, topic, topic, state, state);
      rows.sort(
        (a, b) =>
          Number(String(b.title).toLowerCase() === query.trim().toLowerCase()) -
            Number(
              String(a.title).toLowerCase() === query.trim().toLowerCase(),
            ) || Number(a.score) - Number(b.score),
      );
    } else {
      rows = this.db
        .prepare(
          `SELECT p.id,'' AS anchor,'Overview' AS heading,p.description AS snippet,p.title,p.description,p.topic,0 AS score
        FROM pages p WHERE (?='' OR p.topic=?) AND (?='' OR EXISTS(SELECT 1 FROM passages WHERE article=p.id AND instr(states,?)>0)) ORDER BY title LIMIT 400`,
        )
        .all(topic, topic, state, state);
    }
    const unique = new Map();
    for (const row of rows)
      if (!unique.has(row.id))
        unique.set(row.id, {
          ...row,
          url: `/wiki/${row.id}/${row.anchor ? "#" + row.anchor : ""}`,
        });
    const all = [...unique.values()];
    return {
      total: all.length,
      truncated: rows.length === 400,
      nextOffset: offset + limit < all.length ? offset + limit : null,
      articles: all.slice(offset, offset + limit),
      milliseconds: performance.now() - start,
    };
  }
  close() {
    this.db.close();
  }
}
