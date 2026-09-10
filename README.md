# Hornet C/C++

Hornet is an independent C/C++ language extension built around a shared language-engine interface and clangd. This 0.1.9 release implements the V1 scope of `request.md`: Compiler support, a Hybrid routing framework, call/type hierarchy views, automatic project indexing and compilation database management.

Tag and Flyweight appear in the mode picker as not yet implemented; selecting either leaves the current service unchanged. A previously saved unavailable mode uses Compiler for the current session and reports this in the status tooltip. Hybrid currently uses clangd alone; its fallback index will be added in later phases.

## Get started

1. Open a trusted C/C++ workspace. Hornet automatically searches PATH, common LLVM installations and the official clangd extension's managed installation. If missing, it downloads the official clangd 22.1.6 archive, verifies its SHA-256 checksum, and installs it in Hornet's storage on the workspace host. No path selection is required. Downloads support Windows x64, Linux x64 with glibc, and macOS x64/arm64; other hosts use a locally installed clangd. SSH, WSL and containers perform discovery and installation inside that environment.
2. Install the Hornet VSIX and open a trusted C/C++ workspace folder.
3. Hornet automatically creates `.vscode/hornet/compile-db/compile_commands.json`, which is the database read by the language service. It obtains build parameters from the selected CMake preset/build directory, including nested Debug/Release layouts, and preserves the include paths, macros and cross-compiler flags. Only one automatic configuration is used at a time. **Hornet C/C++: Import Compilation Database** supports additional explicit inputs.
4. Hornet automatically builds the project index when the folder opens, even before you open a source file. The index status shows discovery, parsing, completed/total counts and percentages when clangd supplies them, elapsed waiting time, then **Index ready**. Click a running index to see its detailed log. A separate **Hornet: Hybrid/Compiler** status item stays visible and opens the mode picker.
5. To build the index manually after startup, run **Hornet Build Index** from the command palette or a folder's Explorer context menu, or click **Hornet: Index ready**. The command refreshes compilation commands, rediscovers unconfigured sources, and waits for indexing to finish. **Sync Project Index** remains an alias.

Example settings:

```json
{
  "hornet-cpp.mode": "hybrid",
  "hornet-cpp.clangd.path": "clangd",
  "hornet-cpp.cpuUsage": "Medium",
  "hornet-cpp.clangd.ignoreDiagnostics": "not_indexed",
  "hornet-cpp.clangd.enableInlayHints": true,
  "hornet-cpp.syntaxColor.enable": true
}
```

Without a compile database, clangd can still provide basic browsing. Analysis may be incomplete. Hybrid suppresses rename, code actions and diagnostics for files without an explicit compile command. This also applies to headers whose commands clangd merely infers. Compiler mode allows these requests; diagnostic filtering remains configurable.

For an unconfigured project, Hornet discovers first-party source files and `include`/`includes`/`inc` directories and writes separate inferred browsing commands. Opening a call graph parses the discovered files (up to 250) so callers in unopened files are included. These commands do not replace real build flags or mark the project as configured. Parse errors and missing build configuration are shown in the graph; macros and conditional compilation require the project's actual compilation database.

The semantic index is persisted as clangd `.idx` cache files beside the selected compilation database: `.vscode/hornet/compile-db/.cache/clangd/index/`, or under `compile-db/fallback/.cache/clangd/index/` for inferred commands. Subsequent startups reuse unchanged shards and index changed files. Automatic discovery is bounded to 1,000 first-party source files, 500 directories and six directory levels; larger projects should provide a compilation database. Indexing does not compile or link the application.

## Features

- Completion, hover, signatures, definition/declaration, references, rename and code actions.
- Semantic highlighting, inlay hints, outline, workspace symbols, folding and formatting.
- Native call/type hierarchy providers, an interactive function call diagram, and lazy **Call Graph** and **Type Hierarchy** sidebars.
- Database import, merge, validation, normalization, source tracking, file watching, export and CMake/Bear generation.
- Independent settings and servers for each workspace folder.
- Per-file/folder index synchronization and project refresh; graceful process cleanup and bounded crash recovery.

Features are registered according to the installed clangd version's advertised capabilities. Use a recent clangd with LSP 3.17 hierarchy support. Other active C/C++ extensions can produce duplicate results; Hornet records their presence in the output log without showing a startup warning or modifying them.

Right-click a C/C++ function and choose **Hornet Show Graph**. The diagram opens in the bottom **Hornet Graph** panel tab alongside Terminal and Ports, leaving the editor layout intact. Switching panel tabs preserves the graph and viewport. The diagram initially shows only the selected function, its direct callers and its direct callees, including unopened source files. Controls stay scoped to the selected function: ancestors can expand only their caller chain, and descendants only their callee chain. Other callees of ancestors and other callers of descendants are never queried or drawn. The center has both sides; eligible function rectangles have **＋/−** controls: **left** expands/collapses callers, **right** expands/collapses callees. Each plus opens one additional level in that direction; deeper levels remain closed until clicked. Reopening a collapsed branch restores its previously opened descendants. Collapsing hides that branch's descendants while preserving functions still reachable through other expanded branches. Results are cached until refresh; a plus appears only for hidden relationships, a minus only for a branch that can be collapsed, and no control appears for an empty or already-visible side.

The layout ranks functions by actual call direction, groups related branches to reduce crossings, and reserves lanes around intervening nodes for calls that skip columns. Calls leave the caller's right side and enter the callee's left side; recursive groups use dashed outside loops. Caller/callee colors reflect their relationship to the selected root. Choose rounded or square elbow connectors. Related branches share aligned spines, uninterrupted chains stay horizontal, and fixed-size arrow tips meet the vertical center of the destination port. Expanding or collapsing a branch recomputes the whole layout, reserves space for whole subtrees and moves sibling branches to make room, aligns single-child chains, and fits the result into the canvas. Progress-only updates do not rearrange nodes.

Drag the background to pan, use the mouse wheel or toolbar to zoom, double-click a function to open its source, or select **设为中心** to start a new graph from it. A graph loads at most 250 functions; use a new center to explore further. Call information comes from clangd and depends on the project's compile commands and index coverage. **Show Type Hierarchy** continues to open the type sidebar.

Imported databases are merged into `.vscode/hornet/compile-db/compile_commands.json`; `sources.json` records origins. Later imports override earlier entries for the same canonical file. Importing does not execute compiler command strings. CMake generation runs configure in `build/`; use a CMake generator that supports compile commands. Bear runs the explicitly entered JSON argument array without a shell.

Driver probing is disabled unless paths are explicitly allowed in the machine-level `hornet-cpp.clangd.queryDriver` setting. Hornet disables clangd configuration loading so a workspace `.clangd` file cannot bypass Hornet's managed settings. clangd's own index cache and background indexing remain under clangd's control; Hornet's exclude patterns apply to manual folder synchronization only.

## Build and test

From `Extension/`, with Node.js 20 or newer:

```sh
npm ci
npm run compile
npm test
npm run package
```

To include the real clangd integration test, set `HORNET_TEST_CLANGD` to an absolute executable path before `npm test`. Open `Extension/` in VS Code and press F5 for interactive testing. The default test suite does not launch an Extension Host.

## Extension API

```typescript
const extension = vscode.extensions.getExtension('hornet.hornet-cpp');
if (!extension) throw new Error('Hornet C/C++ is not installed');
const exported = await extension.activate();
const api = exported.getApi(1);
await api.importCompilationDatabases(
  ['/project/module-a/build/compile_commands.json'],
  vscode.Uri.file('/project').toString()
);
const command = await api.getCompileCommand('/project/src/main.cpp');
await api.refreshIndex(vscode.Uri.file('/project').toString());
```

The optional workspace URI avoids ambiguity in multi-root workspaces. The TypeScript contract is in `src/hornet/api/hornetCppApi.ts` in the source repository.

## Release boundaries

No native binaries, debugger, Microsoft private runtime, telemetry or experiments are shipped. Tag/Flyweight servers, heuristic database generation, global-storage indexes, cache rebuild/sharding, RTOS headers, inactive-code styling and million-file performance certification remain future work. The source repository's `Documentation/Hornet-Implementation.md` maps implemented behavior and remaining phases to the design.

The development publisher is `hornet`; verify publisher ownership before marketplace publication. Local VSIX installation and public Marketplace, Open VSX and GitHub Release distribution are supported.

## License

MIT. This fork retains the upstream MIT copyright notices. Historical upstream source remains available in the repository but is excluded from the Hornet bundle and package. See `ThirdPartyNotices.txt` for bundled JavaScript dependencies. clangd is installed separately under its own license.

## Platform builds and releases

Windows, Linux, macOS and Alpine target packages are retained. Build all desktop/server targets with `npm run package:all`, or a single target with e.g. `npm run package:linux-x64`, `npm run package:darwin-arm64` or `npm run package:win32-x64`. Outputs are written to `Extension/artifacts/`. Stable and pre-release packages are supported.

Public publishing entrypoints are `npm run publish:marketplace -- --vsix <file>` and `npm run publish:openvsx -- --vsix <file>` (credentials come from `VSCE_PAT` / `OVSX_PAT`). Add `--dry-run` to inspect the publish plan. The manual GitHub release workflow also supports draft releases. Only Microsoft internal feeds, signing and proprietary runtime acquisition are excluded. See `Documentation/Hornet-Releasing.md` in the repository for the full matrix and release instructions.

Build tasks preserve `windows`, `linux` and `osx` overrides. Use task type `hornet-cpp.build`; existing `cppbuild` tasks are also supported.

If automatic setup fails (for example, GitHub is unreachable), the status bar shows **Hornet: Retry clangd**. Clicking it retries discovery and download without opening a file picker. Downloads respect the VS Code HTTP proxy setting and HTTPS_PROXY/HTTP_PROXY. **Hornet C/C++: Configure clangd** remains available for optional manual selection. Explicit custom executable paths are respected. Open **Hornet C/C++: Open Logs** to see the extension version, location and backend startup details.
