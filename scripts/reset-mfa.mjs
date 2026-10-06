// Trusted operator recovery only. This is deliberately unavailable over HTTP.
import { ControlStore } from "../src/control-store.mjs";
import { Mfa } from "../src/mfa.mjs";

const [principal, ...extra] = process.argv.slice(2);
if (
  !principal ||
  extra.length ||
  !process.env.WIKI_CONTROL ||
  !process.env.WIKI_ORIGIN
)
  throw Error(
    "Usage: WIKI_CONTROL=... WIKI_ORIGIN=https://... node scripts/reset-mfa.mjs PRINCIPAL_UUID",
  );
const control = new ControlStore(process.env.WIKI_CONTROL);
try {
  const mfa = new Mfa(control, process.env.WIKI_ORIGIN);
  control.transaction(() => {
    mfa.active(principal);
    control.db
      .prepare("DELETE FROM mfa_factors WHERE principal=?")
      .run(principal);
    control.db
      .prepare("DELETE FROM mfa_recovery WHERE principal=?")
      .run(principal);
    mfa.clearTransient(principal);
    mfa.audit("operator", "mfa:operator-reset", principal);
  });
  console.log(
    JSON.stringify({
      principal,
      two_factor_enabled: false,
      sessions_revoked: true,
    }),
  );
} finally {
  control.close();
}
