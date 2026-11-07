(() => {
  const frame = document.querySelector("iframe[data-wiki-app]");
  if (!frame) return;
  const config = JSON.parse(frame.dataset.wikiApp);
  window.addEventListener("message", (event) => {
    if (
      event.source !== frame.contentWindow ||
      event.origin !== "null" ||
      event.data?.type !== "wiki-app-connect" ||
      event.data.capability !== config.capability ||
      event.ports.length !== 1
    )
      return;
    const port = event.ports[0];
    port.onmessage = async ({ data }) => {
      const id = data?.id;
      try {
        let route, body;
        if (data.method === "article") {
          if (!config.articles.includes(data.args?.id))
            throw Error("This article is not bound to the page");
          route = `/api/articles/${encodeURIComponent(data.args.id)}/current.json`;
        } else if (
          ["query", "execute"].includes(data.method) &&
          config.backend
        ) {
          if (data.method === "execute" && !config.write)
            throw Error("This page has a read-only backend binding");
          route = `/api/backends/${encodeURIComponent(config.backend)}/${data.method}`;
          body = {
            id: config.backend,
            sql: data.args?.sql,
            parameters: data.args?.parameters ?? [],
            ...(data.method === "execute"
              ? { operation_id: data.args?.operation_id }
              : {}),
          };
        } else throw Error("This page has no matching backend operation");
        const response = await fetch(route, {
          method: body ? "POST" : "GET",
          credentials: "same-origin",
          headers: {
            "Content-Type": "application/json",
            "X-Wiki-CSRF": config.csrf,
          },
          ...(body ? { body: JSON.stringify(body) } : {}),
        });
        const result = await response.json();
        if (!response.ok)
          throw Object.assign(new Error(result.error || "Request failed"), {
            code: result.code,
            status: response.status,
          });
        port.postMessage({ id, result });
      } catch (error) {
        port.postMessage({
          id,
          error: {
            message: error.message,
            code: error.code,
            status: error.status,
          },
        });
      }
    };
  });
  // Install the bridge before navigation so fast local frames cannot miss it.
  frame.src = frame.dataset.src;
})();
