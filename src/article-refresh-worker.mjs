import { parentPort, workerData } from "node:worker_threads";
import { GitWiki } from "./git-wiki.mjs";
import { WikiSearch } from "./wiki-search.mjs";

const wiki = Object.assign(
  Object.create(GitWiki.prototype),
  workerData.snapshot,
);
const index = new WikiSearch(workerData.database);
const reads = new Map();
let nextRead = 0;
function historyGit(repo, args, options) {
  return new Promise((resolve, reject) => {
    const requestId = ++nextRead;
    reads.set(requestId, { resolve, reject });
    parentPort.postMessage({ kind: "historyGit", requestId, args, options });
  });
}
parentPort.on("message", async (message) => {
  const { kind, key, head, id, refs } = message;
  if (kind === "historyGit") {
    const pending = reads.get(message.requestId);
    reads.delete(message.requestId);
    if (message.error) pending?.reject(Error(message.error));
    else pending?.resolve(Buffer.from(message.output));
    return;
  }
  const reply = (result) => parentPort.postMessage({ key, result });
  if (kind === "history") {
    try {
      reply({ revisions: await wiki.history(id, refs, historyGit) });
    } catch (error) {
      reply({ error: error.message });
    }
    return;
  }
  const previous = { ...wiki };
  let stage = "storage";
  try {
    if (kind === "checkpoint") {
      stage = "index";
      reply({
        checkpoint: index.db.prepare("PRAGMA wal_checkpoint(PASSIVE)").get(),
      });
      return;
    }
    const changed = wiki.refresh();
    stage = "index";
    const stats = index.sync(wiki);
    // Each side owns immutable, allowlisted attribution projections. Refresh
    // replaces the article/index snapshot, never either side's history cache.
    const { attributions, ...snapshot } = wiki;
    reply({
      snapshot: changed || wiki.head !== head ? snapshot : null,
      stats,
    });
  } catch (error) {
    Object.assign(wiki, previous);
    reply({ error: error.message, stage });
  }
});
