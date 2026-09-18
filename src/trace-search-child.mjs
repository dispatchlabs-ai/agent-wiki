import { searchTraces } from "./trace-search.mjs";

process.once("message", ({ root, query, options }) => {
  try {
    process.send?.({ ok: true, result: searchTraces(root, query, options) });
  } catch (error) {
    process.send?.({
      ok: false,
      error: {
        name: error?.name,
        code: error?.code,
        status: error?.status,
        message: error?.message || "Trace search failed",
      },
    });
  } finally {
    process.disconnect();
  }
});
