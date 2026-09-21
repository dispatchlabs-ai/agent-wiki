{
  lib,
  stdenv,
  buildNpmPackage,
  importNpmLock,
  makeWrapper,
  coreutils,
  git,
  nodejs_24,
  python3,
  src,
  sourceRevision,
}:

let
  manifest = builtins.fromJSON (builtins.readFile (src + "/package.json"));
  # importNpmLock rewrites direct dependencies to file: store URLs. npm 11 treats
  # an otherwise identical registry-version override as conflicting with that
  # rewritten direct dependency. The lock already fixes jose at 6.2.8.
  buildManifest = manifest // {
    overrides = builtins.removeAttrs manifest.overrides [ "jose" ];
  };
  nodeVersion = nodejs_24.version;
  packageLockSha256 = builtins.hashFile "sha256" (src + "/package-lock.json");
  applicationRoot = "$out/libexec/agent-wiki";
  runtimePath = lib.makeBinPath [
    git
    nodejs_24
  ];
  directEntrypoints = {
    agent-wiki-server-direct = "src/server.mjs";
    agent-wiki-cli = "bin/wiki.mjs";
    agent-wiki-bootstrap-direct = "scripts/provision-local.mjs";
    agent-wiki-bootstrap-oidc-direct = "scripts/bootstrap.mjs";
    agent-wiki-local-account-direct = "scripts/local-account.mjs";
    agent-wiki-agent-admin-direct = "scripts/agent-admin.mjs";
    agent-wiki-agent-keygen = "scripts/agent-keygen.mjs";
    agent-wiki-agent-mcp = "scripts/agent-mcp.mjs";
    agent-wiki-import-trace-direct = "scripts/import-trace.mjs";
    agent-wiki-index-traces-direct = "scripts/index-traces.mjs";
    agent-wiki-publish-media-direct = "scripts/publish-article-media.mjs";
  };
  managedEntrypoints = {
    agent-wiki = "scripts/lifecycle.py";
    agent-wiki-lifecycle = "scripts/lifecycle.py";
  };
  entrypoints = directEntrypoints // managedEntrypoints;
  identity = builtins.toJSON {
    schemaVersion = 1;
    name = manifest.name;
    version = manifest.version;
    inherit sourceRevision packageLockSha256;
    nixpkgsRevision = "5880666fd9eb563038431edb35c2d0aa595884e6";
    system = stdenv.hostPlatform.system;
    node = nodeVersion;
    hostRequiresNix = true;
    ociRequiresNix = false;
    executableEntrypoints = builtins.attrNames entrypoints;
  };
in

assert lib.assertMsg (lib.versionAtLeast nodeVersion "24.19.0")
  "Agent Wiki requires Node 24.19.0 or newer; pinned nixpkgs provides ${nodeVersion}";

buildNpmPackage {
  pname = manifest.name;
  version = manifest.version;
  inherit src;

  nodejs = nodejs_24;
  npmDeps = importNpmLock {
    npmRoot = src;
    package = buildManifest;
  };
  npmConfigHook = importNpmLock.npmConfigHook;
  npmBuildScript = "build:ui";

  nativeBuildInputs = [ makeWrapper ];

  installPhase = ''
    runHook preInstall

    npm prune --omit=dev --ignore-scripts --no-audit --no-fund

    app=${applicationRoot}
    mkdir -p "$app" "$out/bin" "$out/share/doc/agent-wiki" "$out/share/agent-wiki"
    cp -R bin public scripts src ui "$app/"
    cp package.json package-lock.json LICENSE THIRD_PARTY_NOTICES.md "$app/"
    cp -R node_modules "$app/"
    cp -R docs/. "$out/share/doc/agent-wiki/"
    cp LICENSE THIRD_PARTY_NOTICES.md "$out/share/doc/agent-wiki/"

    cat > "$out/share/agent-wiki/package-identity.json" <<'EOF'
    ${identity}
    EOF

    ${lib.concatStringsSep "\n" (
      lib.mapAttrsToList (
        name: script: ''
          makeWrapper ${nodejs_24}/bin/node "$out/bin/${name}" \
            --add-flags "$app/${script}" \
            --set NODE_ENV production \
            --prefix PATH : ${runtimePath}
        ''
      ) directEntrypoints
    )}

    ${lib.concatStringsSep "\n" (
      lib.mapAttrsToList (
        name: script: ''
          makeWrapper ${python3}/bin/python3 "$out/bin/${name}" \
            --add-flags "$app/${script}" \
            --prefix PATH : ${runtimePath}
        ''
      ) managedEntrypoints
    )}

    makeWrapper ${coreutils}/bin/cat "$out/bin/agent-wiki-package-info" \
      --add-flags "$out/share/agent-wiki/package-identity.json"

    runHook postInstall
  '';

  passthru.packageIdentity = builtins.fromJSON identity;

  meta = {
    description = manifest.description;
    homepage = "https://github.com/dispatchlabs-ai/agent-wiki";
    license = lib.licenses.mit;
    mainProgram = "agent-wiki";
    platforms = [
      "aarch64-darwin"
      "x86_64-linux"
    ];
  };
}
