{
  lib,
  stdenv,
  buildNpmPackage,
  importNpmLock,
  makeWrapper,
  coreutils,
  git,
  nodejs_24,
  src,
  sourceRevision,
}:

let
  manifest = builtins.fromJSON (builtins.readFile (src + "/package.json"));
  nodeVersion = nodejs_24.version;
  packageLockSha256 = builtins.hashFile "sha256" (src + "/package-lock.json");
  applicationRoot = "$out/libexec/agent-wiki";
  runtimePath = lib.makeBinPath [ git ];
  entrypoints = {
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
    agent-wiki-example = "scripts/example.mjs";
  };
  identity = builtins.toJSON {
    schemaVersion = 1;
    name = manifest.name;
    version = manifest.version;
    inherit sourceRevision packageLockSha256;
    nixpkgsRevision = "d14174cf76b08f145215940c72af608cd8a956e3";
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
  npmDeps = importNpmLock { npmRoot = src; };
  npmConfigHook = importNpmLock.npmConfigHook;
  npmBuildScript = "build:ui";

  nativeBuildInputs = [ makeWrapper ];

  installPhase = ''
    runHook preInstall

    npm prune --omit=dev --ignore-scripts --no-audit --no-fund

    app=${applicationRoot}
    mkdir -p "$app" "$out/bin" "$out/share/doc/agent-wiki" "$out/share/agent-wiki"
    cp -R bin public scripts src "$app/"
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
      ) entrypoints
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
    mainProgram = "agent-wiki-server-direct";
    platforms = [
      "aarch64-darwin"
      "x86_64-linux"
    ];
  };
}
