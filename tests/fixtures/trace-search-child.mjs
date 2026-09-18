process.once("message", ({ query }) => {
  if (query === "hang") {
    setInterval(() => {}, 1000);
    return;
  }
  process.send?.({
    ok: true,
    result: {
      indexed: true,
      results: [{ logical_key: query, snippet: query }],
      nextOffset: null,
    },
  });
  process.disconnect();
});
