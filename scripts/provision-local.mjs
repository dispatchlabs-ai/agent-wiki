// Noninteractive empty-install bootstrap. The password arrives only through the
// operator's secret environment; it is never printed or replaced on repeat runs.
import { ControlStore } from "../src/control-store.mjs";
import { hashPassword } from "../src/passwords.mjs";
const [email, name] = process.argv.slice(2);
if (!process.env.WIKI_CONTROL) throw Error("WIKI_CONTROL is required");
const password = await hashPassword(process.env.WIKI_BOOTSTRAP_PASSWORD);
const control = new ControlStore(process.env.WIKI_CONTROL);
try {
  const setup = control.bootstrapLocal(email, name);
  const session = control.acceptInvitation(setup.token, password);
  control.logout(session.token);
  console.log(JSON.stringify({ principal: setup.id, initialized: true }));
} finally {
  control.close();
}
