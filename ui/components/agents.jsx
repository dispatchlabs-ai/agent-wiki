// Adapted from shadcn/ui Base UI button, card, badge, native-select and tabs
// patterns (MIT); see docs/shadcn-license.txt. Uses the wiki's semantic tokens.
import React, { useState } from "react";
import { Button, Badge, Field } from "./primitives.mjs";
import { Tabs } from "@base-ui/react/tabs";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "./dialog.jsx";

function Icon({ kind = "agent" }) {
  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {kind === "agent" ? (
        <>
          <rect x="4" y="6" width="16" height="14" rx="4" />
          <path d="M12 3v3M9 12h.01M15 12h.01M9 16h6" />
        </>
      ) : (
        <>
          <path d="m10 13 4-4M8 16l-1 1a4 4 0 0 1-6-6l4-4a4 4 0 0 1 6 0m2 1 1-1a4 4 0 0 1 6 6l-4 4a4 4 0 0 1-6 0" />
        </>
      )}
    </svg>
  );
}
const roles = {
  reader: "Read only",
  editor: "Read & edit",
  manager: "Manage wiki",
};
const permissions = {
  invoke: "Use agent",
  configure: "Edit definition",
  "manage-access": "Manage access",
};
function PersonField({ people }) {
  const [value, setValue] = useState("");
  const person = people.find((p) => p.id === value);
  return (
    <Field
      label="Person"
      hint={
        person
          ? `${person.name} — ${person.identity}`
          : "Check the account identity before sharing."
      }
    >
      <select
        name="principal"
        required
        value={value}
        onChange={(event) => setValue(event.target.value)}
      >
        <option value="" disabled>
          Choose a person
        </option>
        {people.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name} — {p.identity}
          </option>
        ))}
      </select>
    </Field>
  );
}
function Definition({ config, toolNames }) {
  return (
    <>
      <Field
        label="Instructions"
        hint="Describe what this agent should do and how it should work."
      >
        <textarea
          name="instructions"
          required
          maxLength={20000}
          rows={5}
          defaultValue={config?.instructions || ""}
        />
      </Field>
      <Field
        label="Tools"
        hint="One tool name per line. These limit which wiki tools the agent can use."
      >
        <textarea
          className="agent-tools"
          name="tools"
          required
          rows={5}
          defaultValue={(config?.tools || toolNames).join("\n")}
        />
      </Field>
    </>
  );
}
export function AgentsApp({ initial }) {
  const [data, setData] = useState(initial),
    [dialog, setDialog] = useState(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [copied, setCopied] = useState(false);
  const selected = data.agents.find((a) => a.id === dialog?.agent);
  function open(kind, agent) {
    setError("");
    setNotice("");
    setDialog({ kind, agent });
  }
  async function save(fields, message, close = true) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const me = await fetch("/api/me");
      if (!me.ok)
        throw new Error("Your session expired. Sign in again to continue.");
      const { csrf } = await me.json();
      const response = await fetch("/api/agents", {
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
      const page = await fetch("/agents/");
      const element = new DOMParser()
        .parseFromString(await page.text(), "text/html")
        .querySelector("#agents-app");
      if (!element)
        throw new Error(
          "Saved, but the page could not refresh. Reload to see your changes.",
        );
      setData(JSON.parse(element.dataset.state));
      if (close) setDialog(null);
      setNotice(message);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  function submit(event, action) {
    event.preventDefault();
    const fields = Object.fromEntries(new FormData(event.currentTarget));
    if (fields.tools !== undefined) {
      fields.definition = {
        instructions: fields.instructions,
        tools: fields.tools
          .split(/\r?\n/)
          .map((s) => s.trim())
          .filter(Boolean),
      };
      delete fields.instructions;
      delete fields.tools;
    }
    if (action === "role") fields.role ||= null;
    if (action === "permission") fields.enabled = true;
    save(
      { action, ...(selected ? { agent: selected.id } : {}), ...fields },
      action === "create"
        ? "Agent created. Grant wiki access before connecting a client."
        : "Changes saved.",
      action !== "permission",
    );
  }
  return (
    <div className="agents-workspace">
      <div className="agents-heading">
        <div>
          <p className="agent-eyebrow">Your workspace</p>
          <h1>Agents</h1>
          <p className="agents-lede">
            Give your tools a trusted identity in the wiki.
          </p>
        </div>
        <Button variant="primary" onClick={() => open("create")}>
          ＋ Create an agent
        </Button>
      </div>
      <div className="agents-context">
        <span>
          Signed in as <strong>{data.name}</strong>
        </span>
        {data.manager && <Badge>Wiki manager</Badge>}
      </div>
      <div className="agents-layout">
        <div className="agents-main">
          <Tabs.Root defaultValue="agents" className="agent-tabs">
            <Tabs.List aria-label="Agent workspace">
              <Tabs.Tab value="agents">
                Agents <span>{data.agents.length}</span>
              </Tabs.Tab>
              <Tabs.Tab value="connections">
                Your connections <span>{data.connections.length}</span>
              </Tabs.Tab>
            </Tabs.List>
            <Tabs.Panel value="agents">
              <div className="agent-section-heading">
                <h2>Available agents</h2>
                <p>Agents you own or have permission to access.</p>
              </div>
              <div className="agent-grid">
                {data.agents.map((a) => (
                  <section
                    className="agent-card"
                    key={a.id}
                    aria-label={a.name}
                  >
                    <div className="agent-card-heading">
                      <span className="agent-avatar">
                        <Icon />
                      </span>
                      <Badge>
                        {a.owner ? "Owned by you" : "Shared with you"}
                      </Badge>
                    </div>
                    <h3>{a.name}</h3>
                    <p className="agent-description">
                      {a.config?.instructions ||
                        "A dedicated identity for working with the wiki."}
                    </p>
                    <div className="agent-metadata">
                      <span
                        className={`agent-dot ${a.role && a.invoke ? "agent-dot-ready" : ""}`}
                      />
                      <span>
                        {!a.role
                          ? "Needs wiki access"
                          : a.invoke
                            ? "Ready to connect"
                            : "Not shared for use"}
                      </span>
                      <span>·</span>
                      <span>{roles[a.role] || "No wiki access"}</span>
                    </div>
                    <div className="agent-card-actions">
                      {a.configure && (
                        <Button onClick={() => open("edit", a.id)}>
                          Edit agent
                        </Button>
                      )}
                      {(a.manage || data.manager) && (
                        <Button onClick={() => open("access", a.id)}>
                          Permissions
                        </Button>
                      )}
                      {!a.configure && !a.manage && !data.manager && (
                        <span className="agent-muted">
                          Use the connection address to get started.
                        </span>
                      )}
                    </div>
                  </section>
                ))}
              </div>
              {!data.agents.length && (
                <div className="agent-empty">
                  <span className="agent-avatar">
                    <Icon />
                  </span>
                  <h3>A home for your agents</h3>
                  <p>
                    Create your first agent, or ask an owner to share one with
                    you.
                  </p>
                  <Button onClick={() => open("create")}>
                    Create an agent
                  </Button>
                </div>
              )}
            </Tabs.Panel>
            <Tabs.Panel value="connections">
              <div className="agent-section-heading">
                <h2>Your connections</h2>
                <p>
                  Clients you have connected to an agent. Disconnecting ends
                  that client’s access.
                </p>
              </div>
              <div className="agent-connections">
                {data.connections.map((c) => (
                  <section className="agent-connection" key={c.id}>
                    <span className="agent-avatar">
                      <Icon kind="link" />
                    </span>
                    <div>
                      <h3>{c.client}</h3>
                      <p>
                        {c.name}{" "}
                        <span>
                          · Expires{" "}
                          {new Date(c.expires).toLocaleDateString(undefined, {
                            month: "short",
                            day: "numeric",
                            year: "numeric",
                          })}
                        </span>
                      </p>
                    </div>
                    <Button
                      variant="danger"
                      disabled={busy}
                      onClick={() =>
                        save(
                          { action: "revoke", connection: c.id },
                          "Connection disconnected.",
                        )
                      }
                    >
                      Disconnect
                    </Button>
                  </section>
                ))}
              </div>
              {!data.connections.length && (
                <div className="agent-empty">
                  <span className="agent-avatar">
                    <Icon kind="link" />
                  </span>
                  <h3>No active connections</h3>
                  <p>Connect a client to an agent and it will appear here.</p>
                </div>
              )}
            </Tabs.Panel>
          </Tabs.Root>
          {!dialog && error && (
            <p className="agent-feedback" role="alert">
              {error}
            </p>
          )}
          <p className="agent-feedback" role="status">
            {!dialog && notice}
          </p>
        </div>
        <aside className="agent-connect">
          <span className="agent-avatar">
            <Icon kind="link" />
          </span>
          <h2>Connect from anywhere</h2>
          <p>Add this address to your client’s MCP connections.</p>
          <div className="agent-endpoint">
            <code>{data.endpoint}</code>
            <Button
              aria-label="Copy connection address"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(data.endpoint);
                  setCopied(true);
                } catch {
                  setNotice("Select the connection address to copy it.");
                }
              }}
            >
              {copied ? "Copied" : "Copy"}
            </Button>
          </div>
          <ol>
            <li>Add the connection address.</li>
            <li>Sign in with your wiki account.</li>
            <li>Choose an agent shared with you.</li>
          </ol>
          <p className="agent-connect-note">
            The agent runs through the wiki. There’s nothing to install on each
            machine.
          </p>
        </aside>
      </div>
      <Dialog
        open={!!dialog}
        onOpenChange={(value) => {
          if (!value && !busy) setDialog(null);
        }}
      >
        <DialogContent className="agent-dialog" closeLabel="Close dialog">
          <DialogTitle>
            {dialog?.kind === "create"
              ? "Create an agent"
              : dialog?.kind === "edit"
                ? `Edit ${selected?.name || "agent"}`
                : `Permissions · ${selected?.name || "agent"}`}
          </DialogTitle>
          <DialogDescription>
            {dialog?.kind === "access"
              ? "Wiki access controls what the agent can do. People’s permissions control who can use or manage it."
              : "Define a distinct identity with its own instructions and wiki tools."}
          </DialogDescription>
          {(dialog?.kind === "create" || dialog?.kind === "edit") && (
            <form
              key={dialog.kind + (selected?.id || "")}
              data-agent-action={
                dialog.kind === "create" ? "create" : "configure"
              }
              onSubmit={(e) =>
                submit(e, dialog.kind === "create" ? "create" : "configure")
              }
            >
              <fieldset disabled={busy}>
                {dialog.kind === "create" && (
                  <Field label="Name">
                    <input
                      name="name"
                      required
                      maxLength={200}
                      placeholder="e.g. Research assistant"
                    />
                  </Field>
                )}
                <Definition
                  config={selected?.config}
                  toolNames={data.toolNames}
                />
                {dialog.kind === "create" && (
                  <p className="agent-help">
                    A wiki manager must grant wiki access before this agent can
                    be used.
                  </p>
                )}
                <div className="agent-form-actions">
                  <Button onClick={() => setDialog(null)}>Cancel</Button>
                  <Button type="submit" variant="primary">
                    {busy
                      ? "Saving…"
                      : dialog.kind === "create"
                        ? "Create agent"
                        : "Save changes"}
                  </Button>
                </div>
              </fieldset>
            </form>
          )}
          {dialog?.kind === "access" && selected && (
            <div className="agent-access">
              {data.manager && (
                <form
                  data-agent-action="role"
                  onSubmit={(e) => submit(e, "role")}
                >
                  <fieldset disabled={busy}>
                    <h3>Agent capabilities</h3>
                    <Field label="Wiki access">
                      <select name="role" defaultValue={selected.role || ""}>
                        <option value="">None</option>
                        <option value="reader">Read only</option>
                        <option value="editor">Read and edit</option>
                      </select>
                    </Field>
                    <Button type="submit">Save access</Button>
                  </fieldset>
                </form>
              )}
              {selected.manage && (
                <>
                  <div className="agent-section-heading">
                    <h3>People with access</h3>
                    <p>The owner always retains control.</p>
                  </div>
                  {selected.grants.length ? (
                    <ul className="agent-grants">
                      {selected.grants.map((g) => (
                        <li key={g.id + g.permission}>
                          <div>
                            <strong>{g.name}</strong>
                            <small>
                              {data.people.find((p) => p.id === g.id)
                                ?.identity || g.id}
                            </small>
                            <Badge>{permissions[g.permission]}</Badge>
                          </div>
                          <Button
                            variant="danger"
                            disabled={busy}
                            aria-label={`Revoke ${permissions[g.permission]} from ${g.name}`}
                            onClick={() =>
                              save(
                                {
                                  action: "permission",
                                  agent: selected.id,
                                  principal: g.id,
                                  permission: g.permission,
                                  enabled: false,
                                },
                                "Permission revoked.",
                                false,
                              )
                            }
                          >
                            Revoke
                          </Button>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="agent-muted">
                      No additional permissions granted.
                    </p>
                  )}
                  <form
                    data-agent-action="permission"
                    onSubmit={(e) => submit(e, "permission")}
                  >
                    <fieldset disabled={busy}>
                      <h3>Grant permission</h3>
                      <PersonField people={data.people} />
                      <Field label="Permission">
                        <select name="permission">
                          {Object.entries(permissions).map(([value, label]) => (
                            <option value={value} key={value}>
                              {label}
                            </option>
                          ))}
                        </select>
                      </Field>
                      <Button type="submit" variant="primary">
                        Grant permission
                      </Button>
                    </fieldset>
                  </form>
                </>
              )}
            </div>
          )}
          {error && (
            <p className="agent-feedback" role="alert">
              {error}
            </p>
          )}
          <p className="agent-feedback" role="status">
            {notice}
          </p>
        </DialogContent>
      </Dialog>
    </div>
  );
}
