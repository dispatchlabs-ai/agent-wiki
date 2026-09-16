import { WikiError } from "./errors.mjs";

export function catalogOptions(params) {
  const limit = Number(params.get("limit") || 20),
    offset = Number(params.get("offset") || 0),
    format = params.get("format") || "",
    session_id = params.get("session_id") || "";
  if (
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    limit > 100 ||
    !Number.isSafeInteger(offset) ||
    offset < 0 ||
    offset > 10000 ||
    !["", "codex", "pi"].includes(format) ||
    session_id.length > 1000
  )
    throw new WikiError("INVALID_CATALOG", "Invalid trace catalog parameters");
  return { limit, offset, format, session_id };
}
export function sortedSnapshots(
  catalog,
  { format = "", session_id = "" } = {},
) {
  return catalog
    .filter(
      (t) =>
        (!format || t.format === format) &&
        (!session_id || t.session_id === session_id),
    )
    .sort(
      (a, b) =>
        String(b.imported_at).localeCompare(String(a.imported_at)) ||
        a.id.localeCompare(b.id),
    );
}
export function sessions(catalog, options = {}) {
  const groups = new Map();
  for (const snapshot of sortedSnapshots(catalog, options)) {
    const session_id =
      typeof snapshot.session_id === "string" && snapshot.session_id
        ? snapshot.session_id
        : null;
    const key = JSON.stringify([
      snapshot.format,
      session_id,
      session_id ? null : snapshot.id,
    ]);
    if (!groups.has(key))
      groups.set(key, {
        format: snapshot.format,
        session_id,
        latest: snapshot,
        snapshot_count: 0,
      });
    groups.get(key).snapshot_count++;
  }
  return [...groups.values()];
}
export function catalogPage(items, { limit, offset }, key) {
  return {
    [key]: items.slice(offset, offset + limit),
    total: items.length,
    nextOffset: offset + limit < items.length ? offset + limit : null,
  };
}
