import { shell, escape } from "./render.mjs";
const passwordField = (label, name, autocomplete = "new-password") =>
  `<label>${label}<input name="${name}" type="password" autocomplete="${autocomplete}" required minlength="15" maxlength="1024"></label>`;
const status = '<p role="status" class="auth-status"></p>';
const script = '<script type="module" src="/assets/auth.js"></script>';
export function signInPage(auth, local, csrf, destination = "/") {
  return shell(
    "Sign in",
    `<section class="sign-in" data-login-destination="${escape(destination)}"><p class="eyebrow">Your wiki</p><h1>Welcome back.</h1><p>Sign in to the spaces shared with you.</p>${auth ? `<a class="provider-login" href="/auth/login?return_to=${encodeURIComponent(destination)}">${escape(auth.label || "Continue to sign in")}</a>` : ""}${local ? `${auth ? '<p class="login-divider">or use your wiki account</p>' : ""}<form id="local-login" data-csrf="${csrf}"><label>Email<input name="email" type="email" autocomplete="username" required maxlength="254"></label>${passwordField("Password", "password", "current-password")}<button>Sign in</button>${status}</form><p class="login-help">New here? Ask a space manager for a setup link. For a forgotten password, contact the wiki operator.</p>` : ""}${!auth && !local ? "<p>Sign-in has not been configured.</p>" : ""}</section>${script}`,
  );
}
export function setupPage(csrf) {
  return shell(
    "Set up your account",
    `<section class="sign-in"><p class="eyebrow">Your wiki account</p><h1>Choose your password.</h1><p>Use at least 15 characters. A memorable passphrase works well.</p><form id="local-setup" data-csrf="${csrf}">${passwordField("Password", "password")}${passwordField("Confirm password", "confirm")}<button>Set password and sign in</button>${status}</form></section>${script}`,
  );
}
export function accountPage(local) {
  return shell(
    "Your account",
    `<section class="sign-in"><h1>Your account</h1><p><a href="/agents/">Agents and connections</a></p>${local ? `<p>Changing your password signs out your other sessions.</p><form id="password-change">${passwordField("Current password", "currentPassword", "current-password")}${passwordField("New password", "password")}${passwordField("Confirm new password", "confirm")}<button>Change password</button>${status}</form>` : "<p>You sign in through an identity provider. Manage your password with that provider.</p>"}</section>${script}`,
  );
}
