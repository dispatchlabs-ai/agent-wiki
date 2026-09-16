import { createElement as h } from "react";
import {
  Button,
  Field,
  PageHeading,
  Badge,
  EmptyState,
} from "./primitives.mjs";
const status = () => h("p", { role: "status", className: "auth-status" });
const password = (label, name, autocomplete = "new-password") =>
  h(
    Field,
    { label, id: `auth-${name}` },
    h("input", {
      name,
      type: "password",
      autoComplete: autocomplete,
      required: true,
      minLength: 15,
      maxLength: 1024,
    }),
  );
function Frame({ title, description, children, ...props }) {
  return h(
    "section",
    { className: "auth-page", ...props },
    h(
      "div",
      { className: "auth-card" },
      h(PageHeading, { title, description }),
      children,
    ),
  );
}
const submit = (label) =>
  h(Button, { type: "submit", variant: "primary" }, label);
const script = () => h("script", { type: "module", src: "/assets/auth.js" });
export function SignIn({ auth, local, csrf, destination }) {
  return h(
    Frame,
    {
      title: "Welcome back.",
      description: "Sign in to the spaces shared with you.",
      "data-login-destination": destination,
    },
    auth &&
      h(
        "a",
        {
          className: "ui-button provider-login",
          href: "/auth/login?return_to=" + encodeURIComponent(destination),
        },
        auth.label || "Continue to sign in",
      ),
    local &&
      h(
        "div",
        null,
        auth &&
          h("p", { className: "auth-divider" }, "or use your wiki account"),
        h(
          "form",
          { id: "local-login", "data-csrf": csrf },
          h(
            Field,
            { label: "Email", id: "auth-email" },
            h("input", {
              name: "email",
              type: "email",
              autoComplete: "username",
              required: true,
              maxLength: 254,
            }),
          ),
          password("Password", "password", "current-password"),
          submit("Sign in"),
          status(),
        ),
        h(
          "p",
          { className: "auth-help" },
          "New here? Ask a space manager for a setup link. For a forgotten password, contact the wiki operator.",
        ),
      ),
    !auth &&
      !local &&
      h(EmptyState, { title: "Sign-in has not been configured." }),
    script(),
  );
}
export function Setup({ csrf }) {
  return h(
    Frame,
    {
      title: "Choose your password.",
      description:
        "Use at least 15 characters. A memorable passphrase works well.",
    },
    h(
      "form",
      { id: "local-setup", "data-csrf": csrf },
      password("Password", "password"),
      password("Confirm password", "confirm"),
      submit("Set password and sign in"),
      status(),
    ),
    script(),
  );
}
export function Account({ local }) {
  return h(
    Frame,
    {
      title: "Your account",
      description: "Manage your sign-in and agent connections.",
    },
    h(
      "a",
      { className: "ui-button auth-connections", href: "/agents/" },
      "Agents and connections",
    ),
    local
      ? h(
          "section",
          { className: "auth-section", "aria-labelledby": "password-heading" },
          h("h2", { id: "password-heading" }, "Change password"),
          h(
            "p",
            { className: "auth-help" },
            "Use at least 15 characters. Changing your password signs out your other sessions.",
          ),
          h(
            "form",
            { id: "password-change" },
            password("Current password", "currentPassword", "current-password"),
            password("New password", "password"),
            password("Confirm new password", "confirm"),
            submit("Change password"),
            status(),
          ),
        )
      : h(
          "p",
          { className: "auth-help" },
          "You sign in through an identity provider. Manage your password with that provider.",
        ),
    script(),
  );
}
export function AgentConsent({ actor, request, params, csrf, choices }) {
  return h(
    Frame,
    {
      title: "Choose an agent",
      description: h(
        "span",
        null,
        "Signed in as ",
        h("strong", null, actor.name),
        ".",
      ),
    },
    h(
      "p",
      { className: "auth-intro" },
      "Allow ",
      h("strong", null, request.name),
      " to use the selected agent's wiki access.",
    ),
    h(
      "p",
      { className: "auth-help" },
      "This client name is supplied by the application. Continue only if you started this connection.",
    ),
    h(
      "form",
      { id: "agent-consent", method: "post", action: "/oauth/authorize" },
      ...[...params].map(([name, value]) =>
        h("input", { key: name, type: "hidden", name, value }),
      ),
      h("input", { type: "hidden", name: "csrf", value: csrf }),
      choices.length
        ? h(
            "fieldset",
            { className: "auth-agent-options" },
            h("legend", null, "Available agents"),
            ...choices.map((a) =>
              h(
                "label",
                { key: a.id, className: "auth-agent-choice" },
                h("input", {
                  type: "radio",
                  name: "agent",
                  value: a.id,
                  required: true,
                  "aria-label": `${a.name} — ${a.role === "editor" ? "read and edit" : "read only"}`,
                }),
                h(
                  "span",
                  null,
                  h("strong", null, a.name),
                  h(
                    Badge,
                    null,
                    a.role === "editor" ? "Read and edit" : "Read only",
                  ),
                ),
              ),
            ),
          )
        : h(
            EmptyState,
            { title: "No agents are available" },
            "Ask an agent owner to grant you permission to use one.",
          ),
      h(
        "p",
        { className: "auth-help" },
        "The connection lasts up to 30 days. You can revoke it in ",
        h("a", { href: "/agents/" }, "Agents"),
        ". Each operation records you as the initiator and the agent as the actor.",
      ),
      h(
        "div",
        { className: "auth-actions" },
        choices.length > 0 &&
          h(
            Button,
            {
              type: "submit",
              variant: "primary",
              name: "decision",
              value: "allow",
            },
            "Connect",
          ),
        h(
          Button,
          {
            type: "submit",
            name: "decision",
            value: "deny",
            formNoValidate: true,
          },
          "Cancel",
        ),
      ),
      status(),
    ),
    h(
      "details",
      { className: "auth-return" },
      h("summary", null, "Connection details"),
      h("p", null, "Return address: ", h("code", null, request.redirect)),
    ),
    h("script", { type: "module", src: "/assets/agent-consent.js" }),
  );
}
