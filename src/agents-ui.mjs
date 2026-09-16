import { shell, escape } from "./render.mjs";

export function agentsPage(agents, actor, origin, toolNames) {
  const control = agents.control;
  const entries = agents
    .list(actor.id)
    .filter((a) => a.active)
    .map((a) => ({
      id: a.id,
      name: a.name,
      owner: a.owner === actor.id,
      role: control.role(a.id),
      invoke: agents.allowed(actor.id, a.id, "invoke"),
      configure: agents.allowed(actor.id, a.id, "configure"),
      manage: agents.allowed(actor.id, a.id, "manage-access"),
      config: agents.allowed(actor.id, a.id, "configure")
        ? JSON.parse(
            agents.db
              .prepare("SELECT config FROM agent_definitions WHERE id=?")
              .get(a.definition).config,
          )
        : null,
      grants: agents.allowed(actor.id, a.id, "manage-access")
        ? agents.db
            .prepare(
              "SELECT p.id,p.name,g.permission FROM agent_permissions g JOIN principals p ON p.id=g.principal WHERE g.agent=? ORDER BY p.name",
            )
            .all(a.id)
        : [],
    }));
  const data = {
    name: actor.name,
    manager: control.role(actor.id) === "manager",
    endpoint: origin + "/mcp",
    toolNames,
    agents: entries,
    people:
      control.role(actor.id) && entries.some((a) => a.manage)
        ? control
            .access()
            .filter((p) => p.kind === "human")
            .map((p) => ({
              id: p.id,
              name: p.name,
              identity: [
                p.email || p.subject,
                p.issuer === "urn:agentic-wiki:local"
                  ? "Wiki account"
                  : p.issuer,
              ].join(" · "),
            }))
        : [],
    connections: agents.db
      .prepare(
        "SELECT g.id,p.name,c.name client,g.expires FROM remote_grants g JOIN principals p ON p.id=g.agent JOIN remote_clients c ON c.id=g.client WHERE g.principal=? AND g.active=1 AND g.expires>? ORDER BY g.expires DESC",
      )
      .all(actor.id, agents.now()),
  };
  return shell(
    "Agents",
    `<div id="agents-app" data-state="${escape(JSON.stringify(data))}"><h1>Agents</h1><p>Loading your agents and connections…</p><noscript>Enable JavaScript to manage agents and view your connections.</noscript></div>`,
    { className: "agents-page" },
  );
}
