import fs from "node:fs";
import { format } from "prettier";
import { openAPI } from "../src/api-contract.mjs";
const file = new URL("../docs/openapi.json", import.meta.url);
const output = await format(JSON.stringify(openAPI()), { parser: "json" });
if (process.argv.includes("--check")) {
  if (!fs.existsSync(file) || fs.readFileSync(file, "utf8") !== output) {
    console.error("HTTP contract is stale; run npm run contract");
    process.exitCode = 1;
  }
} else fs.writeFileSync(file, output);
