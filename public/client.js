import { articleResults, traceResults } from "./search-results.js";
import { createWikiTools } from "./wiki-tools.js";
class RequestError extends Error {
  constructor(message, status, code) {
    super(message);
    this.status = status;
    this.code = code;
  }
}
export async function request(url, draft) {
  let csrf;
  if (draft) {
    try {
      csrf = (await request("/api/me")).csrf;
    } catch (error) {
      if (error.status !== 404) throw error;
    }
  }
  const response = await fetch(
    url,
    draft
      ? {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Wiki-Write": "1",
            ...(csrf ? { "X-Wiki-CSRF": csrf } : {}),
          },
          body: JSON.stringify(draft),
        }
      : {},
  );
  let result;
  try {
    result = await response.json();
  } catch {
    throw new RequestError(
      "Invalid JSON response",
      response.status,
      "INVALID_RESPONSE",
    );
  }
  if (!response.ok)
    throw new RequestError(
      result.error || `HTTP ${response.status}`,
      response.status,
      result.code || `HTTP_${response.status}`,
    );
  return result;
}
export async function registerTools(context, writable, config = {}) {
  if (!context?.registerTool) return;
  const controller = new AbortController();
  try {
    for (const tool of createWikiTools(request, writable, config))
      await context.registerTool(
        {
          ...tool,
          execute: async (args) => {
            try {
              return await tool.execute(args);
            } catch (error) {
              return {
                isError: true,
                state: "rejected",
                status: error.status || 0,
                code: error.code || "NETWORK_ERROR",
                error: error.message || "Request failed",
              };
            }
          },
          annotations: {
            readOnlyHint: tool.name !== "wiki.save",
            untrustedContentHint: true,
          },
        },
        { signal: controller.signal },
      );
    return controller;
  } catch (e) {
    controller.abort();
    throw e;
  }
}
if (typeof document !== "undefined") {
  if (window.top === window.self)
    if (window.top === window.self)
      request("/api/articles/authoring.json")
        .then(async (config) => {
          const controller = await registerTools(
            document.modelContext || navigator.modelContext,
            config.write,
            config,
          );
          document.documentElement.dataset.webmcp = controller
            ? "ready"
            : "unavailable";
          window.addEventListener("pagehide", () => controller?.abort(), {
            once: true,
          });
        })
        .catch(() => {
          document.documentElement.dataset.webmcp = "unavailable";
        });
  const searchForm = document.querySelector("[data-live-search]");
  if (searchForm) {
    let pending, controller;
    function showSearching(element) {
      element.setAttribute("aria-busy", "true");
      const note = document.createElement("p");
      note.className = "ui-result-meta";
      note.textContent = "Searching…";
      element.replaceChildren(note);
    }
    const run = async (initial = false) => {
      controller?.abort();
      controller = new AbortController();
      const signal = controller.signal;
      const params = new URLSearchParams(new FormData(searchForm));
      const q = params.get("q") || "";
      if (!initial) {
        history.replaceState(null, "", "/search/?" + params);
        document
          .querySelectorAll('nav[aria-label="Search type"] a')
          .forEach((a) => {
            const type = new URL(a.href).searchParams.get("type");
            const next = new URLSearchParams(params);
            next.set("type", type);
            a.href = "/search/?" + next;
          });
        document
          .querySelectorAll('.filter-form input[name="q"]')
          .forEach((el) => (el.value = q));
        const clear = document.querySelector("[data-clear-search-filters]");
        if (clear)
          clear.setAttribute("href", "/search/?" + new URLSearchParams({ q }));
      } else {
        for (const key of ["offset", "traceOffset"]) {
          const value = new URLSearchParams(location.search).get(key);
          if (value) params.set(key, value);
        }
      }
      const load = async (kind, element, render) => {
        if (!element || (initial && kind === "articles")) return;
        if (kind === "traces" && !q.trim()) {
          element.removeAttribute("aria-busy");
          element.innerHTML = traceResults(
            { indexed: false, results: [], nextOffset: null },
            params,
          );
          return;
        }
        showSearching(element);
        const query = new URLSearchParams(params);
        if (kind === "traces")
          query.set("offset", params.get("traceOffset") || "0");
        query.set("limit", "20");
        try {
          const response = await fetch(`/api/${kind}/search?${query}`, {
            signal,
          });
          const data = await response.json();
          if (!response.ok) throw Error(data.error || "Search unavailable");
          if (!signal.aborted) element.innerHTML = render(data, params);
        } catch (error) {
          if (!signal.aborted)
            element.innerHTML = render({ error: error.message }, params);
        } finally {
          if (!signal.aborted) element.removeAttribute("aria-busy");
        }
      };
      await Promise.allSettled([
        load(
          "articles",
          document.querySelector("#article-results"),
          articleResults,
        ),
        load("traces", document.querySelector("#trace-results"), traceResults),
      ]);
    };
    searchForm.querySelector('[name="q"]').addEventListener("input", () => {
      clearTimeout(pending);
      controller?.abort();
      document
        .querySelectorAll("#article-results, #trace-results")
        .forEach(showSearching);
      pending = setTimeout(() => run(), 180);
    });
    searchForm.addEventListener("submit", (e) => {
      e.preventDefault();
      clearTimeout(pending);
      run();
    });
    if (document.querySelector("#trace-results[data-pending]")) run(true);
    window.addEventListener(
      "pagehide",
      () => {
        clearTimeout(pending);
        controller?.abort();
      },
      { once: true },
    );
  }
  const evidenceReader = document.querySelector("[data-evidence-id]");
  if (evidenceReader) {
    const locate = () => {
      let id;
      try {
        id = decodeURIComponent(location.hash.slice(1));
      } catch {
        return;
      }
      if (!id || document.getElementById(id)) return;
      const url = new URL(location.href);
      if (url.searchParams.get("event") === id) return;
      url.searchParams.set("event", id);
      url.searchParams.delete("offset");
      location.replace(url);
    };
    locate();
    window.addEventListener("hashchange", locate);
  }
  document
    .querySelectorAll(".embedded-image img, .file-card img")
    .forEach((img) => {
      const failed = () => {
        const note = document.createElement("p");
        note.className = "notice warning";
        note.textContent = `Image unavailable: ${img.alt || "captured image"}`;
        img.replaceWith(note);
      };
      img.addEventListener("error", failed, { once: true });
      if (img.complete && !img.naturalWidth) failed();
    });
  const mobile = matchMedia("(max-width: 760px)");
  document.querySelectorAll("[data-responsive-details]").forEach((d) => {
    d.open = !mobile.matches;
    mobile.addEventListener("change", () => {
      d.open = !mobile.matches;
    });
  });
  function revealAnchor() {
    let id;
    try {
      id = decodeURIComponent(location.hash.slice(1));
    } catch {
      return;
    }
    const target = document.getElementById(id);
    if (!target) return;
    let ancestor = target.parentElement;
    while (ancestor) {
      if (ancestor.tagName === "DETAILS") ancestor.open = true;
      ancestor = ancestor.parentElement;
    }
    if (target.matches(".trace-event")) {
      const detail = target.querySelector(":scope > details");
      if (detail) detail.open = true;
    }
  }
  revealAnchor();
  window.addEventListener("hashchange", revealAnchor);
  document.querySelectorAll("[data-trace-mode]").forEach((button) =>
    button.addEventListener("click", () => {
      const records = button.dataset.traceMode === "records";
      document
        .querySelectorAll("[data-trace-mode]")
        .forEach((b) => b.setAttribute("aria-pressed", String(b === button)));
      document.querySelectorAll(".trace-event details").forEach((d) => {
        d.open = records;
      });
      revealAnchor();
    }),
  );
  const form = document.querySelector("#editor");
  if (form) {
    const status = document.querySelector("#status"),
      button = form.querySelector('button[type="submit"]');
    const creating = !form.dataset.id;
    const compareButton = document.querySelector("#compare-latest"),
      conflictPanel = document.querySelector("#editor-conflict"),
      useReviewed = document.querySelector("#use-reviewed");
    const fields = ["title", "description", "topic", "body", "summary"];
    const draftValues = () =>
      Object.fromEntries(fields.map((key) => [key, form.elements[key].value]));
    let current,
      pending,
      reviewed,
      conflict = false,
      saving = false,
      dirty = false,
      previewVersion = 0,
      previewTimer;
    const panes = form.querySelector(".editor-panes");
    const modes = [...form.querySelectorAll("[data-editor-mode]")];
    async function preview() {
      const version = ++previewVersion;
      document.querySelector("#preview-title").textContent =
        form.elements.title.value;
      document.querySelector("#preview-description").textContent =
        form.elements.description.value;
      const previewStatus = document.querySelector("#preview-status");
      previewStatus.textContent = "Updating preview…";
      try {
        const rendered = await request("/api/articles/preview", {
          body: form.elements.body.value,
        });
        if (version !== previewVersion) return;
        document.querySelector("#preview-body").innerHTML = rendered.html;
        previewStatus.textContent = "";
      } catch (error) {
        if (version === previewVersion)
          previewStatus.textContent = error.message;
      }
    }
    function setMode(mode) {
      if (mode === "split" && mobile.matches) mode = "write";
      panes.dataset.mode = mode;
      modes.forEach((b) => {
        b.setAttribute("aria-selected", String(b.dataset.editorMode === mode));
        b.tabIndex = b.dataset.editorMode === mode ? 0 : -1;
      });
      if (mode !== "write") preview();
    }
    modes.forEach((b) => {
      b.addEventListener("click", () => setMode(b.dataset.editorMode));
      b.addEventListener("keydown", (event) => {
        const available = modes.filter(
            (b) => !mobile.matches || b.dataset.editorMode !== "split",
          ),
          i = available.indexOf(b);
        let next;
        if (event.key === "ArrowRight")
          next = available[(i + 1) % available.length];
        if (event.key === "ArrowLeft")
          next = available[(i + available.length - 1) % available.length];
        if (event.key === "Home") next = available[0];
        if (event.key === "End") next = available.at(-1);
        if (next) {
          event.preventDefault();
          setMode(next.dataset.editorMode);
          next.focus();
        }
      });
    });
    setMode("write");
    mobile.addEventListener("change", () => {
      if (mobile.matches && panes.dataset.mode === "split") setMode("write");
    });
    form.addEventListener("input", () => {
      dirty = true;
      if (current)
        status.textContent = pending
          ? "Save not yet confirmed. Retry save sends the original request; your later changes remain here."
          : conflict
            ? "Your draft is retained. Compare the latest revision before saving."
            : "Changes not saved.";
      if (panes.dataset.mode !== "write") {
        clearTimeout(previewTimer);
        previewTimer = setTimeout(preview, 250);
      }
    });
    window.addEventListener("beforeunload", (event) => {
      if (dirty) {
        event.preventDefault();
        event.returnValue = "";
      }
    });
    function ready() {
      button.disabled = saving || conflict || !current;
      button.formNoValidate = !!pending;
      if (creating)
        form.elements.id.readOnly = !!pending || !!current?.revision_id;
      button.textContent = pending
        ? "Retry save"
        : creating && !current?.revision_id
          ? "Create article"
          : "Save revision";
    }
    if (creating) {
      current = { id: "", revision_id: null, number: 0 };
      ready();
      status.textContent = "Ready to create.";
    } else {
      // Disable fields until the base loads so a delayed response cannot erase typing.
      fields.forEach((key) => (form.elements[key].disabled = true));
      request(`/api/articles/${form.dataset.id}/current.json`)
        .then((page) => {
          current = page;
          for (const field of fields) {
            form.elements[field].disabled = false;
            if (field !== "summary") form.elements[field].value = page[field];
          }
          ready();
          status.textContent = "Ready to edit.";
        })
        .catch((error) => {
          status.textContent = error.message;
        });
    }
    compareButton.addEventListener("click", async () => {
      if (pending || saving) return;
      compareButton.disabled = true;
      useReviewed.disabled = true;
      status.textContent = "Loading latest revision; your draft is unchanged…";
      try {
        const page = await request(`/api/articles/${current.id}/current.json`);
        reviewed = page;
        const comparison = document.querySelector("#conflict-comparison");
        comparison.replaceChildren();
        for (const field of fields.filter(
          (key) => key !== "summary" && current[key] !== page[key],
        )) {
          const heading = document.createElement("h3");
          heading.textContent =
            field === "body"
              ? "Markdown"
              : field[0].toUpperCase() + field.slice(1);
          const row = document.createElement("div");
          row.className = "diff-row";
          for (const [revision, label] of [
            [current, "Your base"],
            [page, "Latest saved"],
          ]) {
            const cell = document.createElement("div"),
              title = document.createElement("p"),
              text = document.createElement("pre");
            cell.className = "diff-cell";
            title.className = "diff-label";
            title.textContent = `${label} · Revision ${revision.number}`;
            text.textContent = revision[field];
            cell.append(title, text);
            row.append(cell);
          }
          comparison.append(heading, row);
        }
        if (!comparison.childElementCount)
          comparison.textContent =
            "No changes to the editable fields; other article metadata may have changed.";
        conflictPanel.hidden = false;
        useReviewed.disabled = false;
        status.textContent = `Review revision ${page.number} below. Your draft has not changed.`;
        document.querySelector("#conflict-heading").focus();
      } catch (error) {
        reviewed = null;
        status.textContent = `${error.message}. Your draft remains here. Try comparing again when access or the connection is restored.`;
      } finally {
        compareButton.disabled = false;
      }
    });
    useReviewed.addEventListener("click", () => {
      if (!reviewed || pending || saving) return;
      current = reviewed;
      reviewed = null;
      conflict = false;
      conflictPanel.hidden = true;
      compareButton.hidden = true;
      document.querySelector("#editing-revision").textContent =
        `Editing revision ${current.number}`;
      status.textContent =
        "Reviewed revision selected. Check your reconciled draft, then save deliberately.";
      ready();
      button.focus();
    });
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (!current || saving || conflict) return;
      saving = true;
      // An uncertain save is resolved with its exact original input, even if
      // the user keeps editing. Never convert uncertainty into a new mutation.
      if (!pending)
        pending = {
          operation_id: crypto.randomUUID(),
          updates: [
            {
              id:
                creating && !current.revision_id
                  ? form.elements.id.value
                  : current.id,
              expected_revision_id: current.revision_id,
              ...draftValues(),
            },
          ],
        };
      const update = pending.updates[0];
      ready();
      try {
        const result = await request("/api/articles/edits", pending);
        current = { ...current, ...update, ...result.articles[0] };
        pending = null;
        dirty =
          fields.some((key) => form.elements[key].value !== update[key]) ||
          (creating && form.elements.id.value !== update.id);
        document.querySelector("#editing-revision").textContent =
          `Editing revision ${current.number}`;
        status.textContent = `Saved in Git. Remote: ${result.remote}. Publication: ${result.publication}.${dirty ? " Your later changes are not saved." : ""}`;
        if (creating) {
          form.elements.id.value = current.id;
          form.elements.id.readOnly = true;
          // Do not navigate away from changes typed while a save was in flight.
          if (!dirty && result.publication === "live") {
            location.assign(current.url);
            return;
          }
          const open = document.createElement("a");
          open.href = current.url;
          open.textContent = "Open saved article";
          status.append(" ", open);
        }
      } catch (error) {
        const definitive =
          [400, 409, 413].includes(error.status) &&
          error.code !== "INVALID_RESPONSE";
        if (definitive) pending = null;
        if (
          definitive &&
          error.code === "REVISION_CONFLICT" &&
          current.revision_id
        ) {
          conflict = true;
          compareButton.hidden = false;
          status.textContent =
            "A newer revision was saved. Your draft remains here. Compare it before reconciling and saving.";
          compareButton.focus();
        } else {
          status.textContent = `${error.message}. Your draft remains here. ${pending ? "The save outcome is uncertain. Retry save sends the identical original request; later draft changes will not be submitted yet." : creating && error.code === "REVISION_CONFLICT" ? "That article ID already exists. Choose another ID; the existing article will not be overwritten." : "Correct the problem or restore access, then try again."}`;
        }
      } finally {
        saving = false;
        ready();
      }
    });
  }
}

// Keep source timestamps intact; render conversation starts in the reader's zone.
if (typeof document !== "undefined") {
  for (const time of document.querySelectorAll("time[data-local-time]")) {
    const value = time.getAttribute("datetime");
    const d = new Date(value);
    if (!Number.isNaN(d.valueOf())) {
      time.textContent = new Intl.DateTimeFormat(undefined, {
        year: "numeric",
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
        timeZoneName: "short",
      }).format(d);
      time.setAttribute("title", value);
    }
  }
}
