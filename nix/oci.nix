{
  lib,
  dockerTools,
  cacert,
  tzdata,
  agent-wiki,
}:

let
  identity = agent-wiki.packageIdentity;
  shortRevision = builtins.substring 0 12 identity.sourceRevision;
in

dockerTools.buildLayeredImage {
  name = "agent-wiki";
  tag = "${identity.version}-${shortRevision}";
  contents = [
    agent-wiki
    cacert
    tzdata
  ];

  fakeRootCommands = ''
    mkdir -p ./data ./tmp
    chmod 0755 ./data
    chmod 1777 ./tmp
    chown 65532:65532 ./data
  '';

  config = {
    User = "65532:65532";
    WorkingDir = "/data";
    Entrypoint = [ "${agent-wiki}/bin/agent-wiki" ];
    Cmd = [
      "serve"
      "--root"
      "/data"
    ];
    Env = [
      "HOME=/tmp"
      "NODE_ENV=production"
      "PORT=4317"
      "WIKI_LISTEN_HOST=0.0.0.0"
    ];
    ExposedPorts = {
      "4317/tcp" = { };
    };
    # ECS initializes a task bind volume from the matching image volume path.
    # Keep the image's 1777 mode when /tmp is replaced under a read-only root.
    Volumes = {
      "/tmp" = { };
    };
    Labels = {
      "org.opencontainers.image.title" = "Agent Wiki";
      "org.opencontainers.image.description" = "Git-backed wiki with browser and agent interfaces";
      "org.opencontainers.image.source" = "https://github.com/dispatchlabs-ai/agent-wiki";
      "org.opencontainers.image.version" = identity.version;
      "org.opencontainers.image.revision" = identity.sourceRevision;
      "org.opencontainers.image.licenses" = "MIT";
      "org.opencontainers.image.base.name" = "Nix closure";
    };
  };

  passthru = {
    packageIdentity = identity // {
      distribution = "oci-archive";
      hostRequiresNix = false;
    };
  };

  meta.platforms = lib.platforms.linux;
}
