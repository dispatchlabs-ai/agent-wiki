import { request } from "./client.js";
const login = document.querySelector("[data-login-destination]");
const destination = login
  ? login.dataset.loginDestination + location.hash
  : "/";
const provider = document.querySelector(".provider-login");
if (provider && login)
  provider.href = "/auth/login?return_to=" + encodeURIComponent(destination);
const setupToken = location.hash.slice(1);
if (document.querySelector("#local-setup"))
  history.replaceState(null, "", location.pathname);
for (const id of ["local-login", "local-setup", "password-change"]) {
  const form = document.getElementById(id);
  if (!form) continue;
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const status = form.querySelector("[role=status]"),
      button = form.querySelector("button");
    const fields = Object.fromEntries(new FormData(form));
    if (fields.confirm !== undefined && fields.confirm !== fields.password) {
      status.textContent = "The passwords do not match.";
      return;
    }
    button.disabled = true;
    status.textContent = "Please wait…";
    try {
      if (id === "password-change") {
        await request("/auth/local/password", {
          currentPassword: fields.currentPassword,
          password: fields.password,
        });
        form.reset();
        status.textContent =
          "Password changed. Your other sessions are signed out.";
      } else {
        const response = await fetch(
          id === "local-login" ? "/auth/local/login" : "/auth/local/setup",
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "X-Wiki-CSRF": form.dataset.csrf,
            },
            body: JSON.stringify(
              id === "local-login"
                ? { email: fields.email, password: fields.password }
                : { token: setupToken, password: fields.password },
            ),
          },
        );
        const result = await response.json();
        if (!response.ok) throw Error(result.error || "Sign-in failed");
        form.reset();
        // The sign-in form is served at the requested URL. Assigning that same
        // URL with a fragment does not reload it, so fetch the page anew.
        if (login) location.reload();
        else location.href = destination;
      }
    } catch (error) {
      status.textContent = error.message;
    } finally {
      button.disabled = false;
    }
  });
}
