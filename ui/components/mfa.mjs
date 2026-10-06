import { createElement as h } from "react";
import { Button, Field, PageHeading } from "./primitives.mjs";

const script = () =>
  h("script", { type: "module", src: "/assets/vendor/mfa.js" });
const message = () =>
  h("p", {
    role: "status",
    id: "mfa-status",
    className: "auth-status",
    "aria-live": "polite",
  });
const button = (text, props = {}) =>
  h(Button, { type: "button", ...props }, text);
const codeField = (recovery = false) =>
  h(
    Field,
    {
      label: recovery ? "Recovery code" : "Authenticator code",
      id: recovery ? "recovery-code" : "authenticator-code",
    },
    h("input", {
      name: "code",
      required: true,
      autoComplete: "one-time-code",
      inputMode: recovery ? "text" : "numeric",
      pattern: recovery ? undefined : "[0-9]{6}",
      maxLength: recovery ? 40 : 6,
      spellCheck: false,
    }),
  );
function frame(title, description, props, ...children) {
  return h(
    "section",
    { className: "auth-page", ...props },
    h(
      "div",
      { className: "auth-card" },
      h(PageHeading, { title, description }),
      ...children,
      script(),
    ),
  );
}
export function MfaChallenge({ csrf, status }) {
  return frame(
    "Verify your sign-in.",
    "Use one of your enrolled methods to finish signing in.",
    { id: "mfa-login", "data-csrf": csrf },
    status.factors.some((x) => x.kind === "passkey") &&
      button("Use a passkey", { id: "mfa-passkey-login", variant: "primary" }),
    status.factors.some((x) => x.kind === "totp") &&
      h(
        "form",
        { id: "mfa-totp-login", className: "auth-section" },
        codeField(),
        h(Button, { type: "submit", variant: "primary" }, "Verify code"),
      ),
    status.recoveryCodes > 0 &&
      h(
        "details",
        { className: "auth-section" },
        h("summary", null, "Use a recovery code"),
        h(
          "form",
          { id: "mfa-recovery-login" },
          codeField(true),
          h(Button, { type: "submit" }, "Use recovery code"),
        ),
      ),
    message(),
    h("a", { href: "/auth/sign-in" }, "Start over"),
  );
}
const icons = {
  passkey:
    "M21 7a5 5 0 0 1-7.7 4.2L10 14.5H7V18H3v-4l8.2-8.2A5 5 0 0 1 21 7ZM17 7h.01",
  totp: "M8 3h8a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2ZM9 11h.01M12 11h.01M15 11h.01",
  recovery: "M12 3 3 7v5c0 5 9 9 9 9s9-4 9-9V7l-9-4ZM12 8v8M8 12h8",
};
const icon = (kind) =>
  h(
    "svg",
    {
      className: "mfa-icon",
      viewBox: "0 0 24 24",
      fill: "none",
      stroke: "currentColor",
      strokeWidth: 1.6,
      strokeLinecap: "round",
      strokeLinejoin: "round",
      "aria-hidden": true,
    },
    h("path", { d: icons[kind] }),
  );
function method(f, fresh, count) {
  return h(
    "li",
    { className: "mfa-method-card", "data-factor": f.id },
    icon(f.kind),
    h(
      "div",
      { className: "mfa-method-content" },
      h("strong", { "data-factor-label": true }, f.name),
      h(
        "small",
        { "data-factor-date": true },
        "Added ",
        h(
          "time",
          { dateTime: new Date(f.created).toISOString() },
          new Date(f.created).toLocaleDateString("en-US", {
            month: "short",
            day: "numeric",
            year: "numeric",
            timeZone: "UTC",
          }),
        ),
      ),
      h(
        "form",
        { "data-rename-form": true, hidden: true },
        h(
          "label",
          null,
          "Passkey name",
          h("input", {
            name: "name",
            required: true,
            maxLength: 100,
            defaultValue: f.name,
            autoComplete: "off",
          }),
        ),
        h(
          "div",
          { className: "mfa-method-actions" },
          h(Button, { type: "submit" }, "Save name"),
          button("Cancel", { "data-rename-cancel": true }),
        ),
      ),
    ),
    h(
      "div",
      { className: "mfa-method-actions", "data-factor-actions": true },
      button("Rename", {
        className: "mfa-link-button",
        "data-rename-factor": true,
        hidden: f.kind !== "passkey",
        disabled: !fresh,
        "aria-label": "Rename " + f.name,
      }),
      button("Remove", {
        className: "mfa-link-button",
        "data-remove-factor": true,
        hidden: count < 2,
        disabled: !fresh,
        "aria-label": "Remove " + f.name,
      }),
    ),
  );
}
export function Security({ csrf, status, fresh }) {
  const canChange = { disabled: !fresh };
  return h(
    "section",
    {
      className: "auth-page mfa-security-page",
      id: "mfa-security",
      "data-csrf": csrf,
    },
    h(
      "div",
      { className: "auth-card" },
      h(
        "nav",
        { className: "mfa-breadcrumb", "aria-label": "Breadcrumb" },
        h("a", { href: "/account/" }, "Account"),
        " / Security",
      ),
      h(
        "header",
        { className: "mfa-heading" },
        h("h1", { id: "mfa-title", tabIndex: -1 }, "Two-factor authentication"),
        h(
          "p",
          { id: "mfa-description" },
          status.enabled
            ? "Any one of your enrolled methods can finish a sign-in."
            : "Add an extra layer of protection to your Wiki account.",
        ),
        h(
          "span",
          {
            id: "mfa-enabled-status",
            className: "mfa-status-pill",
            "data-enabled": String(status.enabled),
          },
          status.enabled ? "Enabled" : "Not enabled",
        ),
      ),
      !fresh &&
        h(
          "p",
          { role: "alert", className: "mfa-fresh-notice" },
          "Sign out and sign in again before changing security settings. Then return here within five minutes.",
        ),
      h(
        "section",
        {
          id: "mfa-methods-section",
          "aria-labelledby": "mfa-methods-title",
          hidden: !status.factors.length,
        },
        h("h2", { id: "mfa-methods-title" }, "Your methods"),
        h(
          "ul",
          { className: "mfa-methods", id: "mfa-methods" },
          ...status.factors.map((f) => method(f, fresh, status.factors.length)),
        ),
      ),
      ...["passkey", "totp"].map((kind) =>
        h(
          "template",
          { key: kind, id: "mfa-method-template-" + kind },
          method({ id: "", kind, name: "", created: 0 }, true, 2),
        ),
      ),
      h(
        "section",
        {
          id: "mfa-enrollment",
          className: "mfa-cards",
          "aria-label": "Add a method",
        },
        h(
          "section",
          { className: "mfa-choice-card" },
          icon("passkey"),
          h(
            "div",
            null,
            h("h2", null, "Passkey"),
            h("p", null, "Use your device’s fingerprint, face or PIN."),
            h(
              "form",
              { id: "mfa-passkey-enroll" },
              h(
                Button,
                { type: "submit", variant: "primary", ...canChange },
                "Add a passkey",
              ),
            ),
            h(
              "p",
              { className: "mfa-choice-help" },
              "Your device will guide you through setup.",
            ),
          ),
        ),
        !status.factors.some((x) => x.kind === "totp") &&
          h(
            "section",
            { className: "mfa-choice-card" },
            icon("totp"),
            h(
              "div",
              null,
              h("h2", null, "Authenticator app"),
              h(
                "p",
                null,
                "Get verification codes from your authenticator app.",
              ),
              button("Set up authenticator app", {
                id: "mfa-totp-start",
                ...canChange,
              }),
              h(
                "section",
                { id: "mfa-totp-setup", hidden: true },
                h(
                  "h3",
                  { tabIndex: -1 },
                  "Scan this code with your authenticator app",
                ),
                h("img", {
                  id: "mfa-qr",
                  alt: "Authenticator enrollment QR code",
                  width: 240,
                  height: 240,
                }),
                h(
                  Field,
                  { label: "Or enter this setup key", id: "mfa-secret-value" },
                  h("input", {
                    readOnly: true,
                    autoComplete: "off",
                    spellCheck: false,
                  }),
                ),
                h(
                  "p",
                  { className: "auth-help" },
                  "Keep the setup key private. Enter the code from your app to confirm it works.",
                ),
                h(
                  "form",
                  { id: "mfa-totp-confirm" },
                  codeField(),
                  h(
                    Button,
                    { type: "submit", variant: "primary" },
                    "Verify and enable",
                  ),
                ),
                button("Cancel setup", {
                  id: "mfa-totp-cancel",
                  className: "mfa-link-button",
                }),
              ),
            ),
          ),
      ),
      status.enabled &&
        h(
          "section",
          { id: "mfa-recovery-summary", className: "auth-section" },
          h("h2", null, "Recovery"),
          h(
            "p",
            null,
            `${status.recoveryCodes} recovery codes remain. Each code can be used once if you lose access to your other methods.`,
          ),
          button("Generate new recovery codes", {
            id: "mfa-recovery-generate",
            ...canChange,
          }),
        ),
      h(
        "section",
        {
          id: "mfa-recovery-result",
          className: "mfa-choice-card mfa-recovery-card",
          hidden: true,
        },
        icon("recovery"),
        h(
          "div",
          null,
          h("h2", null, "Save your recovery codes"),
          h(
            "p",
            null,
            "Use a code if you lose access to your sign-in methods.",
          ),
          button("Save recovery codes", { id: "mfa-recovery-download" }),
          h(
            "details",
            { id: "mfa-recovery-details" },
            h("summary", null, "View recovery codes"),
            h(
              "p",
              { className: "auth-help" },
              "Store these codes somewhere private. They are shown only once. New codes replace all previous codes.",
            ),
            h("textarea", {
              id: "mfa-recovery-codes",
              readOnly: true,
              rows: 10,
              "aria-label": "Recovery codes",
              spellCheck: false,
            }),
          ),
        ),
      ),
      status.enabled &&
        h(
          "details",
          { id: "mfa-disable-section", className: "auth-section" },
          h("summary", null, "Turn off two-factor authentication"),
          h(
            "p",
            null,
            "This removes all passkeys, the authenticator app, and recovery codes from this Wiki account. Other sessions will be signed out.",
          ),
          button("Turn off two-factor authentication", {
            id: "mfa-disable",
            ...canChange,
          }),
        ),
      message(),
      h(
        "footer",
        { className: "mfa-footer" },
        h(
          "p",
          { id: "mfa-settings-help" },
          "Works with Google and local sign-in.",
          status.enabled &&
            " Adding or removing methods signs out your other Wiki sessions. Agent connections use their own credentials.",
        ),
        h("a", { id: "mfa-back", href: "/account/" }, "Back to your account"),
      ),
      script(),
    ),
  );
}
