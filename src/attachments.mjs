import { escape as e, renderMarkdown, link } from "./render.mjs";
import { mediaPattern } from "./markdown-enhancements.mjs";
export async function attachmentsHTML(files = []) {
  const cards = [];
  for (const file of (Array.isArray(files) ? files : []).filter(
    (f) => f && typeof f === "object",
  )) {
    const name = file.name || "Captured file";
    const available =
      file.status === "available" && mediaPattern.test(file.url || "");
    const details = [
      Number.isFinite(file.size)
        ? file.size >= 1048576
          ? `${(file.size / 1048576).toFixed(1)} MB`
          : `${Math.max(1, Math.round(file.size / 1024))} KB`
        : "",
      file.kind || "file",
      file.captured_at
        ? `Captured ${String(file.captured_at).slice(0, 10)}`
        : "",
    ]
      .filter(Boolean)
      .join(" · ");
    const original = available
      ? `<a href="${e(file.url)}" target="_blank" rel="noopener">Open ${file.kind === "pdf" ? "PDF" : "original"} ↗</a>`
      : "";
    const download = available
      ? `<a href="${e(file.url)}?download=${encodeURIComponent(name)}" download="${e(name)}">Download</a>`
      : "";
    const image =
      available &&
      file.kind === "image" &&
      /\.(png|jpg|jpeg|gif|webp)$/.test(file.url)
        ? `<a href="${e(file.url)}" target="_blank" rel="noopener"><img src="${e(file.url)}" alt="${e(name)}" loading="lazy" decoding="async"></a>`
        : "";
    const preview =
      available && typeof file.preview === "string" && file.preview
        ? `<details class="file-preview"><summary>Preview ${e(name)}</summary>${file.kind === "text" && /\.md$/i.test(name) ? `<div class="prose">${await renderMarkdown(file.preview)}</div>` : `<pre>${e(file.preview)}</pre>`}${file.preview_truncated ? `<p class="meta">Preview shortened. Download the complete file.</p>` : ""}</details>`
        : "";
    cards.push(
      `<section class="file-card" aria-label="${e(name)}">${image}<h3>${e(name)}</h3><p class="meta">${available ? e(details) : e(file.status === "not_captured" ? "Not included in this capture" : file.status === "too_large" ? "File exceeds the capture limit" : "Original file is unavailable")}</p>${file.provenance ? `<p class="meta">${e(file.provenance)}</p>` : ""}<div class="file-actions">${original}${download}</div>${preview}</section>`,
    );
  }
  return cards.length ? `<div class="attachments">${cards.join("")}</div>` : "";
}
