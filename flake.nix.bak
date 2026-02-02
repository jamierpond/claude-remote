{
  description = "Claude Remote - mobile chat interface with Flutter client";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs = { self, nixpkgs, flake-utils }:
    flake-utils.lib.eachDefaultSystem (system:
      let
        pkgs = import nixpkgs {
          inherit system;
          config = {
            allowUnfree = true;
            android_sdk.accept_license = true;
          };
        };
      in
      {
        devShells.default = pkgs.mkShell {
          buildInputs = with pkgs; [
            # Node.js for the server
            nodejs_22
            pnpm

            # Flutter
            flutter
          ] ++ pkgs.lib.optionals pkgs.stdenv.isLinux [
            # Flutter Linux desktop dependencies
            clang
            cmake
            ninja
            pkg-config
            gtk3
            pcre2
            util-linux
            libselinux
            libsepol
            libthai
            libdatrie
            xorg.libXdmcp
            lerc
            libxkbcommon
            libepoxy
          ] ++ pkgs.lib.optionals pkgs.stdenv.isDarwin [
            cocoapods
          ];

          shellHook = ''
            echo "Claude Remote dev environment"
            echo "  Node: $(node --version)"
            echo "  pnpm: $(pnpm --version)"
          '';
        };
      });
}
