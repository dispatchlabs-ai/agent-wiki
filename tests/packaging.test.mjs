import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";
import zlib from "node:zlib";

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
  assert.match(
    packageDefinition,
    /removeAttrs manifest\.overrides \[ "jose" \]/,
  );
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

test("a signed traversal store path is rejected before import", (t) => {
  const temporary = fs.mkdtempSync(
    path.join(os.tmpdir(), "agent-wiki-verify-test-"),
  );
  t.after(() => fs.rmSync(temporary, { recursive: true, force: true }));

  const tools = path.join(temporary, "bin");
  const archive = path.join(temporary, "closure.gz");
  const manifest = path.join(temporary, "manifest.json");
  const key = path.join(temporary, "release-key");
  const allowedSigners = path.join(temporary, "allowed-signers");
  const importMarker = path.join(temporary, "imported");
  fs.mkdirSync(tools);
  fs.writeFileSync(archive, zlib.gzipSync("not a Nix export"));
  const archiveSha256 = crypto
    .createHash("sha256")
    .update(fs.readFileSync(archive))
    .digest("hex");
  fs.writeFileSync(
    manifest,
    `${JSON.stringify({
      schemaVersion: 1,
      format: "nix-store-export+gzip",
      archive: path.basename(archive),
      archiveSha256,
      storePath: `/nix/store/${"0".repeat(32)}-agent-wiki/../../escape`,
      packageIdentity: {},
    })}\n`,
  );

  const generated = spawnSync(
    "ssh-keygen",
    ["-q", "-t", "ed25519", "-N", "", "-f", key],
    { encoding: "utf8" },
  );
  assert.equal(generated.status, 0, generated.stderr);
  fs.writeFileSync(
    allowedSigners,
    `package-test ${fs.readFileSync(`${key}.pub`, "utf8")}`,
  );
  const signed = spawnSync(
    "ssh-keygen",
    ["-Y", "sign", "-f", key, "-n", "agent-wiki-release", manifest],
    { encoding: "utf8" },
  );
  assert.equal(signed.status, 0, signed.stderr);

  fs.writeFileSync(
    path.join(tools, "nix"),
    `#!/bin/sh
printf '%s\\n' '${archiveSha256}'
`,
    { mode: 0o755 },
  );
  fs.writeFileSync(
    path.join(tools, "nix-store"),
    `#!/bin/sh
touch '${importMarker}'
`,
    { mode: 0o755 },
  );

  const result = spawnSync(
    "sh",
    [
      path.join(root, "scripts", "verify-package-closure"),
      manifest,
      archive,
      allowedSigners,
      "package-test",
    ],
    {
      encoding: "utf8",
      env: { ...process.env, PATH: `${tools}:${process.env.PATH}` },
    },
  );

  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stderr, /does not contain one exact Nix store root/);
  assert.equal(fs.existsSync(importMarker), false);
});
