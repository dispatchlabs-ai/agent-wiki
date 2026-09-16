import { ModeToggle } from "./components/mode-toggle.jsx";
import React, { useState, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { Tabs } from "@base-ui/react/tabs";
import { QuickSearch } from "./components/quick-search.jsx";
import { AccountMenu } from "./components/account-menu.jsx";
const account = document.querySelector("#account-menu");
if (account) createRoot(account).render(<AccountMenu />);
const search = document.querySelector("#quick-search");
if (search) createRoot(search).render(<QuickSearch />);
const theme = document.querySelector("#theme-toggle");
if (theme) createRoot(theme).render(<ModeToggle />);
// Preserve all server-rendered panels when scripting is unavailable or printing.
function ContentTabs({ panels }) {
  const [value, setValue] = useState("0");
  useEffect(() => {
    const reveal = () => {
      let id;
      try {
        id = decodeURIComponent(location.hash.slice(1));
      } catch {
        return;
      }
      if (!id) return;
      const target = document.getElementById(id);
      const panel = target?.closest(".content-tab-panel");
      if (panel && panels.some((p) => p.html.includes(`id="${id}"`)))
        setValue(panel.dataset.index);
    };
    reveal();
    window.addEventListener("hashchange", reveal);
    return () => window.removeEventListener("hashchange", reveal);
  }, [panels]);
  return (
    <Tabs.Root value={value} onValueChange={setValue} className="content-tabs">
      <Tabs.List aria-label="Content views">
        {panels.map((panel, i) => (
          <Tabs.Tab key={i} value={String(i)}>
            {panel.title}
          </Tabs.Tab>
        ))}
      </Tabs.List>
      {panels.map((panel, i) => (
        <Tabs.Panel
          key={i}
          value={String(i)}
          keepMounted
          className="content-tab-panel"
        >
          <div dangerouslySetInnerHTML={{ __html: panel.html }} />
        </Tabs.Panel>
      ))}
    </Tabs.Root>
  );
}
const roots = new Map();
function enhance(root = document) {
  for (const group of root.querySelectorAll(".md-tabs:not([data-enhanced])")) {
    if (group.parentElement.closest(".md-tabs") || roots.size >= 100) continue;
    const panels = [...group.children].filter((n) => n.matches(".md-tab"));
    if (
      !panels.length ||
      panels.length > 20 ||
      group.children.length !== panels.length ||
      [...group.childNodes].some(
        (node) => node.nodeType === Node.TEXT_NODE && node.textContent.trim(),
      )
    )
      continue;
    const data = panels.map((panel) => ({
      title: panel.querySelector(".md-tab-title")?.textContent || "Tab",
      html: panel.innerHTML,
    }));
    group.dataset.enhanced = "true";
    const reactRoot = createRoot(group);
    roots.set(group, reactRoot);
    reactRoot.render(<ContentTabs panels={data} />);
  }
}
enhance();
new MutationObserver((records) => {
  for (const record of records)
    for (const node of record.addedNodes)
      if (node instanceof Element) {
        if (node.matches(".md-tabs:not([data-enhanced])"))
          enhance(node.parentElement);
        else enhance(node);
      }
  for (const [element, root] of roots)
    if (!element.isConnected) {
      root.unmount();
      roots.delete(element);
    }
}).observe(document.body, { childList: true, subtree: true });
document.addEventListener("click", async (event) => {
  const target = event.target instanceof Element ? event.target : null;
  const copy = target?.closest(".copy-code");
  if (copy) {
    const code = copy.parentElement.parentElement.querySelector("pre code");
    try {
      await navigator.clipboard.writeText(code.textContent);
      copy.textContent = "Copied";
    } catch {
      copy.textContent = "Select code to copy";
    }
  }
  const button = target?.closest(".render-diagram");
  if (button) {
    const figure = button.closest(".diagram");
    const source = figure.querySelector("pre code").textContent;
    if (source.length > 20_000) {
      button.textContent = "Diagram too large — read source below";
      return;
    }
    if (figure.querySelector("iframe")) return;
    const frame = document.createElement("iframe");
    frame.title = "Rendered Mermaid diagram";
    frame.setAttribute("sandbox", "allow-scripts");
    frame.src = "/assets/diagram.html";
    frame.addEventListener(
      "load",
      () =>
        frame.contentWindow.postMessage(
          {
            type: "render",
            source,
            dark:
              document.documentElement.dataset.theme === "dark" ||
              (!document.documentElement.dataset.theme &&
                matchMedia("(prefers-color-scheme: dark)").matches),
          },
          "*",
        ),
      { once: true },
    );
    const receive = (message) => {
      if (
        message.source !== frame.contentWindow ||
        message.data?.type !== "diagram-size"
      )
        return;
      frame.height = String(
        Math.min(1800, Math.max(180, Number(message.data.height) || 300)),
      );
      button.textContent = message.data.error
        ? "Could not render — source preserved below"
        : "Diagram shown";
      window.removeEventListener("message", receive);
    };
    window.addEventListener("message", receive);
    figure.querySelector(".diagram-output").append(frame);
    button.textContent = "Rendering diagram…";
  }
});

const agents = document.querySelector("#agents-app");
if (agents) {
  import("./components/agents.jsx")
    .then(({ AgentsApp }) => {
      createRoot(agents).render(
        <AgentsApp initial={JSON.parse(agents.dataset.state)} />,
      );
    })
    .catch(() => {
      const message = document.createElement("p");
      message.setAttribute("role", "alert");
      message.textContent =
        "The agent controls could not load. Reload the page to try again.";
      const reload = document.createElement("button");
      reload.type = "button";
      reload.className = "ui-button";
      reload.textContent = "Reload";
      reload.addEventListener("click", () => location.reload());
      agents.replaceChildren(message, reload);
    });
}
