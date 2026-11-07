import { appOperations } from "../public/apps-contract.js";

const appRoutes = appOperations.map((op) => ({
  ...op,
  match: new RegExp(
    "^" + op.path.replace("{id}", "[a-z0-9]+(?:-[a-z0-9]+)*") + "$",
  ),
}));
export function appAction(path) {
  const op = appRoutes.find((route) => route.match.test(path));
  return op ? (op.write ? "write" : "read") : null;
}
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
  const app = appOperations.find((op) => op.name === name);
  if (app) return app.write ? "write" : "read";
  if (name === "wiki.save") return "write";
  if (name.startsWith("wiki.trace") || name === "wiki.file") return "trace";
  return "read";
}
