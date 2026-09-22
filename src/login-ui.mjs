import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { SignIn, AutoSignIn, Setup, Account } from "../ui/components/auth.mjs";
import { shell } from "./render.mjs";
export function signInPage(auth, local, csrf, destination = "/", notice = "") {
  return shell(
    "Sign in",
    renderToStaticMarkup(
      createElement(SignIn, { auth, local, csrf, destination, notice }),
    ),
    { signedOut: true },
  );
}
export function autoSignInPage(destination, local) {
  return shell(
    "Signing in",
    renderToStaticMarkup(createElement(AutoSignIn, { destination, local })),
    { signedOut: true },
  );
}
export function setupPage(csrf) {
  return shell(
    "Set up your account",
    renderToStaticMarkup(createElement(Setup, { csrf })),
    { signedOut: true },
  );
}
export function accountPage(local) {
  return shell(
    "Your account",
    renderToStaticMarkup(createElement(Account, { local })),
  );
}
