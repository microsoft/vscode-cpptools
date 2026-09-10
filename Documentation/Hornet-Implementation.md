# Hornet C/C++ implementation status

This implementation follows the V1 recommendation in `request.md` sections 101–102. It is an initial Compiler release with a Hybrid routing framework, not the completion of all four development phases.

## Implemented

- Independent extension identity (`hornet.hornet-cpp`), commands, settings, logs, entrypoint, dependency lockfile and VSIX allowlist.
- Shared `LanguageEngine`, `ModeManager` and `CapabilityRouter`. Providers use protocol values and do not access clangd directly.
- Workspace-local Compiler instances, settings and compilation databases, with serialized mode changes and rollback on startup failure.
- clangd stdio protocol, initialization, capability negotiation, UTF-16 positions, document synchronization, cancellation, initialization timeout, shutdown and up to two automatic crash restarts.
- Completion, hover, signatures, definition, declaration, type definition, implementation, references, rename, code actions, outline, workspace symbols, folding, formatting, inlay hints and semantic tokens, gated by backend capabilities.
- Native call/type hierarchy providers and lazy sidebar graphs. Each branch detects cycles; refreshing or replacing a root cancels stale queries. Jump, copy symbol, references, root replacement and call-root pinning are available.
- Interactive SVG call diagram from the C/C++ editor context menu. Left/right controls independently expand and collapse callers/callees on every node. Visibility follows open branches, preserving shared symbols and recursive edges. Directional results are cached, failures can be retried, and stale responses are discarded after reset. Rounded/straight connectors, pan/zoom, source navigation and recentering are available; each graph caches at most 250 functions.
- Compilation database discovery in the workspace root and `build/`, import, merge, last-source-wins deduplication, validation, canonical file lookup, provenance, watching, export, CMake/Bear generation and per-file argument display.
- Versioned extension API for LinuxBuild-style consumers.
- Trust restrictions, no shell interpolation, an explicit machine-level query-driver allowlist, configuration output containment checks, and no automatic execution of compilers named in imported databases.
- CPU thread budgets, current-file and bounded folder synchronization, and project refresh by restarting clangd after database reload.

## Deliberate V1 boundaries

| Area | Current behavior / remaining work |
| --- | --- |
| Tag and Flyweight | Planned backends are absent from the mode picker. Previously saved Tag/Flyweight modes use Compiler for the current session with an explanatory status message. No `hornet-db`, ctags/cscope integration or Rust Tree-sitter server is shipped. |
| Hybrid | Uses Compiler only until an index backend is implemented. The injectable fallback interface and coverage-dependent routing are tested. Uncovered files still use clangd's fallback parsing for browsing, while rename, code actions and diagnostics are restricted. |
| Header coverage | Requires an explicit database entry for precision-sensitive features in Hybrid. Inferred clangd header commands are not treated as verified coverage. |
| Database discovery | Bounded to root/build paths; import additional module databases explicitly. A malformed update retains the previous valid database and reports the error in logs. |
| Database generation | CMake and Bear are supported. CMake needs a generator that emits compile commands (such as Ninja or Unix Makefiles). Heuristic/header-guess generation is not implemented. |
| Index storage and rebuild | clangd owns its cache and background indexing. Hornet global-storage index databases, index deletion/rebuild, sharding, memory budgets and detailed indexing progress are future work. The sync command does not pretend to delete/rebuild caches. |
| Exclusions | Applied to manual folder synchronization. clangd background index coverage is determined by compilation commands and includes. |
| Binary distribution | Uses a locally installed clangd on the workspace host. No download service or native binaries are bundled; universal and platform-specific VSIX packaging is implemented; native binary checksums, glibc compatibility and license validation for bundled native releases are pending. |
| Restricted/virtual workspaces | Activation is disabled. Open a trusted filesystem workspace folder. Standalone files outside workspace folders are not supported in this release. |
| Advanced UI | Qualified-name copying, inactive-code styling, configurable graph auto-follow and detailed index status remain future work. |
| Native testing/performance | No million-file benchmark or Linux ABI claim. VS Code interactive smoke checks are documented separately from transport integration tests. |

## Repository migration

Historical Microsoft sources and assets remain in the repository for reference and incremental migration. `tsconfig.hornet.json` includes only `src/hornet` and its tests; `build.hornet.js` bundles only the Hornet entrypoint; `.vscodeignore` allows only the new bundle, call diagram assets, icon, metadata, README and notices. Legacy private runtime downloaders, telemetry, experiments, debugger and Copilot integrations are not in the runtime dependency graph or VSIX. `legacy.yarn.lock` is retained only as historical reference. npm is the supported build tool.

The publisher value `hornet` is a local development identity; verify ownership before publishing to a marketplace. Public Marketplace, Open VSX and GitHub Release workflows are available; this work does not publish or install the extension automatically. See `Hornet-Releasing.md`.

## Validation

```powershell
cd Extension
npm.cmd ci
npm.cmd run compile
npm.cmd test
$env:HORNET_TEST_CLANGD = 'C:/absolute/path/to/clangd.exe'
npm.cmd test
npm.cmd run package
```

`HORNET_TEST_CLANGD` runs a real language-server process against an isolated C++ fixture, including Unicode positions and edits. VS Code host objects are substituted in that test; it is not an Extension Host E2E test. Unit tests cover routing, mode rollback/serialization, compilation database parsing/merging, CPU budgets and the shipping manifest. Windows environments without symlink privileges skip the canonicalization symlink test.

Interactive smoke checks: open `Extension` in VS Code and press F5, then open a C/C++ workspace in the development host. Verify completion and Problems, import a database, edit a source, show and expand both hierarchies, switch Compiler/Hybrid, and open a second workspace folder. Confirm that closing the development host stops clangd and that an invalid clangd path shows an actionable error with logs.

Call diagram tests cover independent directional expansion/collapse, shared descendants, cycles, caching, concurrent queries, late responses, retry and graph limits. The clangd integration test also builds and collapses a graph from real incoming/outgoing calls. Optional `test/hornet/callGraph.browser.cjs` renders the actual panel HTML/CSS/JS in headless Chromium and checks controls on both rectangle edges, both connector styles, source navigation, zoom, safe symbol labels, recentering and engine invalidation. Set `HORNET_PLAYWRIGHT_MODULE` to an installed `playwright-core` module and `HORNET_BROWSER_PATH` to a local Chromium executable; run `npm.cmd test` first to compile host code, then `node test/hornet/callGraph.browser.cjs` from `Extension`. Browser host APIs and call data are substituted; this does not replace an interactive VS Code Extension Host check.

Protocol references: [clangd compile commands](https://clangd.llvm.org/design/compile-commands), [clangd protocol extensions](https://clangd.llvm.org/extensions), [system-header driver allowlisting](https://clangd.llvm.org/guides/system-headers).
