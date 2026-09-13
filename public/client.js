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
  request("/api/me")
    .then((me) => {
      const inviteForm = document.querySelector("#invite-local");
      if (inviteForm)
        inviteForm.onsubmit = async (event) => {
          event.preventDefault();
          const button = inviteForm.querySelector("button"),
            status = inviteForm.querySelector("[role=status]"),
            output = inviteForm.querySelector("output");
          button.disabled = true;
          try {
            const result = await request(
              "/api/access/invitations",
              Object.fromEntries(new FormData(inviteForm)),
            );
            inviteForm.reset();
            output.replaceChildren();
            const label = document.createElement("label");
            label.textContent = "Private setup link";
            const input = document.createElement("input");
            input.readOnly = true;
            input.value = result.url;
            label.append(input);
            output.append(label);
            status.textContent =
              "Setup link created. Share it privately. Reload this page to set the new account’s access.";
          } catch (error) {
            status.textContent = error.message;
          } finally {
            button.disabled = false;
          }
        };
      if (document.querySelector("#access"))
        return request("/api/access").then(({ principals }) => {
          const root = document.querySelector("#access");
          for (const p of principals) {
            const row = document.createElement("form");
            const label = document.createElement("label");
            label.textContent = p.name + " ";
            const select = document.createElement("select");
            select.setAttribute("aria-label", p.name + " access");
            for (const role of ["", "reader", "editor", "manager"]) {
              const option = document.createElement("option");
              option.value = role;
              option.textContent = role || "No access";
              select.append(option);
            }
            select.value = p.role || "";
            label.append(select);
            row.append(label);
            const identity = document.createElement("small");
            identity.textContent = p.email
              ? `Local account · ${p.email}${p.local_ready ? "" : " · awaiting setup"}`
              : `${p.issuer || p.kind} · ${p.subject || p.id}`;
            identity.className = "principal-identity";
            row.append(identity);
            const button = document.createElement("button");
            button.textContent = "Save access";
            row.append(button);
            const status = document.createElement("span");
            status.setAttribute("role", "status");
            row.append(status);
            row.onsubmit = async (e) => {
              e.preventDefault();
              try {
                await request("/api/access", {
                  principal: p.id,
                  role: select.value || null,
                });
                status.textContent = "Saved";
              } catch (error) {
                status.textContent = error.message;
              }
            };
            root.append(row);
          }
        });
    })
    .catch((error) => {
      const access = document.querySelector("#access");
      if (access) access.textContent = error.message;
    });
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
      } else {
        for (const key of ["offset", "traceOffset"]) {
          const value = new URLSearchParams(location.search).get(key);
          if (value) params.set(key, value);
        }
      }
      const load = async (kind, element, render) => {
        if (!element || (initial && kind === "articles")) return;
        if (kind === "traces" && !q.trim()) {
          element.innerHTML = traceResults(
            { indexed: false, results: [], nextOffset: null },
            params,
          );
          return;
        }
        element.setAttribute("aria-busy", "true");
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
    let current,
      pending,
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
      if (current) status.textContent = "Changes not saved.";
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
    request(`/api/articles/${form.dataset.id}/current.json`)
      .then((page) => {
        current = page;
        for (const field of ["title", "description", "topic", "body"])
          form.elements[field].value = page[field];
        button.disabled = false;
        status.textContent = "Ready to edit.";
      })
      .catch((e) => {
        status.textContent = e.message;
      });
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (!current) return;
      button.disabled = true;
      const update = {
        id: current.id,
        expected_revision_id: current.revision_id,
        ...Object.fromEntries(new FormData(form)),
      };
      // Keep an identical operation across ambiguous network failures.
      if (
        !pending ||
        JSON.stringify(pending.updates[0]) !== JSON.stringify(update)
      )
        pending = { operation_id: crypto.randomUUID(), updates: [update] };
      try {
        const result = await request("/api/articles/edits", pending);
        current.revision_id = result.articles[0].revision_id;
        pending = null;
        dirty =
          JSON.stringify(Object.fromEntries(new FormData(form))) !==
          JSON.stringify(
            Object.fromEntries(
              Object.entries(update).filter(
                ([key]) => !["id", "expected_revision_id"].includes(key),
              ),
            ),
          );
        document.querySelector("#editing-revision").textContent =
          `Editing revision ${result.articles[0].number}`;
        status.textContent = `Saved in Git. Remote: ${result.remote}. Publication: ${result.publication}.`;
      } catch (e) {
        status.textContent = `${e.message}. Your draft remains here. If the article changed, read the current article in another tab and reconcile before reloading.`;
      } finally {
        button.disabled = false;
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
