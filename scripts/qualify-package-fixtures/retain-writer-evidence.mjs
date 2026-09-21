#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

if (!process.env.WIKI_LIFECYCLE_LOCK_FD || !process.env.WIKI_REPO)
  throw Error("Run this fixture through managed lifecycle maintenance");
fs.fstatSync(Number(process.env.WIKI_LIFECYCLE_LOCK_FD));
const retained = path.join(process.env.WIKI_REPO, ".git", "wiki-write.lock.d");
fs.mkdirSync(retained, { mode: 0o700 });
fs.writeFileSync(
  path.join(retained, "owner.json"),
  "interrupted synthetic writer\n",
  {
    flag: "wx",
    mode: 0o600,
  },
);
console.log(JSON.stringify({ retained: true }));
