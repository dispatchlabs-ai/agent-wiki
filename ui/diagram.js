import mermaid from "mermaid";
const config = {
  startOnLoad: false,
  securityLevel: "strict",
  maxTextSize: 20_000,
  maxEdges: 200,
  suppressErrorRendering: true,
  flowchart: { htmlLabels: false },
  secure: [
    "secure",
    "securityLevel",
    "startOnLoad",
    "maxTextSize",
    "maxEdges",
    "suppressErrorRendering",
  ],
};
let rendered = false;
window.addEventListener("message", async (event) => {
  if (event.source !== parent || event.data?.type !== "render" || rendered)
    return;
  rendered = true;
  const source = event.data.source;
  document.documentElement.dataset.theme = event.data.dark ? "dark" : "light";
  mermaid.initialize({
    ...config,
    theme: event.data.dark ? "dark" : "default",
  });
  let error = false;
  try {
    if (
      typeof source !== "string" ||
      source.length > 20_000 ||
      /%%\s*\{|^---/m.test(source)
    )
      throw new Error("Diagram configuration is not supported.");
    const { svg } = await mermaid.render("wiki-diagram", source);
    document.querySelector("main").innerHTML = svg;
    const drawing = document.querySelector("main svg");
    if (drawing?.viewBox.baseVal.width) {
      drawing.style.width = `${drawing.viewBox.baseVal.width}px`;
      drawing.style.maxWidth = "none";
    }
  } catch {
    error = true;
    document.querySelector("main").textContent =
      "This diagram could not be rendered. Its original source is available below.";
  }
  parent.postMessage(
    {
      type: "diagram-size",
      height: document.documentElement.scrollHeight + 16,
      error,
    },
    "*",
  );
});
