# Select patched runtime dependencies without rebuilding unrelated build tools.
# The release closure check must reject any retained vulnerable OpenSSL output.
{ pkgs }:
let
  openssl = pkgs.openssl_3_6;
  nghttp2 = pkgs.nghttp2.override { inherit openssl; };
  ngtcp2 = pkgs.ngtcp2.override { inherit openssl; };
  python3 = pkgs.python3.override {
    inherit openssl;
    self = python3;
  };
  # Nix links Node against these shared libraries, so the Node source update
  # alone does not include their October 21, 2026 security fixes.
  brotli = pkgs.brotli.overrideAttrs (old: {
    patches = (old.patches or [ ]) ++ [ (pkgs.fetchurl {
      url = "https://github.com/google/brotli/commit/0ed4268a4401abcb4472096340477cf4af7d1a2b.patch?full_index=1";
      hash = "sha256-1vliUJAAIj3vcGKVgim9CEV+XgMuftDR2U+3kLBUsfw=";
    }) ];
  });
  cares = pkgs.c-ares.overrideAttrs (_: {
    version = "1.34.9";
    src = pkgs.fetchurl {
      url = "https://github.com/c-ares/c-ares/releases/download/v1.34.9/c-ares-1.34.9.tar.gz";
      hash = "sha256-k2S3ChLrWaBoMPtIjZNX+QEA3/DZiyPqNZOhg9Q+by8=";
    };
  });
  nodejs-slim = pkgs.nodejs-slim_24.override {
    inherit openssl python3;
    # Preserve the platform compiler and patches while selecting the security
    # release in the builder, including its version metadata and source hash.
    callPackage = path: args: nodeArgs:
      (pkgs.lib.callPackageWith (pkgs // {
        inherit brotli nghttp2 ngtcp2;
        c-ares = cares;
      }) path args) (nodeArgs // {
        version = "24.22.1";
        sha256 = "4f5379796280cdaeb0c2f358fd04b6a16cc4fb7dfa83b5a8c91a9d963b435231";
      });
  };
  curl = pkgs.curl.override {
    inherit openssl nghttp2 ngtcp2 brotli;
    libkrb5 = pkgs.libkrb5.override { inherit openssl; };
    libssh2 = pkgs.libssh2.override { inherit openssl; };
  };
  openssh = pkgs.openssh.override {
    inherit openssl;
    ldns = pkgs.ldns.override { inherit openssl; };
    libfido2 = pkgs.libfido2.override { inherit openssl; };
  };
  git = pkgs.git.override {
    inherit openssl curl openssh;
    # Wiki uses native Git plumbing and HTTP/SSH transport, never Git's Perl
    # or Python tools. Avoid shipping these unused interpreter extensions.
    perlSupport = false;
    pythonSupport = false;
  };
in {
  inherit git openssh python3;
  nodejs_24 = pkgs.nodejs_24.override { inherit nodejs-slim; };
}
