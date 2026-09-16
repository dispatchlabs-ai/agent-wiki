// Trusted operator bootstrap/recovery. Setup tokens are printed only on request;
// treat the terminal output as a credential and share the URL privately.
import { ControlStore } from "../src/control-store.mjs";
const [action, email, name] = process.argv.slice(2);
const origin = process.env.WIKI_ORIGIN;
if (!origin || new URL(origin).protocol !== "https:")
  throw Error("WIKI_ORIGIN must be the HTTPS wiki origin");
if (!["bootstrap", "reset"].includes(action))
  throw Error(
    "Usage: node scripts/local-account.mjs bootstrap EMAIL NAME | reset EMAIL",
  );
const control = new ControlStore(process.env.WIKI_CONTROL);
try {
  const result =
    action === "bootstrap"
      ? control.bootstrapLocal(email, name)
      : control.resetLocal(email);
  console.log(
    JSON.stringify({
      principal: result.id,
      setup_url: origin + "/auth/local/setup#" + result.token,
      expires_in_hours: 24,
    }),
  );
} finally {
  control.close();
}
