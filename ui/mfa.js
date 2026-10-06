import {
  startRegistration,
  startAuthentication,
} from "@simplewebauthn/browser";

const page = document.querySelector("#mfa-security, #mfa-login");
let csrf = page?.dataset.csrf,
  totpFlow = null;
const status = document.getElementById("mfa-status");
async function post(url, body) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Wiki-CSRF": csrf },
    body: JSON.stringify(body),
  });
  const value = await response.json();
  if (!response.ok)
    throw Error(value.error || "Verification failed. Try again.");
  if (value.csrf) csrf = value.csrf;
  return value;
}
const security = (action, body = {}) =>
  post("/api/account/security", { action, ...body });
function saved(value) {
  if (!value.recoveryCodes) {
    location.reload();
    return;
  }
  document.getElementById("mfa-totp-setup").hidden = true;
  document.getElementById("mfa-secret-value").value = "";
  document.getElementById("mfa-qr").removeAttribute("src");
  document.getElementById("mfa-enabled-status").textContent =
    "Two-factor authentication is on. Save your recovery codes before continuing.";
  for (const element of page.querySelectorAll(
    "#mfa-methods-section, details, #mfa-recovery-summary",
  ))
    element.hidden = true;
  document.getElementById("mfa-recovery-codes").value =
    value.recoveryCodes.join("\n");
  document.getElementById("mfa-recovery-result").hidden = false;
  document
    .getElementById("mfa-recovery-result")
    .scrollIntoView({ block: "nearest" });
  status.textContent =
    "Saved. Your other sessions have been signed out. Save your recovery codes now.";
}
function on(id, event, callback) {
  const element = document.getElementById(id);
  if (!element) return;
  element.addEventListener(event, async (e) => {
    e.preventDefault();
    const button =
      element.tagName === "FORM" ? element.querySelector("button") : element;
    button.disabled = true;
    status.textContent = "Please wait…";
    try {
      await callback(element);
    } catch (error) {
      status.textContent =
        error.name === "NotAllowedError"
          ? "Passkey verification was cancelled or unavailable. Try again or use another method."
          : error.message;
    } finally {
      button.disabled = false;
    }
  });
}
for (const [id, recovery] of [
  ["mfa-totp-login", false],
  ["mfa-recovery-login", true],
]) {
  on(id, "submit", async (form) => {
    const code = new FormData(form).get("code");
    const result = await post("/auth/mfa/code", { code, recovery });
    form.reset();
    location.assign(result.redirect);
  });
}
on("mfa-passkey-login", "click", async () => {
  const { flow, options } = await post("/auth/mfa/passkey/options", {});
  const response = await startAuthentication({ optionsJSON: options });
  const result = await post("/auth/mfa/passkey/verify", { flow, response });
  location.assign(result.redirect);
});
on("mfa-passkey-enroll", "submit", async (form) => {
  const name = new FormData(form).get("name");
  const { flow, options } = await security("passkey-start");
  const response = await startRegistration({ optionsJSON: options });
  saved(await security("passkey-finish", { flow, response, name }));
});
on("mfa-totp-start", "click", async () => {
  const result = await security("totp-start");
  totpFlow = result.flow;
  document.getElementById("mfa-qr").src = result.qr;
  document.getElementById("mfa-secret-value").value = result.secret;
  document.getElementById("mfa-totp-setup").hidden = false;
  status.textContent = "Scan the QR code, then enter the code from your app.";
});
on("mfa-totp-confirm", "submit", async (form) => {
  saved(
    await security("totp-finish", {
      flow: totpFlow,
      code: new FormData(form).get("code"),
    }),
  );
  form.reset();
});
on("mfa-recovery-generate", "click", async () => {
  if (
    confirm(
      "Replace your existing recovery codes? Old codes will stop working.",
    )
  )
    saved(await security("recovery"));
  else status.textContent = "Cancelled.";
});
on("mfa-disable", "click", async () => {
  if (
    confirm(
      "Turn off two-factor authentication and remove all enrolled methods?",
    )
  )
    saved(await security("disable"));
  else status.textContent = "Cancelled.";
});
for (const button of document.querySelectorAll("[data-remove-factor]")) {
  button.addEventListener("click", async () => {
    if (!confirm("Remove " + button.dataset.factorName + "?")) return;
    button.disabled = true;
    try {
      saved(await security("remove", { factor: button.dataset.removeFactor }));
    } catch (error) {
      status.textContent = error.message;
      button.disabled = false;
    }
  });
}
on("mfa-recovery-download", "click", async () => {
  const codes = document.getElementById("mfa-recovery-codes").value;
  const url = URL.createObjectURL(
    new Blob(
      [
        "Agent Wiki recovery codes — " +
          location.origin +
          "\nKeep private. Each code works once.\n\n" +
          codes +
          "\n",
      ],
      { type: "text/plain" },
    ),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = "agent-wiki-recovery-codes.txt";
  link.click();
  URL.revokeObjectURL(url);
  status.textContent =
    "Recovery codes downloaded. Store the file somewhere private.";
});
