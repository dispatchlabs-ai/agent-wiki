import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const nixpkgsRevision = "5880666fd9eb563038431edb35c2d0aa595884e6";

test("packaging inputs carry immutable dependency and source identity", () => {
  const lock = JSON.parse(
    fs.readFileSync(path.join(root, "flake.lock"), "utf8"),
  );
  const pinned = lock.nodes.nixpkgs.locked;
  assert.equal(pinned.type, "github");
  assert.equal(pinned.owner, "NixOS");
  assert.equal(pinned.repo, "nixpkgs");
  assert.equal(pinned.rev, nixpkgsRevision);
  assert.match(pinned.narHash, /^sha256-[A-Za-z0-9+/]{43}=$/);

  const packageDefinition = fs.readFileSync(
    path.join(root, "nix/package.nix"),
    "utf8",
  );
  assert.match(packageDefinition, /builtins\.hashFile "sha256"/);
  assert.ok(packageDefinition.includes(nixpkgsRevision));
  assert.match(packageDefinition, /versionAtLeast nodeVersion "24\.19\.0"/);
  assert.match(packageDefinition, /hostRequiresNix = true/);
  assert.match(packageDefinition, /ociRequiresNix = false/);
});

test("closure producer and consumer scripts have valid POSIX shell syntax", () => {
  for (const script of ["package-closure", "verify-package-closure"]) {
    const result = spawnSync("sh", ["-n", path.join(root, "scripts", script)], {
      encoding: "utf8",
    });
    assert.equal(result.status, 0, result.stderr);
  }
});

test("a failed Nix export cannot leave a release artifact", (t) => {
  const temporary = fs.mkdtempSync(
    path.join(os.tmpdir(), "agent-wiki-package-test-"),
  );
  t.after(() => fs.rmSync(temporary, { recursive: true, force: true }));

  const tools = path.join(temporary, "bin");
  const packageRoot = path.join(temporary, "package");
  const output = path.join(temporary, "output");
  fs.mkdirSync(path.join(packageRoot, "bin"), { recursive: true });
  fs.mkdirSync(tools);

  fs.writeFileSync(
    path.join(packageRoot, "bin", "agent-wiki-package-info"),
    `#!/bin/sh
printf '%s\\n' '{"version":"0.8.7","system":"x86_64-linux","sourceRevision":"0123456789abcdef"}'
`,
    { mode: 0o755 },
  );
  fs.writeFileSync(
    path.join(tools, "nix"),
    `#!/bin/sh
case " $* " in
  *" build "*) printf '%s\\n' '${packageRoot}' ;;
  *" path-info "*) printf '%s\\n' '/nix/store/fake-agent-wiki' ;;
  *) exit 64 ;;
esac
`,
    { mode: 0o755 },
  );
  fs.writeFileSync(path.join(tools, "nix-store"), "#!/bin/sh\nexit 42\n", {
    mode: 0o755,
  });

  const result = spawnSync(
    "sh",
    [path.join(root, "scripts", "package-closure"), output],
    {
      encoding: "utf8",
      env: { ...process.env, PATH: `${tools}:${process.env.PATH}` },
    },
  );

  assert.equal(result.status, 42, result.stderr);
  assert.deepEqual(fs.readdirSync(output), []);
});
