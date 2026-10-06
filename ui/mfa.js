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
function renderMethods(value) {
  const list = document.getElementById("mfa-methods");
  list.replaceChildren(
    ...value.factors.map((factor) => {
      const row = document
        .getElementById("mfa-method-template-" + factor.kind)
        .content.firstElementChild.cloneNode(true);
      row.dataset.factor = factor.id;
      row.querySelector("[data-factor-label]").textContent = factor.name;
      row.querySelector("input").value = factor.name;
      const date = new Date(factor.created),
        today = new Date();
      row.querySelector("[data-factor-date]").textContent =
        date.toDateString() === today.toDateString()
          ? "Added today"
          : "Added " +
            date.toLocaleDateString(undefined, {
              month: "short",
              day: "numeric",
              year: "numeric",
            });
      const rename = row.querySelector("[data-rename-factor]");
      rename.hidden = factor.kind !== "passkey";
      rename.setAttribute("aria-label", "Rename " + factor.name);
      const remove = row.querySelector("[data-remove-factor]");
      remove.hidden = value.factors.length < 2;
      remove.setAttribute("aria-label", "Remove " + factor.name);
      return row;
    }),
  );
  document.getElementById("mfa-methods-section").hidden = !value.factors.length;
}
function clearTotp() {
  const setup = document.getElementById("mfa-totp-setup");
  if (!setup) return;
  setup.hidden = true;
  document.getElementById("mfa-secret-value").value = "";
  document.getElementById("mfa-qr").removeAttribute("src");
  document.getElementById("mfa-totp-confirm").reset();
  totpFlow = null;
}
function saved(value, title) {
  if (!title) {
    location.reload();
    return;
  }
  clearTotp();
  renderMethods(value.status);
  page.classList.add("mfa-complete");
  document.getElementById("mfa-title").textContent = title;
  document.getElementById("mfa-description").textContent =
    "Two-factor authentication is now on.";
  const badge = document.getElementById("mfa-enabled-status");
  badge.textContent = "Enabled";
  badge.dataset.enabled = "true";
  for (const element of page.querySelectorAll(
    "#mfa-enrollment, #mfa-disable-section, #mfa-recovery-summary, #mfa-settings-help",
  ))
    element.hidden = true;
  if (value.recoveryCodes) {
    document.getElementById("mfa-recovery-codes").value =
      value.recoveryCodes.join("\n");
    document.getElementById("mfa-recovery-result").hidden = false;
  }
  const back = document.getElementById("mfa-back");
  back.href = "/account/security/";
  back.textContent = "Back to security";
  status.textContent = value.recoveryCodes
    ? "Your other sessions have been signed out. Save your recovery codes before leaving this page."
    : "Your other sessions have been signed out.";
  document.getElementById("mfa-title").focus();
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
on("mfa-passkey-enroll", "submit", async () => {
  const { flow, options } = await security("passkey-start");
  const response = await startRegistration({ optionsJSON: options });
  saved(await security("passkey-finish", { flow, response }), "Passkey added");
});
on("mfa-totp-start", "click", async () => {
  const result = await security("totp-start");
  totpFlow = result.flow;
  document.getElementById("mfa-qr").src = result.qr;
  document.getElementById("mfa-secret-value").value = result.secret;
  document.getElementById("mfa-totp-setup").hidden = false;
  document.querySelector("#mfa-totp-setup h3").focus();
  status.textContent = "Scan the QR code, then enter the code from your app.";
});
on("mfa-totp-cancel", "click", async () => {
  clearTotp();
  document.getElementById("mfa-totp-start").focus();
  status.textContent = "Setup cancelled. No authenticator app was added.";
});
on("mfa-totp-confirm", "submit", async (form) => {
  saved(
    await security("totp-finish", {
      flow: totpFlow,
      code: new FormData(form).get("code"),
    }),
    "Authenticator app added",
  );
  form.reset();
});
on("mfa-recovery-generate", "click", async () => {
  if (
    confirm(
      "Replace your existing recovery codes? Old codes will stop working.",
    )
  )
    saved(await security("recovery"), "Recovery codes ready");
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
page?.addEventListener("click", async (event) => {
  const button = event.target.closest(
    "[data-rename-factor], [data-rename-cancel], [data-remove-factor]",
  );
  if (!button || button.disabled) return;
  const row = button.closest("[data-factor]");
  const form = row.querySelector("form");
  const name = row.querySelector("[data-factor-label]").textContent;
  if (button.hasAttribute("data-rename-factor")) {
    form.hidden = false;
    row.querySelector("[data-factor-actions]").hidden = true;
    form.querySelector("input").value = name;
    form.querySelector("input").focus();
    form.querySelector("input").select();
  } else if (button.hasAttribute("data-rename-cancel")) {
    form.hidden = true;
    row.querySelector("[data-factor-actions]").hidden = false;
    row.querySelector("[data-rename-factor]").focus();
  } else if (confirm("Remove " + name + "?")) {
    button.disabled = true;
    try {
      saved(await security("remove", { factor: row.dataset.factor }));
    } catch (error) {
      status.textContent = error.message;
      button.disabled = false;
    }
  }
});
page?.addEventListener("submit", async (event) => {
  const form = event.target.closest("[data-rename-form]");
  if (!form) return;
  event.preventDefault();
  const row = form.closest("[data-factor]");
  const id = row.dataset.factor;
  const submit = form.querySelector("button[type=submit]");
  submit.disabled = true;
  try {
    const value = await security("rename", {
      factor: id,
      name: new FormData(form).get("name"),
    });
    renderMethods(value.status);
    const updated = [...page.querySelectorAll("[data-factor]")].find(
      (item) => item.dataset.factor === id,
    );
    updated.querySelector("[data-rename-factor]").focus();
    status.textContent = "Passkey renamed.";
  } catch (error) {
    status.textContent = error.message;
    submit.disabled = false;
  }
});
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
