# Documentation screenshots

`atlas-labs-desktop.png` is an actual Chromium screenshot of the bundled synthetic
example, captured by `tests/browser/demo.spec.mjs`. It contains no private data.
Regenerate from the engine checkout after an interface change:

```sh
npm ci
npx playwright install chromium
npm run test:browser -- tests/browser/demo.spec.mjs
cp .runtime/ui-review/desktop-article.png docs/assets/atlas-labs-desktop.png
```

Inspect the new image before committing it. The fixture creates its own temporary
content and trace repositories; it does not use a running instance. Dates in the
image reflect fixture creation. The browser test also captures a mobile article
image under `.runtime/ui-review/` for visual review.
