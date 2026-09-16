import path from "node:path";
import { indexTraces } from "../src/trace-search.mjs";
if (!process.argv[2]) {
  console.error("Usage: node scripts/index-traces.mjs TRACE_ROOT");
  process.exitCode = 1;
} else console.log(JSON.stringify(indexTraces(path.resolve(process.argv[2]))));
