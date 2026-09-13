import fs from "node:fs";

// Two open pages in the approved upright orientation, with a four-unit gutter.
// Keep the silhouette simple enough for the favicon and compact header.
const pages = `<path d="M8 5Q3 3 3 9V41Q3 45 7 46L26 53Q30 55 30 50V21Q30 17 26 15Z"/><path d="M56 5Q61 3 61 9V41Q61 45 57 46L38 53Q34 55 34 50V21Q34 17 38 15Z"/>`;
const svg = (attrs, body) =>
  `<svg xmlns="http://www.w3.org/2000/svg" ${attrs}>${body}</svg>\n`;
const out = new URL("../public/", import.meta.url);
fs.writeFileSync(
  new URL("brand-mark.svg", out),
  svg(
    'viewBox="0 0 64 56" fill="#256c9e"',
    `<title>Agent Wiki</title>${pages}`,
  ),
);
for (const [name, ink, blue] of [
  ["light", "#192c35", "#256c9e"],
  ["dark", "#e4edf1", "#8ab4f8"],
  ["mono", "#192c35", "#192c35"],
]) {
  fs.writeFileSync(
    new URL(`brand-${name}.svg`, out),
    svg(
      'viewBox="0 0 272 48" role="img" aria-label="Agent Wiki"',
      `<g fill="${blue}" transform="translate(0 7) scale(.6)">${pages}</g><text x="48" y="34" fill="${ink}" font-family="system-ui, sans-serif" font-size="30" font-weight="700" letter-spacing="-1">Agent Wiki</text>`,
    ),
  );
}
// A pale tile keeps the same mark legible against light and dark browser chrome.
fs.writeFileSync(
  new URL("favicon.svg", out),
  svg(
    'viewBox="0 0 64 64"',
    `<rect width="64" height="64" rx="12" fill="#eef5ff"/><g fill="#256c9e" transform="translate(4 8) scale(.875)">${pages}</g>`,
  ),
);
