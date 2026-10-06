# Select patched runtime dependencies without rebuilding unrelated build tools.
# The release closure check must reject any retained vulnerable OpenSSL output.
{ pkgs }:
let
  openssl = pkgs.openssl_3_6;
  ngtcp2 = pkgs.ngtcp2.override { inherit openssl; };
  nodejs-slim = pkgs.nodejs-slim_24.override {
    inherit openssl;
    callPackage = pkgs.lib.callPackageWith (pkgs // { inherit ngtcp2; });
  };
  python3 = pkgs.python3.override { inherit openssl; };
  curl = pkgs.curl.override {
    inherit openssl ngtcp2;
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
