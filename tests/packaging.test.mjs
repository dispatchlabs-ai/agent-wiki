import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const nixpkgsRevision = "d14174cf76b08f145215940c72af608cd8a956e3";

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
