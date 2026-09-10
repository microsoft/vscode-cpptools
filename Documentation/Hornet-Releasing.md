# Hornet cross-platform builds and public releases

Windows, Linux and macOS remain supported host platforms. SSH, WSL and containers run the extension and clangd on the workspace host. Removing Microsoft's internal services does not remove Windows support or the public VS Code Marketplace.

## Platform tasks

The extension retains `windows`, `linux` and `osx` task overrides, argument quoting, working directories and problem matchers. New tasks can use `hornet-cpp.build`; existing `cppbuild` tasks remain supported by a compatibility task provider. No Microsoft C/C++ runtime is needed for these tasks. Tasks run only when invoked in a trusted workspace.

```json
{
  "version": "2.0.0",
  "tasks": [{
    "type": "hornet-cpp.build",
    "label": "Build active file",
    "command": "clang++",
    "args": ["-g", "${file}"],
    "options": { "cwd": "${fileDirname}" },
    "linux": { "command": "g++" },
    "osx": { "command": "/usr/bin/clang++" },
    "windows": { "command": "clang++" },
    "problemMatcher": "$gcc",
    "group": "build"
  }]
}
```

Portable upstream C++ filename associations, GCC/IAR/ARM compiler problem matchers, language defaults and semantic token scopes are retained. Historical debugger registrations and proprietary language-server commands remain excluded because their backends have been replaced.

## Build and package

Run commands in `Extension/` with Node.js 20 or newer (CI uses Node.js 24):

```sh
npm ci
npm run build
npm test
npm run package
npm run package:all
```

`package` produces the universal `hornet-cpp-<version>.vsix`. `package:all` writes the following ten variants into `artifacts/`:

| OS | Targets |
| --- | --- |
| Universal | `universal` |
| Windows | `win32-x64`, `win32-arm64` |
| Linux | `linux-x64`, `linux-arm64`, `linux-armhf` |
| macOS | `darwin-x64`, `darwin-arm64` |
| Alpine Linux | `alpine-x64`, `alpine-arm64` |

Examples:

```sh
npm run package:linux-x64
npm run package:darwin-arm64
npm run package:win32-x64
npm run package:pre-release
npm run package:all -- --pre-release
```

Target IDs are written to VSIX metadata by vsce. They are not npm `os`/`cpu` filters that would restrict installation to the machine doing the build. The extension bundle is JavaScript; any host can package all targets. Hornet discovers clangd on the workspace host and automatically downloads a verified official archive on Windows x64, glibc Linux x64 and macOS x64/arm64 when missing. Other hosts require a local clangd installation. Generating a target package does not certify native ABI compatibility or imply that tests ran on that CPU architecture. Browser-only VS Code has no native process support and is not a supported target.

The `bootstrap`, `build`, `rebuild`, `clean`, `scripts`, `show`, `webpack` and `vsix-prepublish` entrypoints remain available with Hornet implementations. `webpack` is a compatibility alias for the current bundler. `clean` removes only generated `dist` and `out/hornet` output; it retains release artifacts.

## Public distribution

All publishing commands consume explicit, already packaged VSIX files. Configure your own publisher/namespace in `package.json` and obtain credentials for that namespace. Do not use the upstream `ms-vscode` identity.

Public VS Code Marketplace (token in `VSCE_PAT`):

```sh
npm run publish:marketplace -- --vsix artifacts/hornet-cpp-0.1.0-universal.vsix
```

Open VSX (token in `OVSX_PAT`):

```sh
npm run publish:openvsx -- --vsix artifacts/hornet-cpp-0.1.0-universal.vsix
```

Repeat `--vsix` to publish multiple target packages. Add `--dry-run` to inspect arguments without accessing either registry. Tokens are read from the environment and never placed in command-line arguments. Open VSX namespace setup and publisher agreements follow the [official publishing instructions](https://github.com/eclipse-openvsx/openvsx/wiki/Publishing-Extensions).

VSIX files also support offline/manual installation. To distribute through GitHub Releases, use the `Package and release Hornet` workflow or attach the VSIX files manually.

## CI and release workflow

The existing Linux, macOS and Windows CI workflows remain separate and call the shared Hornet build/test/package workflow. They install public npm dependencies and no longer acquire Microsoft private binaries or use the private Yarn bootstrap registry. Each uploads its universal VSIX as a build artifact.

`release_hornet.yml` is manually dispatched. By default it only packages all targets and uploads artifacts. Optional inputs create a draft GitHub Release, publish to Marketplace, or publish to Open VSX. Publishing requires repository secrets `VSCE_PAT` and/or `OVSX_PAT`. Stable and pre-release builds are both supported.

Microsoft MicroBuild signing, internal AAD subscriptions, internal package feeds and proprietary runtime acquisition are not used by these Hornet workflows. Historical `Build/package`, `Build/publish` and signing templates remain in the repository as upstream references; they are not the Hornet release entrypoints. Public tools such as vsce, public Marketplace authentication, npm and GitHub Actions are retained.
