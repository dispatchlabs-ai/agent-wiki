import { shell, escape } from "./render.mjs";

/** Manager-only directory. Reading an agent does not confer permission to use it. */
export function accessDirectory(agents, actor) {
  agents.human(actor);
  const control = agents.control;
  control.require(actor, "manager");
  const people = new Map();
  for (const p of agents.db
    .prepare(
      "SELECT p.id,p.name,p.active,i.issuer,i.subject,l.email FROM principals p LEFT JOIN identities i ON i.principal=p.id LEFT JOIN local_accounts l ON l.principal=p.id WHERE p.kind='human' ORDER BY p.name,i.issuer,i.subject",
    )
    .all()) {
    if (!people.has(p.id))
      people.set(p.id, {
        id: p.id,
        name: p.name,
        active: !!p.active,
        identities: [],
      });
    if (p.issuer)
      people.get(p.id).identities.push({
        issuer: p.issuer,
        subject: p.subject,
        email: p.email || null,
      });
  }
  const permissions = new Map();
  for (const g of agents.db
    .prepare(
      "SELECT agent,principal,permission FROM agent_permissions ORDER BY principal,permission",
    )
    .all()) {
    if (!permissions.has(g.agent)) permissions.set(g.agent, []);
    permissions.get(g.agent).push({
      person: people.get(g.principal) || null,
      permission: g.permission,
    });
  }
  const directory = agents.db
    .prepare(
      `SELECT p.id,p.name,a.owner,a.definition,d.config,g.role,
      (SELECT actor FROM audit WHERE action='agent:create' AND target=p.id ORDER BY id LIMIT 1) AS creator
    FROM principals p LEFT JOIN agents a ON a.id=p.id
    LEFT JOIN agent_definitions d ON d.id=a.definition
    LEFT JOIN grants g ON g.principal=p.id AND g.space='default'
    WHERE p.kind='agent' AND p.active=1 ORDER BY p.name,p.id`,
    )
    .all()
    .map((a) => ({
      id: a.id,
      name: a.name,
      role: a.role,
      creator:
        people.get(a.creator) ||
        (a.creator === "operator"
          ? { id: "operator", name: "Operator", active: true, identities: [] }
          : null),
      owner: people.get(a.owner) || null,
      tools: a.config ? JSON.parse(a.config).tools : null,
      grants: permissions.get(a.id) || [],
      // Preserve agent ownership/sharing authority, even for a wiki manager.
      manage: !!a.definition && agents.allowed(actor, a.id, "manage-access"),
    }));
  return { principals: control.access(), agents: directory };
}

export function accessPage(
  agents,
  actor,
  { localLogin, enrollReader, toolNames },
) {
  const data = {
    ...accessDirectory(agents, actor),
    localLogin,
    enrollReader,
    toolNames,
  };
  return shell(
    "Access",
    `<div id="access-app" data-state="${escape(JSON.stringify(data))}"><h1>Access</h1><p>Loading access controls…</p><noscript>Enable JavaScript to manage wiki access.</noscript></div>`,
    { className: "access-page" },
  );
}
