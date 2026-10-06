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
  nodejs-slim = pkgs.nodejs-slim_24.override {
    inherit openssl python3;
    callPackage = pkgs.lib.callPackageWith (pkgs // { inherit nghttp2 ngtcp2; });
  };
  curl = pkgs.curl.override {
    inherit openssl nghttp2 ngtcp2;
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
