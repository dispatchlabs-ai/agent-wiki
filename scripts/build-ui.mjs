import { build } from "esbuild";
await build({
  entryPoints: { ui: "ui/main.jsx", diagram: "ui/diagram.js" },
  outdir: "public/vendor",
  bundle: true,
  splitting: true,
  format: "esm",
  platform: "browser",
  target: ["chrome111", "firefox128", "safari16.4"],
  minify: true,
  legalComments: "linked",
  define: { "process.env.NODE_ENV": '"production"' },
});
// Ship the license texts alongside browser bundles, in addition to esbuild's
// per-chunk legal notices. This derives only from the locked installed packages.
const { default: fs } = await import("node:fs");
const { default: path } = await import("node:path");
const lock = JSON.parse(fs.readFileSync("package-lock.json", "utf8"));
const notices = [
  "Browser dependency license notices\n",
  fs.readFileSync("docs/shadcn-license.txt", "utf8"),
];
for (const directory of Object.keys(lock.packages)
  .filter((p) => p.startsWith("node_modules/"))
  .sort()) {
  if (!fs.existsSync(directory)) continue;
  for (const name of fs
    .readdirSync(directory)
    .filter((n) => /^(?:licen[sc]e|copying|notice)(?:[.-].*)?$/i.test(n))) {
    const filename = path.join(directory, name);
    if (fs.statSync(filename).isFile())
      notices.push(
        `\n--- ${directory} / ${name} ---\n${fs.readFileSync(filename, "utf8")}`,
      );
  }
}
fs.writeFileSync("public/vendor/licenses.txt", notices.join("\n"));
