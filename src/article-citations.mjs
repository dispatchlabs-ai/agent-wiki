import { sources } from "./render.mjs";

// Disposable extraction cache scoped to one reader. Retain only current blobs;
// permission checks stay at the request boundary, never in cached page results.
export class ArticleCitations {
  constructor() {
    this.head = null;
    this.byBlob = new Map();
  }
  citing(wiki, target, { contains = false } = {}) {
    if (this.head !== wiki.head) {
      const next = new Map();
      for (const page of wiki.pages.values()) {
        if (!next.has(page.blob))
          next.set(
            page.blob,
            this.byBlob.get(page.blob) || sources(page).map((s) => s.url),
          );
      }
      this.byBlob = next;
      this.head = wiki.head;
    }
    return [...wiki.pages.values()].filter((page) =>
      this.byBlob
        .get(page.blob)
        .some((url) =>
          contains ? url.includes(target) : url.startsWith(target),
        ),
    );
  }
}
