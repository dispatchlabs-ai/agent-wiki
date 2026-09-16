/** Current space rights, shared by browser sessions and scoped agent runs. */
export function permits(role, action) {
  if (action === "read") return ["reader", "editor", "manager"].includes(role);
  return (
    ["write", "trace"].includes(action) && ["editor", "manager"].includes(role)
  );
}

/** Evidence is protected before lookup, including nonexistent IDs and downloads. */
export function evidencePath(path) {
  return [
    "/traces/",
    "/conversations/",
    "/files/",
    "/media/",
    "/api/traces/",
    "/api/files/",
    "/api/evidence/v1/",
  ].some((prefix) => path.startsWith(prefix));
}
export function toolAction(name) {
  if (name === "wiki.save") return "write";
  if (name.startsWith("wiki.trace") || name === "wiki.file") return "trace";
  return "read";
}
