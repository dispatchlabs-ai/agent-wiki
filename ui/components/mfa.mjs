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
export function Security({ csrf, status, fresh }) {
  const canChange = { disabled: !fresh };
  return frame(
    "Two-factor authentication",
    "Add a passkey or authenticator app to protect your Google or local Wiki sign-in.",
    { id: "mfa-security", "data-csrf": csrf },
    h(
      "p",
      { id: "mfa-enabled-status", className: "auth-help" },
      status.enabled
        ? "Two-factor authentication is on. Any one of your enrolled methods can finish a sign-in."
        : "Two-factor authentication is off. Verify a method below to turn it on.",
    ),
    !fresh &&
      h(
        "p",
        { role: "alert", className: "auth-help" },
        "Sign out and sign in again before changing security settings. Then return here within five minutes.",
      ),
    h(
      "section",
      {
        id: "mfa-methods-section",
        className: "auth-section",
        "aria-labelledby": "mfa-methods-title",
      },
      h("h2", { id: "mfa-methods-title" }, "Your methods"),
      status.factors.length
        ? h(
            "ul",
            { className: "mfa-methods" },
            ...status.factors.map((f) =>
              h(
                "li",
                { key: f.id },
                h(
                  "span",
                  null,
                  h("strong", null, f.name),
                  h(
                    "small",
                    null,
                    f.kind === "passkey" ? "Passkey" : "Authenticator app",
                  ),
                ),
                status.factors.length > 1 &&
                  button("Remove", {
                    ...canChange,
                    "data-remove-factor": f.id,
                    "data-factor-name": f.name,
                    "aria-label": "Remove " + f.name,
                  }),
              ),
            ),
          )
        : h("p", null, "No methods enrolled yet."),
      h(
        "form",
        { id: "mfa-passkey-enroll" },
        h(
          Field,
          { label: "Passkey name", id: "passkey-name" },
          h("input", {
            name: "name",
            required: true,
            maxLength: 100,
            placeholder: "For example, personal phone",
            ...canChange,
          }),
        ),
        h(Button, { type: "submit", ...canChange }, "Add a passkey"),
      ),
      h(
        "p",
        { className: "auth-help" },
        "Your device will ask for its PIN, fingerprint, or face verification. You can enroll more than one passkey.",
      ),
      !status.factors.some((x) => x.kind === "totp") &&
        button("Set up authenticator app", {
          id: "mfa-totp-start",
          ...canChange,
        }),
      h(
        "section",
        { id: "mfa-totp-setup", hidden: true },
        h("h3", null, "Scan this code with your authenticator app"),
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
            id: "mfa-secret-value",
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
      { id: "mfa-recovery-result", className: "auth-section", hidden: true },
      h("h2", null, "Save your recovery codes"),
      h(
        "p",
        null,
        "Store these codes somewhere private, separate from your devices. They are shown only once. New codes replace all previous codes.",
      ),
      h("textarea", {
        id: "mfa-recovery-codes",
        readOnly: true,
        rows: 10,
        "aria-label": "Recovery codes",
        spellCheck: false,
      }),
      button("Download recovery codes", { id: "mfa-recovery-download" }),
      h(
        "a",
        { href: "/account/security/", className: "ui-button" },
        "I saved my codes",
      ),
    ),
    status.enabled &&
      h(
        "details",
        { className: "auth-section" },
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
      "p",
      { className: "auth-help" },
      "Security changes sign out your other Wiki sessions. Existing agent connections use their own credentials.",
    ),
    h("a", { href: "/account/" }, "Back to your account"),
  );
}
