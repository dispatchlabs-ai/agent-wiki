import { ControlStore } from "../src/control-store.mjs";
const [issuer, subject, name] = process.argv.slice(2);
const control = new ControlStore(process.env.WIKI_CONTROL);
try {
  const id = control.bootstrap({ issuer, subject, name });
  console.log(`Created initial manager ${id}`);
} finally {
  control.close();
}
