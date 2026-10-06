import React, { useRef, useState } from "react";
import { Tabs } from "@base-ui/react/tabs";
import { Button, Badge, Field } from "./primitives.mjs";
import { Dialog, DialogContent, DialogTitle } from "./dialog.jsx";
import { Definition, Icon } from "./agents.jsx";

const roles = {
  reader: "Read only",
  editor: "Read and edit",
  manager: "Manager",
};
const permissions = {
  invoke: "Use",
  configure: "Edit definition",
  "manage-access": "Manage access",
};
const provider = (identity) =>
  identity.issuer === "urn:agentic-wiki:local"
    ? "Wiki account"
    : identity.issuer === "https://accounts.google.com"
      ? "Google"
      : identity.issuer;
const identityText = (identity) =>
  `${provider(identity)} · ${identity.email || identity.subject}`;

function Person({ person, details = false }) {
  if (!person) return <span className="access-muted">Not recorded</span>;
  return (
    <div className="access-person">
      <span>
        {person.name}
        {!person.active && <small> (disabled)</small>}
      </span>
      {person.identities.map((i) => (
        <small key={`${i.issuer}:${i.subject}`}>
          {details ? identityText(i) : provider(i)}
        </small>
      ))}
    </div>
  );
}

function RoleOptions({ human = false }) {
  return (
    <>
      <option value="">None</option>
      <option value="reader">Read only</option>
      <option value="editor">Read and edit</option>
      {human && <option value="manager">Manager</option>}
    </>
  );
}

export function AccessApp({ initial }) {
  const [data, setData] = useState(initial);
  const [view, setView] = useState(
    location.hash === "#agents" ? "agents" : "people",
  );
  const [selectedId, setSelectedId] = useState(initial.agents[0]?.id);
  const [query, setQuery] = useState("");
  const [role, setRole] = useState("all");
  const [dialog, setDialog] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [savedPerson, setSavedPerson] = useState(null);
  const [inviteLink, setInviteLink] = useState("");
  const detailHeading = useRef(null);
  const selected = data.agents.find((a) => a.id === selectedId);
  const people = data.principals.filter((p) => p.kind === "human");
  const visibleAgents = data.agents.filter(
    (a) =>
      (role === "all" || (a.role || "") === role) &&
      [a.name, a.creator?.name, a.owner?.name]
        .join(" ")
        .toLocaleLowerCase()
        .includes(query.toLocaleLowerCase()),
  );

  function open(kind) {
    setError("");
    setNotice("");
    setDialog(kind);
  }

  async function mutate(
    url,
    fields,
    { message = "Changes saved.", close = false } = {},
  ) {
    setBusy(true);
    setError("");
    setNotice("");
    setSavedPerson(null);
    try {
      const me = await fetch("/api/me");
      if (!me.ok)
        throw new Error("Your session expired. Sign in again to continue.");
      const { csrf } = await me.json();
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Wiki-Write": "1",
          "X-Wiki-CSRF": csrf,
        },
        body: JSON.stringify(fields),
      });
      const result = await response.json();
      if (!response.ok)
        throw new Error(result.error || "Could not save changes.");
      // Retain a newly created invitation even if the directory refresh fails.
      if (url === "/api/access/invitations") setInviteLink(result.url);
      const refreshed = await fetch("/api/access");
      if (!refreshed.ok)
        throw new Error(
          "Saved, but the directory could not refresh. Reload this page.",
        );
      const directory = await refreshed.json();
      setData((current) => ({ ...current, ...directory }));
      if (fields.action === "create") {
        setView("agents");
        setQuery("");
        setRole("all");
        setSelectedId(result.id);
      }
      if (url === "/api/access") setSavedPerson(fields.principal);
      setNotice(message);
      if (close) setDialog(null);
      return true;
    } catch (e) {
      setError(e.message || "Could not save changes.");
      return false;
    } finally {
      setBusy(false);
    }
  }

  function selectAgent(id) {
    setSelectedId(id);
    setError("");
    setNotice("");
    // On a narrow screen the detail panel follows the list in document order.
    if (matchMedia("(max-width: 850px)").matches)
      requestAnimationFrame(() => detailHeading.current?.focus());
  }

  return (
    <div className="access-workspace">
      <header className="access-heading">
        <h1>Access</h1>
        {view === "agents" && (
          <Button variant="primary" onClick={() => open("create")}>
            ＋ Create agent
          </Button>
        )}
      </header>
      <Tabs.Root
        className="access-tabs"
        value={view}
        onValueChange={(next) => {
          setView(next);
          setError("");
          setNotice("");
          history.replaceState(null, "", `#${next}`);
        }}
      >
        <Tabs.List aria-label="Access directory">
          <Tabs.Tab value="people">People</Tabs.Tab>
          <Tabs.Tab value="agents">Agents</Tabs.Tab>
        </Tabs.List>
        <Tabs.Panel value="people">
          {data.localLogin && (
            <details className="invite-account">
              <summary>Invite someone without Google</summary>
              <form
                id="invite-local"
                onSubmit={async (event) => {
                  event.preventDefault();
                  const form = event.currentTarget;
                  if (
                    await mutate(
                      "/api/access/invitations",
                      Object.fromEntries(new FormData(form)),
                      {
                        message:
                          "Setup link created. Share it privately with this person.",
                      },
                    )
                  )
                    form.reset();
                }}
              >
                <fieldset disabled={busy}>
                  <Field label="Name">
                    <input name="name" required maxLength={200} />
                  </Field>
                  <Field label="Email">
                    <input name="email" type="email" required maxLength={254} />
                  </Field>
                  <Button type="submit">Create setup link</Button>
                </fieldset>
                {inviteLink && (
                  <Field label="Private setup link">
                    <input readOnly value={inviteLink} />
                  </Field>
                )}
              </form>
              <p>
                The setup link expires in 24 hours. Grant wiki access
                separately.
              </p>
            </details>
          )}
          <div id="access" className="access-people">
            {people.map((p) => (
              <form
                key={`${p.id}:${p.issuer}:${p.subject}`}
                onSubmit={(event) => {
                  event.preventDefault();
                  mutate("/api/access", {
                    principal: p.id,
                    role: new FormData(event.currentTarget).get("role") || null,
                  });
                }}
              >
                <div className="access-person">
                  <strong>{p.name}</strong>
                  <small>
                    {p.email
                      ? `Wiki account · ${p.email}${p.local_ready ? "" : " · awaiting setup"}`
                      : `${provider(p)} · ${p.subject || p.id}`}
                  </small>
                </div>
                <fieldset disabled={busy}>
                  <select
                    key={p.role || "none"}
                    name="role"
                    aria-label={`${p.name} access`}
                    defaultValue={p.role || ""}
                  >
                    <RoleOptions human />
                  </select>
                  <Button type="submit">Save access</Button>
                </fieldset>
                <span role="status">{savedPerson === p.id ? "Saved" : ""}</span>
              </form>
            ))}
          </div>
        </Tabs.Panel>
        <Tabs.Panel value="agents">
          <div className="access-layout">
            <section className="access-directory" aria-label="All agents">
              <div className="access-toolbar">
                <h2>Agents</h2>
                <input
                  type="search"
                  aria-label="Search agents"
                  placeholder="Search agents"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
                <select
                  aria-label="Filter wiki access"
                  value={role}
                  onChange={(e) => setRole(e.target.value)}
                >
                  <option value="all">All permissions</option>
                  <RoleOptions />
                </select>
              </div>
              <table className="access-agent-table">
                <thead>
                  <tr>
                    <th scope="col">Agent</th>
                    <th scope="col">Created by</th>
                    <th scope="col">Wiki access</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleAgents.map((a) => (
                    <tr
                      key={a.id}
                      data-selected={a.id === selectedId || undefined}
                    >
                      <td>
                        <button
                          className="access-agent-select"
                          aria-pressed={a.id === selectedId}
                          onClick={() => selectAgent(a.id)}
                        >
                          <span className="access-agent-icon">
                            <Icon />
                          </span>
                          <span>{a.name}</span>
                        </button>
                      </td>
                      <td>
                        <Person person={a.creator} />
                      </td>
                      <td>{roles[a.role] || "None"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!visibleAgents.length && (
                <p className="access-empty">
                  {data.agents.length
                    ? "No agents match these filters."
                    : "No agents have been created."}
                </p>
              )}
            </section>
            {selected && (
              <aside
                className="access-detail"
                aria-label="Agent details"
                key={selected.id}
              >
                <h2 ref={detailHeading} tabIndex={-1}>
                  {selected.name}
                </h2>
                <dl className="access-metadata">
                  <div>
                    <dt>Created by</dt>
                    <dd>
                      <Person person={selected.creator} />
                    </dd>
                  </div>
                  <div>
                    <dt>Owner</dt>
                    <dd>
                      <Person person={selected.owner} />
                    </dd>
                  </div>
                </dl>
                {(selected.creator?.identities.length ||
                  selected.owner?.identities.length) > 0 && (
                  <details className="access-identities">
                    <summary>Account details</summary>
                    <dl>
                      <dt>Created by</dt>
                      <dd>
                        <Person person={selected.creator} details />
                      </dd>
                      <dt>Owner</dt>
                      <dd>
                        <Person person={selected.owner} details />
                      </dd>
                    </dl>
                  </details>
                )}
                <section>
                  <form
                    aria-label="Agent wiki access"
                    onSubmit={(event) => {
                      event.preventDefault();
                      mutate("/api/access", {
                        principal: selected.id,
                        role:
                          new FormData(event.currentTarget).get("role") || null,
                      });
                    }}
                  >
                    <fieldset disabled={busy}>
                      <Field label="Wiki access">
                        <select
                          key={selected.role || "none"}
                          name="role"
                          defaultValue={selected.role || ""}
                        >
                          <RoleOptions />
                        </select>
                      </Field>
                      <Button variant="primary" type="submit">
                        {busy ? "Saving…" : "Save"}
                      </Button>
                    </fieldset>
                  </form>
                </section>
                <section>
                  <div className="access-section-heading">
                    <h3>Who can use this agent</h3>
                    {selected.manage && (
                      <Button onClick={() => open("share")}>
                        ＋ Add person
                      </Button>
                    )}
                  </div>
                  <ul className="access-grants">
                    {selected.owner && (
                      <li>
                        <Person person={selected.owner} />
                        <Badge>Owner</Badge>
                      </li>
                    )}
                    {selected.grants.map((g) => (
                      <li key={`${g.person?.id}:${g.permission}`}>
                        <Person person={g.person} />
                        <Badge>{permissions[g.permission]}</Badge>
                        {selected.manage && g.person?.active && (
                          <Button
                            disabled={busy}
                            aria-label={`Revoke ${permissions[g.permission]} from ${g.person.name}`}
                            onClick={() =>
                              mutate("/api/agents", {
                                action: "permission",
                                agent: selected.id,
                                principal: g.person.id,
                                permission: g.permission,
                                enabled: false,
                              })
                            }
                          >
                            Revoke
                          </Button>
                        )}
                      </li>
                    ))}
                    {!selected.owner && !selected.grants.length && (
                      <li className="access-muted">No people are recorded.</li>
                    )}
                  </ul>
                </section>
                <section>
                  <h3>Enabled tools</h3>
                  {selected.tools === null ? (
                    <p className="access-muted">Not recorded</p>
                  ) : selected.tools.length ? (
                    <ul className="access-tools">
                      {selected.tools.map((tool) => (
                        <li key={tool}>
                          <code>{tool}</code>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="access-muted">None</p>
                  )}
                </section>
              </aside>
            )}
          </div>
        </Tabs.Panel>
      </Tabs.Root>
      {!dialog && error && (
        <p role="alert" className="access-feedback">
          {error}
        </p>
      )}
      <p role="status" className="access-feedback">
        {!dialog && notice}
      </p>
      <Dialog
        open={!!dialog}
        onOpenChange={(value) => {
          if (!value && !busy) setDialog(null);
        }}
      >
        <DialogContent className="agent-dialog" closeLabel="Close dialog">
          <DialogTitle>
            {dialog === "create" ? "Create agent" : "Add person"}
          </DialogTitle>
          {dialog === "create" && (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                const f = Object.fromEntries(new FormData(event.currentTarget));
                mutate(
                  "/api/agents",
                  {
                    action: "create",
                    name: f.name,
                    definition: {
                      instructions: f.instructions,
                      tools: f.tools
                        .split(/\r?\n/)
                        .map((s) => s.trim())
                        .filter(Boolean),
                    },
                  },
                  {
                    close: true,
                    message: "Agent created. Choose its wiki access.",
                  },
                );
              }}
            >
              <fieldset disabled={busy}>
                <Field label="Name">
                  <input name="name" required maxLength={200} />
                </Field>
                <Definition toolNames={data.toolNames} />
                <div className="agent-form-actions">
                  <Button onClick={() => setDialog(null)}>Cancel</Button>
                  <Button variant="primary" type="submit">
                    Create agent
                  </Button>
                </div>
              </fieldset>
            </form>
          )}
          {dialog === "share" && selected?.manage && (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                mutate(
                  "/api/agents",
                  {
                    action: "permission",
                    agent: selected.id,
                    ...Object.fromEntries(new FormData(event.currentTarget)),
                    enabled: true,
                  },
                  { close: true },
                );
              }}
            >
              <fieldset disabled={busy}>
                <Field label="Person">
                  <select name="principal" required defaultValue="">
                    <option value="" disabled>
                      Choose a person
                    </option>
                    {people.map((p) => (
                      <option
                        key={`${p.id}:${p.issuer}:${p.subject}`}
                        value={p.id}
                      >
                        {p.name} — {identityText(p)}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Permission">
                  <select name="permission">
                    <option value="invoke">Use agent</option>
                    <option value="configure">Edit definition</option>
                    <option value="manage-access">Manage access</option>
                  </select>
                </Field>
                <div className="agent-form-actions">
                  <Button onClick={() => setDialog(null)}>Cancel</Button>
                  <Button variant="primary" type="submit">
                    Grant permission
                  </Button>
                </div>
              </fieldset>
            </form>
          )}
          {error && (
            <p role="alert" className="access-feedback">
              {error}
            </p>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
