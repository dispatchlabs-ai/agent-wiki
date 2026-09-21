{
  description = "Agent Wiki host package and Linux OCI image";

  inputs.nixpkgs.url =
    "github:NixOS/nixpkgs/5880666fd9eb563038431edb35c2d0aa595884e6";

  outputs =
    { self, nixpkgs }:
    let
      supportedSystems = [
        "aarch64-darwin"
        "x86_64-linux"
      ];
      forAllSystems = nixpkgs.lib.genAttrs supportedSystems;
      sourceRevision =
        if self ? rev then
          self.rev
        else if self ? dirtyRev then
          self.dirtyRev
        else
          "uncommitted";
      packageFor =
        system:
        let
          pkgs = import nixpkgs { inherit system; };
        in
        pkgs.callPackage ./nix/package.nix {
          src = self;
          inherit sourceRevision;
        };
    in
    {
      packages = forAllSystems (
        system:
        let
          pkgs = import nixpkgs { inherit system; };
          agentWiki = packageFor system;
        in
        {
          agent-wiki = agentWiki;
          default = agentWiki;
        }
        // pkgs.lib.optionalAttrs pkgs.stdenv.hostPlatform.isLinux {
          oci = pkgs.callPackage ./nix/oci.nix {
            agent-wiki = agentWiki;
          };
        }
      );

      apps = forAllSystems (
        system:
        let
          package = packageFor system;
        in
        {
          lifecycle = {
            type = "app";
            program = "${package}/bin/agent-wiki";
          };
          server-direct = {
            type = "app";
            program = "${package}/bin/agent-wiki-server-direct";
          };
          cli = {
            type = "app";
            program = "${package}/bin/agent-wiki-cli";
          };
          package-info = {
            type = "app";
            program = "${package}/bin/agent-wiki-package-info";
          };
        }
      );

      checks = forAllSystems (
        system:
        let
          pkgs = import nixpkgs { inherit system; };
          package = packageFor system;
        in
        {
          package-smoke = pkgs.callPackage ./nix/check-package.nix {
            agent-wiki = package;
          };
        }
        // pkgs.lib.optionalAttrs pkgs.stdenv.hostPlatform.isLinux {
          oci = self.packages.${system}.oci;
        }
      );

      devShells = forAllSystems (
        system:
        let
          pkgs = import nixpkgs { inherit system; };
        in
        {
          packaging = pkgs.mkShellNoCC {
            packages = [
              pkgs.gzip
              pkgs.jq
              pkgs.openssh
            ];
          };
        }
      );
    };
}
