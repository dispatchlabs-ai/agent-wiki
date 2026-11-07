/* Host-provided SDK. The sandbox never receives wiki cookies or credentials. */
(() => {
  const channel = new MessageChannel();
  const pending = new Map();
  let next = 0;
  channel.port1.onmessage = ({ data }) => {
    const call = pending.get(data?.id);
    if (!call) return;
    pending.delete(data.id);
    if (data.error)
      call.reject(Object.assign(new Error(data.error.message), data.error));
    else call.resolve(data.result);
  };
  const call = (method, args) =>
    new Promise((resolve, reject) => {
      const id = ++next;
      pending.set(id, { resolve, reject });
      channel.port1.postMessage({ id, method, args });
    });
  window.wikiApp = Object.freeze({
    query: (sql, parameters = []) => call("query", { sql, parameters }),
    execute: (sql, parameters = [], operation_id) =>
      call("execute", { sql, parameters, operation_id }),
    article: (id) => call("article", { id }),
  });
  const capability = new URL(document.currentScript.src).pathname.split("/")[2];
  parent.postMessage({ type: "wiki-app-connect", capability }, "*", [
    channel.port2,
  ]);
})();
