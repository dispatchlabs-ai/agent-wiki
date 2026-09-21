#!/usr/bin/env node
import path from "node:path";
import { parseArgs } from "node:util";
import { publishArticleMedia } from "../src/article-media.mjs";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    source: { type: "string" },
    "source-url": { type: "string" },
    "source-date": { type: "string" },
    name: { type: "string" },
  },
});
if (
  positionals.length !== 1 ||
  !values.source ||
  !process.env.WIKI_ARTICLE_MEDIA
)
  throw Error(
    "Usage: WIKI_ARTICLE_MEDIA=/absolute/store node scripts/publish-article-media.mjs FILE --source SOURCE_ID [--source-url URL] [--source-date DATE] [--name DISPLAY_NAME]",
  );
const result = await publishArticleMedia({
  root: process.env.WIKI_ARTICLE_MEDIA,
  sourceFile: path.resolve(positionals[0]),
  source: values.source,
  sourceUrl: values["source-url"],
  sourceDate: values["source-date"],
  name: values.name,
});
console.log(
  JSON.stringify({
    asset: result.asset,
    url: result.url,
    sha256: result.manifest.sha256,
    media_type: result.manifest.media_type,
    size: result.manifest.size,
  }),
);
