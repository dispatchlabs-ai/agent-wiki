import { indexTraces } from "../src/trace-search.mjs";
import path from "node:path";
import { importTrace } from "../src/traces.mjs";
const [root, source, title] = process.argv.slice(2);
if (!root || !source) {
  console.error(
    'Usage: node scripts/import-trace.mjs TRACE_ROOT SOURCE.jsonl ["Title"]',
  );
  process.exitCode = 1;
} else {
  const trace = importTrace(path.resolve(root), path.resolve(source), title);
  indexTraces(path.resolve(root));
  console.log(JSON.stringify(trace, null, 2));
}
