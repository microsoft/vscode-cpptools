# C/C++ for Visual Studio Code Changelog

## Version 1.26.1: May 22, 2025
### Bug Fixes
* Fix include completion adding an extra `"` in `insert` mode. [#13615](https://github.com/microsoft/vscode-cpptools/issues/13615)
* Fix a bug with compiler querying of MinGW. [#13622](https://github.com/microsoft/vscode-cpptools/issues/13622)
* Fix a tag parser crash regression.

## Version 1.26.0: May 21, 2025
### New Feature
* Improve the context provided for C++ Copilot suggestions.

### Enhancements
* Add support for c++26/2c, gnu++26/2c, and c++23preview configurations. [#12963](https://github.com/microsoft/vscode-cpptools/issues/12963), [#13133](https://github.com/microsoft/vscode-cpptools/issues/13133)
* IntelliSense parser updates.

### Bug Fixes
* Fix an invalid IntelliSense error with C++23 escape sequences. [#13338](https://github.com/microsoft/vscode-cpptools/issues/13338)
* Fix switch header/source for CUDA files. [#13575](https://github.com/microsoft/vscode-cpptools/issues/13575)
* Update Apple clang 16.4 to LLVM clang version mappings and fix incorrect mappings for Apple clang 14.
* Update the bundled clang-tidy and clang-format from 1.20.3 to 1.20.5 (for bug fixes).

## Version 1.25.3: April 28, 2025
### Enhancements
* Add a configuration warning message explaining why paths in quotes can't be found. [#11955](https://github.com/microsoft/vscode-cpptools/issues/11955)
* Improve the description of the `C_Cpp.copilotHover` setting. [PR #13461](https://github.com/microsoft/vscode-cpptools/pull/13461)

### Bug Fixes
* Fix no error appearing in the configuration UI when an invalid `compilerPath` is used. [#12661](https://github.com/microsoft/vscode-cpptools/issues/12661)
* Fix the 'Debug C/C++ File' button sometimes disappearing. [#13400](https://github.com/microsoft/vscode-cpptools/issues/13400)
* Fix a crash in `read_double`. [#13435](https://github.com/Microsoft/vscode-cpptools/issues/13435)
* Fix the handling of default file associations for certain file extensions. [PR #13455](https://github.com/microsoft/vscode-cpptools/pull/13455)
* Fix shell parsing of the arguments of a full command line in `compilerPath`. [PR #13468](https://github.com/microsoft/vscode-cpptools/pull/13468)
* Fix C and CUDA files being interpreted as C++ in `compile_commands.json`. [#13471](https://github.com/microsoft/vscode-cpptools/issues/13471)
* Stop automatically mapping a `.C` file to C++ if it's already set in `files.associations`. [PR #13476](https://github.com/microsoft/vscode-cpptools/pull/13476)
* Fix issues with the `recursiveIncludes` properties in the configuration UI editor. [PR #13498](https://github.com/microsoft/vscode-cpptools/pull/13498)
* Fix IntelliSense not updating after the language ID is changed, and prevent the language ID from being changed if it's set from `compile_commands.json` or a configuration provider.
* Update clang-tidy and clang-format from 20.1.2 to 20.1.3 (which has some bug fixes).
* Fix a case where language server crash messages appear after 4 minutes.
* Fix a crash with Copilot hover.
* Fix some translation issues.

## Version 1.24.5: April 3, 2025
### New Feature
* Add support for Copilot descriptions in hover tooltips, controlled by the `C_Cpp.copilotHover` setting. [PR #13385](https://github.com/microsoft/vscode-cpptools/pull/13385)

### Enhancements
* Improve/fix the switch header/source feature. [#2635](https://github.com/microsoft/vscode-cpptools/issues/2635)
* Add detected test frameworks to the Copilot context when `#cpp` is used. [PR #13285](https://github.com/microsoft/vscode-cpptools/pull/13285)
* Update clang-tidy and clang-format from 19.1.7 to 20.1.2. [PR #13348](https://github.com/microsoft/vscode-cpptools/pull/13348)
* Remove some unnecessary files from the vsix. [PR #13368](https://github.com/microsoft/vscode-cpptools/pull/13368)
* Improve the logging when a non-existent path is used for indexing. [PR #13372](https://github.com/microsoft/vscode-cpptools/pull/13372)
* Add a new `recursiveIncludes` property to `c_cpp_properties.json`. [PR #13374](https://github.com/microsoft/vscode-cpptools/pull/13374)
* Remove the `C_Cpp.updateChannel` setting. [PR #13376](https://github.com/microsoft/vscode-cpptools/pull/13376)
* Add handling of `-cxx-isystem`, `-stblib++-isystem`, `-isystem-after`, and `--include-barrier` Clang compiler arguments when composing the order of include paths used by IntelliSense.
* Defer the building of the include completion cache to another thread to improve performance when a file is opened.
* On shutdown, immediately terminate the IntelliSense process instead of waiting 2 seconds.

### Bug Fixes
* Fix an IntelliSense crash in `build_sections`. [#12666](https://github.com/microsoft/vscode-cpptools/issues/12666), [#12956](https://github.com/microsoft/vscode-cpptools/issues/12956)
* Fix random IntelliSense process crashes on Linux/macOS when `C_Cpp.intelliSenseCacheSize` is > 0. [#12668](https://github.com/microsoft/vscode-cpptools/issues/12668)
* Fix a bug in which hundreds of custom configuration requests could be sent on startup before the configuration provider has registered. [#13166](https://github.com/microsoft/vscode-cpptools/issues/13166)
* Fix handling of the `-framework` compiler argument. [#13204](https://github.com/microsoft/vscode-cpptools/issues/13204)
* Fix a potential race between didChange and didOpen. [PR #13209](https://github.com/microsoft/vscode-cpptools/pull/13209)
* Fix an issue with the `.editorconfig` `tab_size`. [PR #13216](https://github.com/microsoft/vscode-cpptools/pull/13216)
* Fix a potential deadlock on shutdown if configuration providers are used. [#13218](https://github.com/microsoft/vscode-cpptools/issues/13218)
* Fix the code analysis mode in the Language Status bar not updating after the setting changes. [#13240](https://github.com/microsoft/vscode-cpptools/issues/13240)
* Fix system include/framework paths being used as a fallback for user include/framework paths in the base configuration. [PR #13247](https://github.com/microsoft/vscode-cpptools/pull/13247)
* Fix the `svdPath` description being missing for `launch.json`. [#13287](https://github.com/microsoft/vscode-cpptools/issues/13287)
* Update the Windows SDK packages referenced in the walkthrough. [#13290](https://github.com/microsoft/vscode-cpptools/issues/13290)
* Fix an issue with `C:` being treated as a relative path. [PR #13297](https://github.com/microsoft/vscode-cpptools/pull/13297)
* Fix an unnecessary TU reset when a change is detected in a `compile_commands.json` file that is not used by the active configuration. [#13317](https://github.com/microsoft/vscode-cpptools/issues/13317)
* Fix handling of URIs in web environments. [#13327](https://github.com/microsoft/vscode-cpptools/issues/13327)
* Fix a potential deadlock after using 'Reset IntelliSense Database'. [#13337](https://github.com/microsoft/vscode-cpptools/issues/13337)
* Fix some localization bugs. [PR #13373](https://github.com/microsoft/vscode-cpptools/pull/13373)
* Fix IntelliSense showing the wrong size of objects. [#13375](https://github.com/microsoft/vscode-cpptools/issues/13375)
* Fix the `get_mangled_function_name` IntelliSense process crash. [#13358](https://github.com/Microsoft/vscode-cpptools/issues/13358)
* Fix an issue with duplicate forced includes being removed. Multiple forced includes of the same file should now properly be included multiple times.
* Fix an issue in which the base configuration browse paths may not get populated when using a custom configuration provider.
* Fix an issue with forced includes not being resolved against the same include path search order as a compiler would.
* Fix a `${workspaceFolder}/*` include path not being used as a non-recursive browse path.
* Fix an issue with include path ordering of paths specified with the `-imsvc` argument.
* Fix a race condition that could result in incorrect include completion results.
* Avoid reporting an error due to multiple `didOpen` requests after a crash.
* Fix an inaccurate cursor position for IntelliSense update.
* Fix an IntelliSense crash if a "bad seq number" occurs.
* Fix processes potentially getting stuck on shutdown.
* Fix a potential crash when saving a file.
* Fix a random crash during code analysis.

## Version 1.23.6: February 6, 2025
### Bug Fixes
* Fix a bug with remote attach debugging. [#13137](https://github.com/microsoft/vscode-cpptools/issues/13137)
* Fix symlink-related regression bugs. [#13214](https://github.com/microsoft/vscode-cpptools/issues/13214), [#13228](https://github.com/microsoft/vscode-cpptools/issues/13228)
* Fix a regression bug when using 'Select IntelliSense Configuration'. [#13220](https://github.com/microsoft/vscode-cpptools/issues/13220)
* Fix a regression bug with `files.associations` handling. [#13223](https://github.com/microsoft/vscode-cpptools/issues/13223)

## Version 1.23.5: January 28, 2025
### Enhancements
* Modifications to the snippet completions to more closely match the snippets provided by TypeScript. [#4482](https://github.com/microsoft/vscode-cpptools/issues/4482)
* Enable setting multiple compile commands. [#7029](https://github.com/microsoft/vscode-cpptools/issues/7029)
  * Thank you for the contribution. [@yiftahw](https://github.com/yiftahw) [PR #12960](https://github.com/microsoft/vscode-cpptools/pull/12960)
* Changes to how paths are internally canonicalized on Linux and macOS, avoiding file system access to improve performance and delay resolution of symbolic links. [#12924](https://github.com/microsoft/vscode-cpptools/issues/12924)
* Add handling of `-fno-char8_t` and `-fchar8_t` compiler arguments. [#12968](https://github.com/microsoft/vscode-cpptools/issues/12968)
* Add support for providing well-known compiler argument information to Copilot Completions. [PR #12979](https://github.com/microsoft/vscode-cpptools/pull/12979)
* Fixed unnecessary cancellation of Copilot context requests. [PR #12988](https://github.com/microsoft/vscode-cpptools/pull/12988)
* Add support for passing an additional parameter to `C_Cpp.ConfigurationSelect` command. [PR #12993](https://github.com/microsoft/vscode-cpptools/pull/12993)
  * Thank you for the contribution. [@adrianstephens](https://github.com/adrianstephens)
* Update clang path setting descriptions. [PR #13071](https://github.com/microsoft/vscode-cpptools/pull/13071)
* Update clang-format and clang-tidy from 19.1.2 to 19.1.7.
* IntelliSense parser updates.

### Bug Fixes
* Fix a perf regression in hover operation by using cached lexer line states. [#3126](https://github.com/microsoft/vscode-cpptools/issues/3126)
* Fix `compile_commands.json` no longer being used if the containing folder is deleted and recreated. [#7030](https://github.com/microsoft/vscode-cpptools/issues/7030)
  * Thank you for the contribution. [@yiftahw](https://github.com/yiftahw) [PR #13032](https://github.com/microsoft/vscode-cpptools/pull/13032)
* Increase clang-format timeout from 10 seconds to 30 seconds. [#10213](https://github.com/microsoft/vscode-cpptools/issues/10213)
* Fix `C_Cpp.enhancedColorization` not taking effect after it's changed. [#10565](https://github.com/microsoft/vscode-cpptools/issues/10565)
* Fix changes to `files.encoding` not triggering a database reset. [#10892](https://github.com/microsoft/vscode-cpptools/issues/10892)
* Fix parameter hints interpreting `*` in a comment as markdown. [#11082](https://github.com/microsoft/vscode-cpptools/issues/11082)
* Fix an incorrect IntelliSense error when using `std::unique_ptr`. [#11979](https://github.com/microsoft/vscode-cpptools/issues/11979)
* Fix an incorrect IntelliSense error with designated initializers. [#12239](https://github.com/microsoft/vscode-cpptools/issues/12239)
* Fix handling of `koi8ru` and `koi8t` file encodings on Windows. [#12272](https://github.com/microsoft/vscode-cpptools/issues/12272)
* Fix description of `C_Cpp.preferredPathSeparator`. [#12597](https://github.com/microsoft/vscode-cpptools/issues/12597)
* Fix the IntelliSense process launching when it's disabled and the Copilot extension is used. [#12750](https://github.com/microsoft/vscode-cpptools/issues/12750), [#13058](https://github.com/microsoft/vscode-cpptools/issues/13058)
* Fix casing of path in include completion tooltip on Windows. [#12895](https://github.com/microsoft/vscode-cpptools/issues/12895)
* Fix a performance issue where some LSP requests would delay other LSP requests. [#12905](https://github.com/microsoft/vscode-cpptools/issues/12905)
* Fix some localization issues. [#12909](https://github.com/microsoft/vscode-cpptools/issues/12909), [#13090](https://github.com/microsoft/vscode-cpptools/issues/13090)
* Fix pattern matching of sections in `.editorConfig` files. [#12933](https://github.com/microsoft/vscode-cpptools/issues/12933)
* Fix handling of relative paths passed to cl.exe `/reference` argument. [#12944](https://github.com/microsoft/vscode-cpptools/issues/12944)
* Fix a leak of compile command file watchers. [#12946](https://github.com/microsoft/vscode-cpptools/issues/12946)
  * Thank you for the contribution. [@yiftahw](https://github.com/yiftahw) [PR #12948](https://github.com/microsoft/vscode-cpptools/pull/12948)
* Fix a compile commands fallback logic issue. [#12947](https://github.com/microsoft/vscode-cpptools/issues/12947)
  * Thank you for the contribution. [@yiftahw](https://github.com/yiftahw) [PR #12948](https://github.com/microsoft/vscode-cpptools/pull/12948)
* Fix an issue in which a `didOpen` event was processed before the language client was fully started. [#12954](https://github.com/microsoft/vscode-cpptools/issues/12954)
* Fix the IntelliSense mode being `macos` instead of `windows` when `_WIN32` is defined on macOS. [#13016](https://github.com/Microsoft/vscode-cpptools/issues/13016)
* Fix IntelliSense bugs when using non-UTF8 file encodings. [#13028](https://github.com/microsoft/vscode-cpptools/issues/13028), [#13044](https://github.com/microsoft/vscode-cpptools/issues/13044)
* Fix an incorrect translation for "binary operator". [#13048](https://github.com/microsoft/vscode-cpptools/issues/13048)
* Fix the "references may be missing" logging pane being shown when the `C_Cpp.loggingLevel` is `Error` or `None`. [#13066](https://github.com/microsoft/vscode-cpptools/issues/13066)
* Fix `C_Cpp.default.compilerPath` not using the `C_Cpp.preferredPathSeparator` setting when generated from the 'Select IntelliSense Configuration' command. [#13083](https://github.com/microsoft/vscode-cpptools/issues/13083)
* Fix a couple bugs with `.editorConfig` handling. [PR #13140](https://github.com/microsoft/vscode-cpptools/pull/13140)
* Fix a bug when processing a file with invalid multi-byte sequences. [#13150](https://github.com/microsoft/vscode-cpptools/issues/13150)
* Fix call hierarchy calls from. [#13200](https://github.com/microsoft/vscode-cpptools/issues/13200)
* Fix IntelliSense issues related to large header files (>32K) and encodings other than UTF-8.
* Update vsdbg from 17.12.10729.1 to 17.13.20115.1.
* Other internal fixes.
* Fix some deadlocks.
* Fix some crashes.

## Version 1.22.11: November 5, 2024
### Bug Fixes
* Fix system includes incorrectly being treated as non-system includes when specified with `-I`. [#12842](https://github.com/microsoft/vscode-cpptools/issues/12842)
* Fix inactive region ranges when multi-byte UTF-8 characters are used. [#12879](https://github.com/microsoft/vscode-cpptools/issues/12879)
* Fix formatting with `.editorconfig` files. [#12921](https://github.com/microsoft/vscode-cpptools/issues/12921)

## Version 1.23.0: October 29, 2024
### Enhancements
* Update to clang-format and clang-tidy 19.1.2. [#12824](https://github.com/microsoft/vscode-cpptools/issues/12824)
* Enable `#cpp` with GitHub Copilot chat without `C_Cpp.experimentalFeatures` enabled. [PR #12898](https://github.com/microsoft/vscode-cpptools/pull/12898)

### Bug Fixes
* Fix some translation issues. [#7824](https://github.com/microsoft/vscode-cpptools/issues/7824), [#12439](https://github.com/microsoft/vscode-cpptools/issues/12439), [#12440](https://github.com/microsoft/vscode-cpptools/issues/12440), [#12441](https://github.com/microsoft/vscode-cpptools/issues/12441)
* Fix a bug with 'Select IntelliSense Configuration'. [#12705](https://github.com/microsoft/vscode-cpptools/issues/12705)
* Fix newlines being removed from hover markdown code blocks. [#12794](https://github.com/microsoft/vscode-cpptools/issues/12794)
* Fix clang-format using `-` instead of `--` args. [#12819](https://github.com/microsoft/vscode-cpptools/issues/12819)
* Fix processing of `compile_commands.json` generated by the clang `-MJ` option. [#12837](https://github.com/microsoft/vscode-cpptools/issues/12837)
* Fix handling of `-I` and `-isystem` with the same path. [#12842](https://github.com/microsoft/vscode-cpptools/issues/12842)
* Fix stale colorization due to delays in updating the open file version. [PR #12851](https://github.com/microsoft/vscode-cpptools/pull/12851)
* Fix redundant progressive squiggle updates. [PR #12876](https://github.com/microsoft/vscode-cpptools/pull/12876)
* Fix inactive regions with multi-byte UTF-8 characters. [#12879](https://github.com/microsoft/vscode-cpptools/issues/12879)
* Fix some duplicate requests potentially not getting discarded.
* Fix a random crash in `start_process_and_wait_for_exit`.

## Version 1.22.10: October 21, 2024
### Bug Fixes
* Fix the 'Extract to Function' feature not working.
* Fix the 'Go to Next/Prev Preprocessor Conditional' feature not working.

## Version 1.22.9: October 14, 2024
### Performance Improvements
* Initialization performance improvements. [#12030](https://github.com/microsoft/vscode-cpptools/issues/12030)
  - Some processing is parallelized and started earlier (populating the filename cache, discovering files). [#11954](https://github.com/microsoft/vscode-cpptools/issues/11954), [#12169](https://github.com/microsoft/vscode-cpptools/issues/12169)
  - Some compiler configuration queries are cached in the database, and processing of compile_commands.json was improved. [#10029](https://github.com/microsoft/vscode-cpptools/issues/10029), [#12078](https://github.com/microsoft/vscode-cpptools/issues/12078)
* Performance improvements related to how custom configurations are processed. [#9003](https://github.com/microsoft/vscode-cpptools/issues/9003), [#12632](https://github.com/microsoft/vscode-cpptools/issues/12632)
* Improve the implementation of file buffers to reduce memory usage.
* Performance improvements related to LSP request processing.

### Enhancements
* Add modified `C_Cpp` settings to the `C/C++: Log Diagnostics` output. [#11700](https://github.com/microsoft/vscode-cpptools/issues/11700)
* Add better validation for settings. [#12371](https://github.com/microsoft/vscode-cpptools/issues/12371)
* Change the default C/C++ `"editor.stickyScroll.defaultModel"` to `"foldingProviderModel"`. [#12483](https://github.com/microsoft/vscode-cpptools/issues/12483)
* Remove the `C_Cpp.intelliSenseEngineFallback` setting. [#12596](https://github.com/microsoft/vscode-cpptools/issues/12596)
* Enable `C/C++: Log Diagnostics` without a C/C++ file being active. [#12634](https://github.com/microsoft/vscode-cpptools/issues/12634)
* Add "Additional Tracked Settings" to the `C/C++: Log Diagnostics` output. [PR #12635](https://github.com/microsoft/vscode-cpptools/pull/12635)
* Add support for providing additional context information to Copilot Chat. [PR #12685](https://github.com/microsoft/vscode-cpptools/pull/12685)
  * Currently, it requires `"C_Cpp.experimentalFeatures": "enabled"` and typing `#cpp` in the chat.
* The .vsix and .js files are now signed. [#12725](https://github.com/microsoft/vscode-cpptools/issues/12725), [#12744](https://github.com/microsoft/vscode-cpptools/issues/12744)
* Add the database path to the `C/C++: Log Diagnostics` output.
* Various IntelliSense parsing updates/fixes.

### Bug Fixes
* Fix the compiler selection control not keeping the list in sync with the contents of the textbox. [#7427](https://github.com/microsoft/vscode-cpptools/issues/7427)
* Fix a string localization issue. [#7824](https://github.com/microsoft/vscode-cpptools/issues/7824)
* Fix an issue with the 'Add #include' code action incorrectly using a relative path for a system include. [#12010](https://github.com/microsoft/vscode-cpptools/issues/12010)
* Fix an issue with lingering IntelliSense squiggles after an edit. [#12175](https://github.com/microsoft/vscode-cpptools/issues/12175)
* Fix hover over static constexpr variables sometimes not working. [#12284](https://github.com/microsoft/vscode-cpptools/issues/12284)
* Fix completion not giving results in several scenarios. [#12412](https://github.com/microsoft/vscode-cpptools/issues/12412)
* Stop logging duplicate compiler path messages. [#12445](https://github.com/microsoft/vscode-cpptools/issues/12445)
* Fix an issue where a file is incorrectly processed as C instead of C++. [#12466](https://github.com/microsoft/vscode-cpptools/issues/12466)
* Fix an issue with missing database symbols after a Rename operation. [#12480](https://github.com/microsoft/vscode-cpptools/issues/12480)
* Fix include path ordering being incorrect if there is a duplicate. [#12525](https://github.com/microsoft/vscode-cpptools/issues/12525)
* Fix a WebAssembly "Out of Memory" error. [#12529](https://github.com/microsoft/vscode-cpptools/issues/12529)
* Fix an error message not being shown if the connection failed with remote attach debugging. [#12547](https://github.com/microsoft/vscode-cpptools/issues/12547)
  * Thank you for the contribution. [@MrStanislav0 (Stanislav)](https://github.com/MrStanislav0)
* Fix `-I` not being used if `-iquote` is also used for the same path. [#12551](https://github.com/microsoft/vscode-cpptools/issues/12551)
* Fix issues with relative paths on `nvcc` (CUDA) command lines not being handled correctly. [#12553](https://github.com/microsoft/vscode-cpptools/issues/12553)
* Fix a crash on shutdown on macOS with a verbose logging level. [#12567](https://github.com/microsoft/vscode-cpptools/issues/12567)
* Fix a random crash when a child process is created. [#12585](https://github.com/microsoft/vscode-cpptools/issues/12585)
* Work around IntelliSense issues with clang 18 due to `size_t` not being defined. [#12618](https://github.com/microsoft/vscode-cpptools/issues/12618)
* Fix the `/FU` flag not working for C++/CLI. [#12641](https://github.com/microsoft/vscode-cpptools/issues/12641)
* Fix a crash in `find_existing_intellisense_client`. [#12666](https://github.com/microsoft/vscode-cpptools/issues/12666)
* Fix a rare crash on macOS related to `get_memory_usage`. [#12667](https://github.com/microsoft/vscode-cpptools/issues/12667)
* Fix an issue with 'Extract to Function' formatting. [#12677](https://github.com/microsoft/vscode-cpptools/issues/12677)
* Fix an issue with duplicate tag parsing occurring after a Rename operation. [#12728](https://github.com/microsoft/vscode-cpptools/issues/12728)
* Fix an issue preventing use of a full command line in `compilerPath`. [PR #12774](https://github.com/microsoft/vscode-cpptools/pull/12774)
* Fix an issue with clang-format/tidy version checks for some builds. [#12806](https://github.com/microsoft/vscode-cpptools/issues/12806)
* Fix an issue causing unnecessary TU updates for files opened during a Rename operation, when `"files.refactoring.autoSave": false` is used.
* Fix some issues with recursive includes handling of symbolic links, multi-root, exclusion changes, and file/folder deletion.
* Fix unnecessary IntelliSense resetting when a new file or folder was created.
* Fix an infinite loop on shutdown after changing the selected settings.
* Fix accumulation of stale signature help and completion requests.
* Fix handling of the `compiler-binddir` compiler argument.
* Fix a random crash during IntelliSense creation.
* Fix some bugs with include completion.

## Version 1.21.6: August 5, 2024
* Fix a cpptools-srv crash on shutdown. [#12354](https://github.com/microsoft/vscode-cpptools/issues/12354)

## Version 1.21.5: July 31, 2024
### Bug Fixes
* Fix clang-format and clang-tidy not working on Windows 10. [#12289](https://github.com/microsoft/vscode-cpptools/issues/12289)
* Fix a crash with cpptools-srv on certain macOS versions. [#12354](https://github.com/microsoft/vscode-cpptools/issues/12354)
* Fix cpptools crashing on macOS Big Sur or older. [#12511](https://github.com/microsoft/vscode-cpptools/issues/12511)
* Fix debugging on Windows ARM64. [#12520](https://github.com/microsoft/vscode-cpptools/issues/12520)

## Version 1.21.4: July 25, 2024
* Re-enable compatibility with VS Code 1.67.0 (instead of 1.82.0). [#12507](https://github.com/microsoft/vscode-cpptools/issues/12507)

## Version 1.21.3: July 24, 2024
* Fix a crash on Linux ARM OS's. [#12497](https://github.com/microsoft/vscode-cpptools/issues/12497)

## Version 1.21.2: July 12, 2024
### Enhancements
* Add `see` and `sa` to the `C_Cpp.doxygen.sectionTags` setting. [#12384](https://github.com/microsoft/vscode-cpptools/issues/12384)
* Update the vcpkg header database. [PR #12430](https://github.com/microsoft/vscode-cpptools/pull/12430)
* Disable the pre-release prompt if the `extensions.ignoreRecommendations` setting is `true`. [#12438](https://github.com/microsoft/vscode-cpptools/issues/12438)
* Switch to an alternative workspace symbol search implementation (performance and results will be slightly different from previous versions).
* Various IntelliSense engine updates/fixes.

### Bug Fixes
* Stop logging file watch events for excluded files. [#11455](https://github.com/microsoft/vscode-cpptools/issues/11455)
* Fix a crash if the Ryzen 3000 doesn't have updated drivers. [#12201](https://github.com/microsoft/vscode-cpptools/issues/12201)
* Fix handling of `-isystem` and `-iquote` for IntelliSense configuration. [#12207](https://github.com/microsoft/vscode-cpptools/issues/12207)
* Fix doxygen comment generation when `/**` comments are used. [#12249](https://github.com/microsoft/vscode-cpptools/issues/12249)
* Fix a code analysis crash on Linux if the message is too long. [#12285](https://github.com/microsoft/vscode-cpptools/issues/12285)
* Fix relative paths in `compile_commands.json` to be relative to the `compile_commands.json`'s directory. [#12290](https://github.com/microsoft/vscode-cpptools/issues/12290)
* Fix a tag parser performance regression. [#12292](https://github.com/microsoft/vscode-cpptools/issues/12292)
* Fix a regression with cl.exe system include path detection. [#12293](https://github.com/microsoft/vscode-cpptools/issues/12293)
* Fix code analysis, find all references, and rename from getting the wrong configuration for non-open files on the first run when using a configuration provider. [#12313](https://github.com/microsoft/vscode-cpptools/issues/12313)
* Fix handling of doxygen comment blocks with `*//*` in them. [#12316](https://github.com/microsoft/vscode-cpptools/issues/12316)
* Fix potential crashes during IntelliSense process shutdown. [#12354](https://github.com/microsoft/vscode-cpptools/issues/12354)
* Fix the language status not showing it's busy while the tag parser is initializing. [#12403](https://github.com/microsoft/vscode-cpptools/issues/12403)
* Fix the vcpkg code action not appearing for missing headers available via vcpkg. [#12413](https://github.com/microsoft/vscode-cpptools/issues/12413)
* Fix custom configurations sometimes not getting used. [PR #12427](https://github.com/microsoft/vscode-cpptools/pull/12427)
* Fix a code analysis error when using gcc 14. [#12428](https://github.com/microsoft/vscode-cpptools/issues/12428)
* Fix warning notification showing when `C_Cpp.getIncludes` is disabled. [PR #12470](https://github.com/microsoft/vscode-cpptools/pull/12470)
* Fix a cause of colorization, inactive regions, and inlay hints getting cleared when an update is pending.
* Update the default clang/gcc versions used for IntelliSense if an unknown version is found.
* Fix a cause of semantic tokens transiently being placed in the wrong location.
* Update clang-format and clang-tidy from 18.1.2 to 18.1.7 (for the bug fixes).
* Fix a potential deadlock when configured using compile commands.

## Version 1.20.5: May 6, 2024
### Enhancements
* Add support for C++ modules IFC version 0.43. [#10843](https://github.com/microsoft/vscode-cpptools/issues/10843)
* Add support for `${userHome}` in `c_cpp_properties.json`. [#11756](https://github.com/microsoft/vscode-cpptools/issues/11756)
* Reduce the default max workspace symbol search results and add `C_Cpp.maxSymbolSearchResults`. [PR #12131](https://github.com/microsoft/vscode-cpptools/pull/12131)
* Update `clang-format`/`clang-tidy` to 18.1.2. [PR #12135](https://github.com/microsoft/vscode-cpptools/pull/12135)
* Log `cpptools` and `cpptools-srv` crash call stacks in the 'C/C++ Crash Call Stacks' Output channel for bug reporting (on x64 Linux and x64/arm64 Mac).
* Increase the fuzzy symbol character limit from 16 to 28.
* Update the IntelliSense engine.

### Bug Fixes
* Fix an IntelliSense parsing issue. [#6183](https://github.com/microsoft/vscode-cpptools/issues/6183)
* Fix 'Copy Declaration / Definition' code not being formatted. [#10956](https://github.com/microsoft/vscode-cpptools/issues/10956)
* Fix semantic colorization of certain macro arguments. [#11416](https://github.com/microsoft/vscode-cpptools/issues/11416)
* Fix 'Add #include' code actions for code scoped by a namespace or class. [#11541](https://github.com/microsoft/vscode-cpptools/issues/11541)
* Fix 'Create Declaration / Definition' not working if the cursor isn't on the function name. [#11834](https://github.com/microsoft/vscode-cpptools/issues/11834)
* Fix duplicate 'Add #include' code actions. [#11989](https://github.com/microsoft/vscode-cpptools/issues/11989)
* Fix directories being incorrectly recursively traversed in certain cases. [#11993](https://github.com/microsoft/vscode-cpptools/issues/11993)
* Fix `forcedInclude` resolution for relative paths. [PR #12035](https://github.com/microsoft/vscode-cpptools/pull/12035)
* Fix 'Add Configuration...' in `launch.json` when `editor.suggest.showSnippets` is `false`. [#12059](https://github.com/microsoft/vscode-cpptools/issues/12059)
* Fix `c_cpp_properties.json` warnings for `includePath`s with `**` wildcard glob patterns. [#12070](https://github.com/microsoft/vscode-cpptools/issues/12070)
* Fix non-existent relative path variables not showing a warning in `c_cpp_properties.json` (and other related issues). [#12089](https://github.com/microsoft/vscode-cpptools/issues/12089)
* Fix call stacks for `cpptools` and `cpptools-srv` not being available on Linux. [#12091](https://github.com/microsoft/vscode-cpptools/issues/12091)
* Fix IntelliSense processes shutting down immediately if not enough memory is detected. [#12126](https://github.com/microsoft/vscode-cpptools/issues/12126)
* Fix code analysis aborting after encountering an excluded file (instead of just skipping it). [#12127](https://github.com/microsoft/vscode-cpptools/issues/12127)
* Fix `"Cannot open source"` errors on missing includes not appearing if `C_Cpp.errorSquiggles` is `enabled`. [#12134](https://github.com/microsoft/vscode-cpptools/issues/12134)
* Fix the IntelliSense server not starting when a completion, signature help, or document highlight occurs from external commands. [#12143](https://github.com/microsoft/vscode-cpptools/issues/12143)
* Fix the IntelliSense configuration not falling back to the `c_cpp_properties.json` configuration for a file not handled by a configuration provider. [#12144](https://github.com/microsoft/vscode-cpptools/issues/12144)
* Fix duplicate URIs in calls to provideConfigurations. [#12177](https://github.com/microsoft/vscode-cpptools/issues/12177)
* Fix a crash and deadlock with a high `C_Cpp.loggingLevel`. [#12194](https://github.com/microsoft/vscode-cpptools/issues/12194)
* Fix handling of `-iquote` for code analysis and `#include` completions. [#12198](https://github.com/microsoft/vscode-cpptools/issues/12198)
* Fix a crash during startup. [#12237](https://github.com/microsoft/vscode-cpptools/issues/12237)
* Fix IntelliSense configuration on Windows ARM64. [#12253](https://github.com/microsoft/vscode-cpptools/issues/12253)
* Fix a `cpptools` process crash and deadlock during shutdown.

## Version 1.19.9: March 20, 2024
### Bug Fixes
* Fix an issue with Cygwin system headers not being properly detected. [#12113](https://github.com/microsoft/vscode-cpptools/issues/12113)
* Fix a crash in cpptools-srv when low on memory. [#12121](https://github.com/microsoft/vscode-cpptools/issues/12121)
* Fix an issue preventing cpptools-srv from being relaunched after a crash.

## Version 1.19.8: March 13, 2024
### Bug Fixes
* Fix an issue with applying the proper working directory from a `compile_commands.json` when a `compilePath` is also set. [#12024](https://github.com/microsoft/vscode-cpptools/issues/12024)
* Fix a deadlock. [#12051](https://github.com/microsoft/vscode-cpptools/issues/12051)
* Fix a crash that could occur when failing to query clang-cl.
* Fix an issue with handling of `winsysroot` args for clang-cl.
* Fix an issue with processing relative include paths returned by clang-cl.

## Version 1.19.7: March 11, 2024
### Bug Fixes
* Fix some potential deadlocks. [#12051](https://github.com/microsoft/vscode-cpptools/issues/12051)
* Fix a crash related to parsing concepts. [#12060](https://github.com/microsoft/vscode-cpptools/issues/12060)
* Fix flickering status updates in the language status bar. [#12084](https://github.com/microsoft/vscode-cpptools/issues/12084)
* Fix a cpptools crash that can occur if cpptools-srv crashes on initialization.

## Version 1.19.6: March 6, 2024
### Enhancement
* Performance improvement.

## Version 1.19.5: March 4, 2024
### Enhancements
* Change how `args` and `command` fields are handled in `cppbuild` tasks, to match the behavior of VS Code `shell` build tasks, including explicit `quoting` support. [#12001](https://github.com/microsoft/vscode-cpptools/issues/12001)
* Enable C23 IntelliSense support, and add support for `clatest` `std` value for MSVC. [#12020](https://github.com/microsoft/vscode-cpptools/issues/12020)

### Bug Fixes
* Fix the IntelliSense cache not being pruned. [#11925](https://github.com/microsoft/vscode-cpptools/issues/11925)
* Fix an issue with duplicate `Add #include` code actions appearing if the same header name exists in multiple locations. [#11989](https://github.com/microsoft/vscode-cpptools/issues/11989)
* Fix compiler querying with a `-index-store-path` argument. [#12012](https://github.com/microsoft/vscode-cpptools/issues/12012)
* Fix an issue with changes to `C_Cpp.inlayHints` settings not taking effect immediately. [#12013](https://github.com/microsoft/vscode-cpptools/issues/12013)
* Fix an issue with how Doxygen `brief` and `param` are displayed on hover. [#12015](https://github.com/microsoft/vscode-cpptools/issues/12015)
* Fix an issue preventing the extension from functioning if installed via snap on Linux. [#12021](https://github.com/microsoft/vscode-cpptools/issues/12021)
* Fix compiler querying with a `-Xclang -mllvm` argument. [#12024](https://github.com/microsoft/vscode-cpptools/issues/12024)
* Fix the include graph lookup not occurring for source files. [#12036](https://github.com/microsoft/vscode-cpptools/issues/12036)
* Fix exclusions not applying to dependent headers with recursive includes. [#12042](https://github.com/microsoft/vscode-cpptools/issues/12042)
* Fix a potential cpptools process hang on shutdown.

## Version 1.19.4: February 21, 2024
### Enhancements
* Enable support for fuzzy symbol searches. [#2751](https://github.com/microsoft/vscode-cpptools/issues/2751)
  * This may not be enabled for all users unless `C_Cpp.experimentalFeatures` is `enabled`.
* Implement progressive population of IntelliSense results. [#7759](https://github.com/microsoft/vscode-cpptools/issues/7759)
* Improve performance of symbol searches. [#7908](https://github.com/microsoft/vscode-cpptools/issues/7908), [#7914](https://github.com/microsoft/vscode-cpptools/issues/7914), [#11557](https://github.com/microsoft/vscode-cpptools/issues/11557)
  * This may not be enabled for all users unless `C_Cpp.experimentalFeatures` is `enabled`.
* Support insert mode for auto-complete. [#10613](https://github.com/microsoft/vscode-cpptools/issues/10613)
  * Use the `"[cpp]": { "editor.suggest.insertMode": "insert" } ` and `"[c]": { "editor.suggest.insertMode": "insert" } ` settings to override the extension's defaults.
* Improve memory efficiency by using token parsing in the 'Add #include' feature. [#11515](https://github.com/microsoft/vscode-cpptools/issues/11515)
* Change the default setting value for `C_Cpp.intelliSenseUpdateDelay` from 2s to 1s. [PR #11932](https://github.com/microsoft/vscode-cpptools/pull/11932)
* Improve the types supported for the 'Add #include' code action.
* Various performance improvements.

### Bug Fixes
* Fix IntelliSense bug with type deduction using concepts. [#8132](https://github.com/microsoft/vscode-cpptools/issues/8132)
* Fix clang-format error messages not being logged. [#8944](https://github.com/microsoft/vscode-cpptools/issues/8944)
* Fix indentation missing in markdown fenced code blocks. [#11379](https://github.com/microsoft/vscode-cpptools/issues/11379)
* Fix shell escaping for `cppbuild` task command line arguments. [#11422](https://github.com/microsoft/vscode-cpptools/issues/11422)
* Fix IntelliSense not updating when a `#include` is added from a refactor command. [#11549](https://github.com/microsoft/vscode-cpptools/issues/11549)
* Fix 'Add '#include' code actions for Mac frameworks. [#11579](https://github.com/microsoft/vscode-cpptools/issues/11579)
* Fix the parent path of the source file in `compile_commands.json` not being added to the browse.path. [#11631](https://github.com/microsoft/vscode-cpptools/issues/11631)
* Fix the database not getting updated in certain cases when switching configurations. [#11649](https://github.com/microsoft/vscode-cpptools/issues/11649)
* Fix a cpptools crash with certain projects. [#11674](https://github.com/microsoft/vscode-cpptools/issues/11674)
* Fix snippet and include completion. [#11715](https://github.com/microsoft/vscode-cpptools/issues/11715), [#11720](https://github.com/microsoft/vscode-cpptools/issues/11720)
* Fix formatting not working in headers after using 'Extract to Function'. [#11729](https://github.com/microsoft/vscode-cpptools/issues/11729)
* Fix document symbol requests not checking for cancellation. [#11750](https://github.com/microsoft/vscode-cpptools/issues/11750)
* Fix the default `editor.wordBasedSuggestions` setting for VS Code versions 1.85 or newer. [PR #11773](https://github.com/microsoft/vscode-cpptools/pull/11773)
  * This change doesn't work with VS Code versions 1.84 or older, due to [Microsoft/vscode#200685](https://github.com/microsoft/vscode/issues/200685)
* Fix code analysis results getting cleared after there's a configuration update. [#11790](https://github.com/microsoft/vscode-cpptools/issues/11790)
* Fix an exception getting thrown if IntelliSense is disabled but a configuration provider is registered. [#11795](https://github.com/microsoft/vscode-cpptools/issues/11795)
* Fix an EACCES error when using include wildcards with system includes. [#11833](https://github.com/microsoft/vscode-cpptools/issues/11833)
* Fix German code analysis translations. [PR #11845](https://github.com/microsoft/vscode-cpptools/pull/11845)
  * Thank you for the contribution. [@Sir2B (Tobias Obermayer)](https://github.com/Sir2B)
* Trim trailing spaces from include paths in the configuration UI. [#11862](https://github.com/microsoft/vscode-cpptools/issues/11862)
* Fix comma delimited lists in `@param` Doxygen parameters. [#11868](https://github.com/microsoft/vscode-cpptools/issues/11868)
* Fix incorrect errors for `compilerPath` in the configuration UI for compilers that can be found in PATH. [#11903](https://github.com/microsoft/vscode-cpptools/issues/11903)
* Fix an issue with include sorting when formatting with clang-format. [#11914](https://github.com/microsoft/vscode-cpptools/issues/11914)
* Fix the `-include` arg of `-Xarg_<arg1>` getting filtered out, leading to a failed compiler query. [#11965](https://github.com/microsoft/vscode-cpptools/issues/11965)
* Fix the `-arch` flag overwriting the `-target` flag's value when it shouldn't. [#11971](https://github.com/microsoft/vscode-cpptools/issues/11971)
* Fix an issue in which the directory specified in a `compile_commands.json` was not being used as the current directory when querying the specified compiler path.
* Fix an issue with configuring IntelliSense for a header file after having chosen an associated source file in which inclusion of the header is disabled or removed.
* Fix an issue where use of an explicit `compilerPath` to override the compiler in a `compile_commands.json` will also throw out the compiler arguments.
* Fix IntelliSense passes occurring while a user is still typing, instead of honoring the `C_Cpp.intelliSenseUpdateDelay` setting.
* Fix issues related to support for C++ modules and parsing of related compiler arguments.
* Fix issues with the tag parsing status sometimes not being accurately reflected in the UI.
* Fix document and workspace symbol requests being blocked by an IntelliSense request.
* Remove the requirement that a file be open in the editor from various LSP requests.
* Fix a crash if `compile_commands.json` doesn't have an array at the root.
* Fix a call hierarchy bug leading to use of header-only TU's unnecessarily.
* Fix an issue that could result in the Outline pane not being populated.
* Fix a bug that could lead to missing TU source file candidates.
* Address multiple issues with compiler querying of clang-cl.
* Fix a potential crash when using 'Find All References'.
* Fix a "random" IntelliSense crash during completion.
* Fix a crash if access to `/dev/urandom` is restricted.
* Fix some crashes reported by crash telemetry.
* Lots of other minor fixes.

## Version 1.18.5: November 16, 2023
### Bug Fix
* Fix `~/vscode-cpptools` being used as the cache folder instead of `~/.cache/vscode-cpptools` on Linux. [#11693](https://github.com/microsoft/vscode-cpptools/issues/11693)

## Version 1.18.4: November 14, 2023
### Bug Fixes:
* Fix 'Extract to function' not scrolling to and selecting the added header declaration. [#11676](https://github.com/microsoft/vscode-cpptools/issues/11676)
* Fix the extension sometimes failing to activate with VS Code versions less than 1.85. [#11680](https://github.com/microsoft/vscode-cpptools/issues/11680)

## Version 1.18.3: November 13, 2023
### New Features
* Add an 'Extract to function' (or member function) code action after selecting code. [#1162](https://github.com/microsoft/vscode-cpptools/issues/1162)
* Compiler acquisition improvements. [#10525](https://github.com/microsoft/vscode-cpptools/issues/10525)
* Provide `Add '#include'` code action suggestions for IntelliSense errors related to symbols not being found. [#10791](https://github.com/microsoft/vscode-cpptools/issues/10791)

### Enhancements
* Add keyboard support for 'Inline Macro'. [#11260](https://github.com/microsoft/vscode-cpptools/issues/11260)
* Add setting `C_Cpp.refactoring.includeHeader` to customize whether or not to add an include header when doing a refactoring code action. [#11271](https://github.com/microsoft/vscode-cpptools/issues/11271)
* Improve the walkthrough wording. [#11320](https://github.com/microsoft/vscode-cpptools/issues/11320)
* Update clang-format and clang-tidy to 17. [PR #11491](https://github.com/microsoft/vscode-cpptools/pull/11491)
* Add a pre-release available notification. [PR #11569](https://github.com/microsoft/vscode-cpptools/pull/11569)

### Bug Fixes
* Fix the debugger truncating long strings when inspecting values. [#1786](https://github.com/microsoft/vscode-cpptools/issues/1786)
* Switch to using `XDG_CACHE_HOME` on Linux for the default database path. [#10191](https://github.com/microsoft/vscode-cpptools/issues/10191)
* Fix an IntelliSense error with std::is_trivially_copyable_v. [#10712](https://github.com/microsoft/vscode-cpptools/issues/10712)
* Fix incorrect status and commands with the tag parsing language status UI. [#10749](https://github.com/microsoft/vscode-cpptools/issues/10749)
* Fix an empty (`""`) `compilerPath` in a base configuration overriding the compiler specified by a custom configuration provider or a `compile_commands.json`. [#11373](https://github.com/microsoft/vscode-cpptools/issues/11373)
* Fix a startup crash when reading values from JSON (settings) that are not the type expected. [#11375](https://github.com/microsoft/vscode-cpptools/issues/11375)
* Fix a crash detected by crash telemetry. [#11401](https://github.com/microsoft/vscode-cpptools/issues/11401)
* Fix handling of an undefined `env` variable on Linux and macOS. [#11447](https://github.com/microsoft/vscode-cpptools/issues/11447)
* Fix multiple issues with querying `nvcc` (CUDA) as a compiler. [#11454](https://github.com/microsoft/vscode-cpptools/issues/11454)
* Fix an IntelliSense crash when hovering over an invalid array index expression. [#11510](https://github.com/microsoft/vscode-cpptools/issues/11510)
* Fix an issue that could cause a C language standard to be applied to a C++ file, or vice versa.
* Remove `cpp` and `clang-cpp` preprocessors from the list of detectable compilers.
* Fix an autocomplete crash bug (primarily on Mac).

## Version 1.17.5: August 28, 2023
### Bug Fixes
* Fix a language server crash for platforms that don't support the IntelliSense cache (AutoPCH). [#10789](https://github.com/microsoft/vscode-cpptools/issues/10789)
* Fix markdown in comments when inline/block code is used. [#11322](https://github.com/microsoft/vscode-cpptools/issues/11322)
* Fix Find All References and Call Hierarchy for C files when the cursor is at the end of a symbol. [#11338](https://github.com/microsoft/vscode-cpptools/issues/11338)
* Fix usage of the `/Zc:alignedNew-` MSVC compiler option. [#11350](https://github.com/microsoft/vscode-cpptools/issues/11350)

## Version 1.17.4: August 21, 2023
### Bug Fixes
* Fix crash recovery for the main extension process. [#11335](https://github.com/microsoft/vscode-cpptools/issues/11335)
* Fix an IntelliSense process crash when certain error messages occur with a language pack enabled. [#11336](https://github.com/microsoft/vscode-cpptools/issues/11336)

## Version 1.17.3: August 16, 2023
### Bug Fix
* Fix a regression with attaching the debugger to processes on Linux and macOS. [#11328](https://github.com/microsoft/vscode-cpptools/issues/11328)

## Version 1.17.2: August 14, 2023
### Enhancements
* Enable a subset of markdown to render in hover by default and a `C_Cpp.markdownInComments` setting. [#6020](https://github.com/microsoft/vscode-cpptools/issues/6020), [#10461](https://github.com/microsoft/vscode-cpptools/issues/10461)
* Add support for gcc 13 features. [#11038](https://github.com/microsoft/vscode-cpptools/issues/11038)
* Add default compiler detection of additional compilers in MSYS environments. [#11211](https://github.com/microsoft/vscode-cpptools/issues/11211)
* Use musl for building Linux binaries of the extension.
* Add support for additional compiler wrappers: gomacc, distcc, buildcache, and icecc.

### Bug Fixes
* Fix a couple bugs with documentation comments. [#5241](https://github.com/microsoft/vscode-cpptools/issues/5241)
* Added `__float128` support in gcc IntelliSense mode. [#9558](https://github.com/microsoft/vscode-cpptools/issues/9558)
* Fix an issue where the debugger would get stuck while using cl.exe options. [#10231](https://github.com/microsoft/vscode-cpptools/issues/10231)
* Fix C/C++ commands showing in the Command Palette with non-C/C++ files. [#10421](https://github.com/microsoft/vscode-cpptools/issues/10421)
* Fix the 'Select IntelliSense Configuration' command to also update an existing `compilerPath` in c_cpp_properties.json. [#10808](https://github.com/microsoft/vscode-cpptools/issues/10808)
* Update clang-format (and clang-tidy) to 16.0.6 to fix a bug. [#11027](https://github.com/microsoft/vscode-cpptools/issues/11027)
* Fix `#include` completion leaving an extra `>`. [#11042](https://github.com/microsoft/vscode-cpptools/issues/11042)
* Fix an issue with matching of glob patterns containing path delimiters. [#11132](https://github.com/microsoft/vscode-cpptools/issues/11132)
* Fix Create Declaration/Definition via `Quick Fix…` from hover tooltip. [#11157](https://github.com/microsoft/vscode-cpptools/issues/11157)
* Fix issues with compiler querying of clang-cl. [#11207](https://github.com/microsoft/vscode-cpptools/issues/11207)
* Fix `files.encoding` setting on startup. [#11210](https://github.com/microsoft/vscode-cpptools/issues/11210)
* Fix a crash related to directories with a very large number of files. [#11226](https://github.com/microsoft/vscode-cpptools/issues/11226)
* Fix the parameter format of call hierarchy items. [#11247](https://github.com/microsoft/vscode-cpptools/issues/11247)
* Remove the vcpkg code action from the missing includes code action list. [#11252](https://github.com/microsoft/vscode-cpptools/issues/11252)
* Fix the file path info of call hierarchy items to display the relative path to a workspace folder. [#11254](https://github.com/microsoft/vscode-cpptools/issues/11254)
* Fix colorization for macro expansions in macro arguments. [#11256](https://github.com/microsoft/vscode-cpptools/issues/11256)
* Fix a crash for CUDA projects with '>' in the command line. [#11289](https://github.com/microsoft/vscode-cpptools/issues/11289)
* Increase the default standard for the 'Build and Debug Active File' feature to c++14 on macOS. [#11292](https://github.com/microsoft/vscode-cpptools/issues/11292)
* Fix an issue with the compiler currently configured for use with IntelliSense being listed last in the task creation popup. [PR #11299](https://github.com/microsoft/vscode-cpptools/pull/11299)
* Fix an IPCH issue on Linux due to the Position Independent Executable (PIE) option not being set since 1.17.0.
* Fix Rank > 1 Display Strings for Natvis. [PR MIEngine#1406](https://github.com/microsoft/MIEngine/pull/1406)
* Fix some crashes identified by crash telemetry.
* Fix an issue that could cause zombie processes on Linux/Mac.
* Address some issues with glibc version compatibility. Native binaries for cpptools and the bundled clang-tidy/clang-format are now built with musl and fully statically linked.
* Fix the wrong compiler being set as default when configured to use `compile_commands.json` and overriding the compiler used there with an explicit `compilerPath`.

### Thank You to the Contributors
* [@gareth-rees (Gareth Rees)](https://github.com/gareth-rees): Always use `--simple-values` in newer versions of GDB. [PR MIEngine#1400](https://github.com/microsoft/MIEngine/pull/1400)
* [@iAbadia (Iñaki)](https://github.com/iAbadia): Align use of 'sendInvalidate' request arguments. [PR MIEngine#1402](https://github.com/microsoft/MIEngine/pull/1402)
* [@intel-rganesh (Rakesh Ganesh)](https://github.com/intel-rganesh): Introduce `--thread` and `--frame options`. [PR MIEngine#1401](https://github.com/microsoft/MIEngine/pull/1401)
* [@michalmaka (Michał Mąka)](https://github.com/michalmaka): Add support for Toybox to the remote process picker. [PR #11175](https://github.com/microsoft/vscode-cpptools/pull/11175)
* [@sbobko (Sergey Bobko)](https://github.com/sbobko): Add 'sendInvalidate' request. [PR MIEngine#1367](https://github.com/microsoft/MIEngine/pull/1367)
* [@yne (Rémy F.)](https://github.com/yne): Add wildcard support for `includePath`. [PR #10388](https://github.com/microsoft/vscode-cpptools/pull/10388)

## Version 1.16.3: June 23, 2023
### Bug Fix
* Fix "cout is ambiguous" error. [#11122](https://github.com/microsoft/vscode-cpptools/issues/11122)

## Version 1.16.2: June 22, 2023
### New Features
* Add Call Hierarchy. [#16](https://github.com/microsoft/vscode-cpptools/issues/16)
* Add "Copy Definition" and "Copy Declaration" code actions (for when the default Create placement isn't desired). [#10238](https://github.com/microsoft/vscode-cpptools/issues/10238), [#10942](https://github.com/microsoft/vscode-cpptools/issues/10942)

### Enhancements
* Add support for other glob pattern syntax, such as `[]` and `^`. [#8960](https://github.com/microsoft/vscode-cpptools/issues/8960)
* Add support for C++23 z/Z and zu/ZU suffixes in clang/gcc modes. [#10190](https://github.com/microsoft/vscode-cpptools/issues/10190)
* Add warning logging when the database is reset due to a version change. [#10984](https://github.com/microsoft/vscode-cpptools/issues/10984)
* Move user compilers to the beginning of the "known compilers" lists. [#10985](https://github.com/microsoft/vscode-cpptools/issues/10985)
* Add file path to the details of a call hierarchy result. [#10997](https://github.com/microsoft/vscode-cpptools/issues/10997)
* Add `miDebuggerArgs` to debugger attach option.
  * Thank you for the contribution @Summon528 [PR #11066](https://github.com/microsoft/vscode-cpptools/pull/11066)

### Bug Fixes
* Fix an IntelliSense parsing bug with C++20 ranges. [#8039](https://github.com/microsoft/vscode-cpptools/issues/8039)
* Fix incorrect insertion of Create Declaration/Definition when it also adds a #include. [#10464](https://github.com/microsoft/vscode-cpptools/issues/10464)
* Fix an IntelliSense bug with user-defined floating-point literals. [#10837](https://github.com/microsoft/vscode-cpptools/issues/10837)
* Fix deadlock with Find All References. [#10855](https://github.com/microsoft/vscode-cpptools/issues/10855)
* Fix performance issues on machines with > 32 threads. [#10874](https://github.com/microsoft/vscode-cpptools/issues/10874)
* Fix localization of "C/C++ Configurations". [#10907](https://github.com/microsoft/vscode-cpptools/issues/10907)
* Fix the workspace folder not getting added to the browse.path in some cases. [#10914](https://github.com/microsoft/vscode-cpptools/issues/10914)
* Fix incorrect Apple clang to LLVM clang version mappings. [#10920](https://github.com/microsoft/vscode-cpptools/issues/10920)
* Revert -fms-extensions being added for mingw compilers by default (due to bugs). [#10940](https://github.com/microsoft/vscode-cpptools/issues/10940)
* Fix the "known compilers" list not getting updated with "user compilers". [#10943](https://github.com/microsoft/vscode-cpptools/issues/10943)
* Fix cancelation of Find All References while confirming references. [#10947](https://github.com/microsoft/vscode-cpptools/issues/10947)
* Fix a bug with workspace parsing status. [PR #10974](https://github.com/microsoft/vscode-cpptools/pull/10974)
* Fix some bugs if settings were empty string or null. [#10994](https://github.com/microsoft/vscode-cpptools/issues/10994)
* Fix cancellation for Find All References/Rename/Call Hierarchy. [#10998](https://github.com/microsoft/vscode-cpptools/issues/10998)
* Fix two Doxygen comment generation bugs. [#10995](https://github.com/microsoft/vscode-cpptools/issues/10995), [#11016](https://github.com/microsoft/vscode-cpptools/issues/11016)
* Fix the thread pool sometimes not increasing in size, which could lead to the cpptools process incorrectly being shut down. [#11003](https://github.com/microsoft/vscode-cpptools/issues/11003)
* Stop using vcFormat if .editorconfig exists with only non-formatting cpp settings. [PR #11015](https://github.com/microsoft/vscode-cpptools/pull/11015)
* Use integratedTerminal when user is running cl.exe for debugger. [#11032](https://github.com/microsoft/vscode-cpptools/issues/11032)
  * Thank you for the contribution @caiohamamura [PR #11035](https://github.com/microsoft/vscode-cpptools/pull/11035)
* Fix the configure your IntelliSense notification to not show again when the "Don't Show Again" option is selected. [#11070](https://github.com/microsoft/vscode-cpptools/issues/11070)
* Fix a bug that could cause incomplete reading of stdout/stderr of child processes on Windows.
* Fix incorrect "declaration is incompatible" IntelliSense errors.
* Fix some potential crashes.

## Version 1.15.4: May 1, 2023
### Enhancements
* Support multiple natvis files in `visualizerFile`. [#925](https://github.com/microsoft/vscode-cpptools/issues/925)
* Enable error squiggles for single file mode if includes resolve. [#10062](https://github.com/microsoft/vscode-cpptools/issues/10062)
* Improve the description of the `C_Cpp.codeAnalysis.clangTidy.enabled` setting. [#10454](https://github.com/microsoft/vscode-cpptools/issues/10454)
* Add a 'Select an IntelliSense configuration' code action and error message for standard headers which can't be found. [#10531](https://github.com/microsoft/vscode-cpptools/issues/10531)
* Change the 'Edit "includePath" setting' code action to reference "compilerPath" for missing system includes. [#10675](https://github.com/microsoft/vscode-cpptools/issues/10675)
* Add a "Configure IntelliSense" status bar warning (currently controlled by an experiment). [#10685](https://github.com/microsoft/vscode-cpptools/issues/10685)
* Re-enable an updated C/C++ walkthrough (currently only available for some users). [PR #10707](https://github.com/microsoft/vscode-cpptools/pull/10707)
* Update to clang-format/tidy 16. [#10725](https://github.com/microsoft/vscode-cpptools/issues/10725)
* Move the configuration status bar item out of the language status UI. [#10755](https://github.com/microsoft/vscode-cpptools/issues/10755)
* Change `Select Default Compiler` to `Select IntelliSense Configuration` with configuration providers and compile commands added. [#10756](https://github.com/microsoft/vscode-cpptools/issues/10756)

### Bug Fixes
* Support use of `ccache`, 'sccache', and 'clcache' in `compilerPath` and `compile_commands.json` command lines. [#7616](https://github.com/microsoft/vscode-cpptools/issues/7616)
* Enable `-fms-extensions` by default for Cygwin and MinGW. [#8353](https://github.com/microsoft/vscode-cpptools/issues/8353)
* Fix incorrect, excessive logging with compile commands. [#9865](https://github.com/microsoft/vscode-cpptools/issues/9865)
* Fix IntelliSense errors with C++ 20 range and span. [#10024](https://github.com/microsoft/vscode-cpptools/issues/10024), [#10252](https://github.com/microsoft/vscode-cpptools/issues/10252)
* Fix two vcFormat settings being inverted. [#10262](https://github.com/microsoft/vscode-cpptools/issues/10262), [#10263](https://github.com/microsoft/vscode-cpptools/issues/10263)
* Fix 'Create Declaration / Definition' making modifications to files outside the workspace folder. [#10402](https://github.com/microsoft/vscode-cpptools/issues/10402)
* Fix code analysis when `--use-color=true` is used. [#10407](https://github.com/microsoft/vscode-cpptools/issues/10407)
* Fix IntelliSense errors with CUDA. [#10455](https://github.com/microsoft/vscode-cpptools/issues/10455)
* Fix random save failures while code analysis is running on the saved file. [#10482](https://github.com/microsoft/vscode-cpptools/issues/10482)
* Fix the compile commands prompt setting `compileCommands` to a `compile_commands.json` in a different workspace folder. [#10588](https://github.com/microsoft/vscode-cpptools/issues/10588)
* Fix code analysis with `_Float16`. [#10610](https://github.com/microsoft/vscode-cpptools/issues/10610)
* Fix code analysis with c23/gnu23. [#10615](https://github.com/microsoft/vscode-cpptools/issues/10615)
* Fix 'Reset IntelliSense Database' being delayed until parsing is finished. [#10616](https://github.com/microsoft/vscode-cpptools/issues/10616)
* Fix uncaught exception with some configuration providers. [#10634](https://github.com/microsoft/vscode-cpptools/issues/10634)
* Fix crashes with a multi-root workspace. [#10636](https://github.com/microsoft/vscode-cpptools/issues/10636)
* Fix bugs with the "You do not have IntelliSense configured" prompt. [#10658](https://github.com/microsoft/vscode-cpptools/issues/10658), [#10659](https://github.com/microsoft/vscode-cpptools/issues/10659)
* Fix random failures when adding or removing workspace folders. [PR #10665](https://github.com/microsoft/vscode-cpptools/pull/10665)
* Fix missing clang-tidy checks setting values. [#10667](https://github.com/microsoft/vscode-cpptools/issues/10667)
* Fix 'Select IntelliSense configuration' so that it works if it's already set in the workspace or workspace folder settings. [#10674](https://github.com/microsoft/vscode-cpptools/issues/10674)
* Fix clang-tidy 'clang-analyzer-' documentation links not working. [#10678](https://github.com/microsoft/vscode-cpptools/issues/10678)
* Fix the browse configuration provider cache not getting cleared. [#10692](https://github.com/microsoft/vscode-cpptools/issues/10692), [#10877](https://github.com/microsoft/vscode-cpptools/issues/10877)
* Fix a crash with recursive environment variables on Windows. [#10704](https://github.com/microsoft/vscode-cpptools/issues/10704)
* Fix `#import` of `.tlb` files failing due to `/Fo` arguments to `cl.exe` not being processed. [#10710](https://github.com/microsoft/vscode-cpptools/issues/10710)
* Fix `cppbuild` tasks not using the workspace folder as the `cwd` by default. [#10742](https://github.com/microsoft/vscode-cpptools/issues/10742)
* Fix lots of IntelliSense processes getting launched after a Find/Replace operation (potentially freezing the OS). [#10743](https://github.com/microsoft/vscode-cpptools/issues/10743)
* Fix workspace folder variable resolution with `clang_format_style`. [#10752](https://github.com/microsoft/vscode-cpptools/issues/10752)
* For remote attach, use an absolute `/bin/sh` path on Linux. [PR #10765](https://github.com/microsoft/vscode-cpptools/pull/10765)
* Fix the first registered configuration provider still being automatically used after a second registers. [PR #10772](https://github.com/microsoft/vscode-cpptools/pull/10772)
* Fix `C_Cpp.default.compilerPath` in the settings UI showing a string editor when it shouldn't. [#10795](https://github.com/microsoft/vscode-cpptools/issues/10795)
* Fix some issues due to usage of the spread operator not doing a deep copy. [PR #10803](https://github.com/microsoft/vscode-cpptools/pull/10803)
* Fix a deadlock with Find All References. [#10855](https://github.com/microsoft/vscode-cpptools/issues/10855)
* Fix the Code Analysis Options dropdown showing 'Resume' instead of 'Pause' after a cancel is done in a paused state. [#10879](https://github.com/microsoft/vscode-cpptools/issues/10879)
* Fix "Code Analysis Mode" not being localized when initially shown. [#10881](https://github.com/microsoft/vscode-cpptools/issues/10881)
* Fix the C/C++-related status bar items flickering off/on when switching documents. [PR #10888](https://github.com/microsoft/vscode-cpptools/pull/10888)
* Fix `__GXX_RTTI` incorrectly being defined by IntelliSense with clang and `-fms-compatibility`.
* Reduce the likelihood of an `onWillSaveWaitUntil` timeout.
* Fix an IntelliSense crash with C++20 concepts.
* Stop querying clang-cl.exe as C.

## Version 1.14.5: March 22, 2023
### Bug Fix
* Fix a deadlock with a multi-root workspace. [#10719](https://github.com/microsoft/vscode-cpptools/issues/10719)

## Version 1.14.4: February 28, 2023
### Enhancements
* Add `c23` and `c2x` support for clang and gcc modes. [#7471](https://github.com/microsoft/vscode-cpptools/issues/7471)
* Filter out clang-tidy `#pragma once in main file` warnings. [#10539](https://github.com/microsoft/vscode-cpptools/issues/10539)
* Auto-configure `configurationProvider` even if `default.compilerPath` is set. [PR #10607](https://github.com/microsoft/vscode-cpptools/pull/10607)

### Bug Fixes
* Fix `--` in args making compiler querying fail. [#10529](https://github.com/microsoft/vscode-cpptools/issues/10529)
* Fix every .C file being opened in a compile_commands.json if it's build for C++. [#10540](https://github.com/microsoft/vscode-cpptools/issues/10540)
* Fix `-std=c++` not being used in compile_commands.json for .C files. [#10541](https://github.com/microsoft/vscode-cpptools/issues/10541)
* Fix a crash when an error occurs in a forced include. [#10598](https://github.com/microsoft/vscode-cpptools/issues/10598)
* Fix the configuration provider browse cache not getting cleared. [PR #10608](https://github.com/microsoft/vscode-cpptools/pull/10608)
* Fix a bug that could cause IntelliSense to randomly stop updating.
* Fix some random failures that could happen during database deletion.
* Fix some random crashes on shutdown.

## Version 1.14.3: February 14, 2023
### New Features
* Add recursive macro expansion on hover. [#3579](https://github.com/microsoft/vscode-cpptools/issues/3579)
* Move status bar items to the language status UI. [#8405](https://github.com/microsoft/vscode-cpptools/issues/8405)
  * This may not be enabled for all users unless `C_Cpp.experimentalFeatures` is `enabled`.
* Add the 'Select Default Compiler' command that lets you choose a default compiler to configure IntelliSense. [#10027](https://github.com/microsoft/vscode-cpptools/issues/10027)

### Enhancements
* Exclude rename results external to the workspace. [#9235](https://github.com/microsoft/vscode-cpptools/issues/9235)
* Add error messages for Create Declaration / Definition. [#10163](https://github.com/microsoft/vscode-cpptools/issues/10163)
* Add support for LLVM-based Intel C/C++ compilers. [#10218](https://github.com/microsoft/vscode-cpptools/issues/10218)
* SSH output improvements. [PR #10292](https://github.com/microsoft/vscode-cpptools/pull/10292)
* Reorder commands in the code action context menu. [#10400](https://github.com/microsoft/vscode-cpptools/issues/10400)
* Add Ada to supported languages for debugging. [#10475](https://github.com/microsoft/vscode-cpptools/issues/10475)
  * Anthony Leonardo Gracio (@AnthonyLeonardoGracio) [PR #10476](https://github.com/microsoft/vscode-cpptools/pull/10476)

### Bug Fixes
* Fix usage of relative paths in IntelliSense configuration settings with multi-root workspaces. [#4983](https://github.com/microsoft/vscode-cpptools/issues/4983)
* Fix infinite recursion in scout_parser. [#8898](https://github.com/microsoft/vscode-cpptools/issues/8898)
* Fix an IntelliSense crash with the seqan3 library. [#8956](https://github.com/microsoft/vscode-cpptools/issues/8956)
* Fix looping between C and C++. [#9689](https://github.com/microsoft/vscode-cpptools/issues/9689)
* Fix Doxygen comments for the function signature being autogenerated when typing inside a function. [#9742](https://github.com/microsoft/vscode-cpptools/issues/9742)
* Show a reload prompt after `C_Cpp.hover` is changed. [#10076](https://github.com/microsoft/vscode-cpptools/issues/10076)
* Fix function inlay hints not working with `std::string_literal` arguments. [#10078](https://github.com/microsoft/vscode-cpptools/issues/10078)
* Fix IntelliSense completion for `std::string` with `?:` and `string()`. [#10103](https://github.com/microsoft/vscode-cpptools/issues/10103)
* Fix semantic colorization not working in a certain case. [#10105](https://github.com/microsoft/vscode-cpptools/issues/10105)
* Fix IntelliSense completion not working inside constructor calls that are incomplete. [#10111](https://github.com/microsoft/vscode-cpptools/issues/10111)
* Fix changes to the enclosing type not being taken into account after "Create Declaration / Definition" is used once. [#10162](https://github.com/microsoft/vscode-cpptools/issues/10162)
* Fix "False positive expression must have a constant value with __builtin_choose_expr in _Static_assert". [#10168](https://github.com/microsoft/vscode-cpptools/issues/10168)
* Fix Create Declaration / Definition with an anonymous namespace. [#10189](https://github.com/microsoft/vscode-cpptools/issues/10189)
* Fix file exclusions not being applied to the first directory found for each browse.path entry. [#10205](https://github.com/microsoft/vscode-cpptools/issues/10205)
* Fix IntelliSense mode auto-detection for VS 2015 compiler paths. [#10207](https://github.com/microsoft/vscode-cpptools/issues/10207)
* Fix clang-cl 15 querying with /WX. [#10221](https://github.com/microsoft/vscode-cpptools/issues/10221)
* Fix an incorrect IntelliSense error with `std::bind`, c++17, and windows-msvc-arm64 mode. [#10304](https://github.com/microsoft/vscode-cpptools/issues/10304)
* Fix vcFormat when using lambda functions. [#10326](https://github.com/microsoft/vscode-cpptools/issues/10326)
* Fix IntelliSense crash in field_for_lambda_capture. [#10359](https://github.com/microsoft/vscode-cpptools/issues/10359)
* Fix for cpptools getting shutdown after waking up from sleep. [#10362](https://github.com/microsoft/vscode-cpptools/issues/10362)
* Fix an IntelliSense crash when using the French language pack. [#10374](https://github.com/microsoft/vscode-cpptools/issues/10374)
* Fix the process id picker only showing part of the process on a remote machine. [#10379](https://github.com/microsoft/vscode-cpptools/issues/10379)
* Fix temp files generating at the incorrect path. [#10386](https://github.com/microsoft/vscode-cpptools/issues/10386)
* Fix a crash in extractArgs. [PR #10394](https://github.com/microsoft/vscode-cpptools/pull/10394)
* Fix a bug with settings changes not being handled correctly for multi-root. [PR #10458](https://github.com/microsoft/vscode-cpptools/pull/10458)

## Version 1.13.9: January 4, 2023
### Bug Fix
* Fix clang-format and clang-tidy not working for macOS 11 arm64. [#10282](https://github.com/microsoft/vscode-cpptools/issues/10282)

## Version 1.13.8: December 15, 2022
### Bug Fixes
* Fix tag parser failure on machines with multiple extension users. [#10224](https://github.com/microsoft/vscode-cpptools/issues/10224)
* Fix a `--using_directory` IntelliSense error if LIBPATH is defined with non-msvc IntelliSense modes. [#10249](https://github.com/microsoft/vscode-cpptools/issues/10249)
* Fix a crash when the configuration name is missing. [#10251](https://github.com/microsoft/vscode-cpptools/issues/10251)

## Version 1.13.7: December 8, 2022
### Bug Fix
* Fix `files.associations` not working. [#10244](https://github.com/microsoft/vscode-cpptools/issues/10244)

## Version 1.13.6: December 6, 2022
### New Features
* Add the ability to generate definitions from declarations and vice versa. [#664](https://github.com/microsoft/vscode-cpptools/issues/664)
* Add SSH Target Selector. [PR #9760](https://github.com/microsoft/vscode-cpptools/pull/9760)
* Add rsync support in deploySteps. [PR #9808](https://github.com/microsoft/vscode-cpptools/pull/9808)

### Enhancements
* Add `C_Cpp.caseSensitiveFileSupport` for enabling case sensitive file handling on Windows. [#1994](https://github.com/microsoft/vscode-cpptools/issues/1994)
* Add sections to settings. [#8237](https://github.com/microsoft/vscode-cpptools/issues/8237)
* Make Doxygen hover comments customizable with `C_Cpp.doxygen.sectionTags`. [#8525](https://github.com/microsoft/vscode-cpptools/issues/8525)
* Add better build and debug task handling for when a compiler or debugger doesn't exist. [#8836](https://github.com/microsoft/vscode-cpptools/issues/8836)
* Delay applying `c_cpp_properties.json` changes until after a save. [#9185](https://github.com/microsoft/vscode-cpptools/issues/9185)
* Create directories on Linux/Mac with 755 instead of 777 permissions. [#9670](https://github.com/microsoft/vscode-cpptools/issues/9670)
* Check for MSVC environment variables for configuring IntelliSense. [#9745](https://github.com/microsoft/vscode-cpptools/issues/9745)
* Enable the inlay hint settings to be set per-workspace folder. [#9782](https://github.com/microsoft/vscode-cpptools/issues/9782)
* Add a `C_Cpp.hover` setting to enable disabling hover results. [#9793](https://github.com/microsoft/vscode-cpptools/issues/9793)
* Update to clang-format and clang-tidy 15.0.3. [#9816](https://github.com/microsoft/vscode-cpptools/issues/9816)
* Enable hiding the SSH Targets view with the `C_Cpp.sshTargetsView` setting. [#9836](https://github.com/microsoft/vscode-cpptools/issues/9836)
* Change "Enabled", "Disabled", "Default" settings to camelCase. [PR #9862](https://github.com/microsoft/vscode-cpptools/pull/9862)
* Add support for C++ modules IFC version 0.42. [#9884](https://github.com/microsoft/vscode-cpptools/issues/9884)
* Add SSH terminal for targets. [PR #9895](https://github.com/microsoft/vscode-cpptools/pull/9895)
* Make array settings give a warning for duplicates. [PR #9959](https://github.com/microsoft/vscode-cpptools/pull/9959)
* Add "iar" and "armcc5" problem matchers. [#10054](https://github.com/microsoft/vscode-cpptools/issues/10054)
  * Michael (@morsisko) [PR #10085](https://github.com/microsoft/vscode-cpptools/pull/10085), [PR #10101](https://github.com/microsoft/vscode-cpptools/pull/10101)
* Pass `--Wno-error=unknown` to clang-format (12 or newer) to avoid failing on unsupported settings. [#10072](https://github.com/microsoft/vscode-cpptools/issues/10072)
* Add support for `/cygdrive` paths returned by some versions of Cygwin. [#10112](https://github.com/microsoft/vscode-cpptools/issues/10112)
* Switch from RapidJSON to VS's internal JSON parser.

### Bug Fixes
* Fix "final" breaking formatting. [#6638](https://github.com/microsoft/vscode-cpptools/issues/6638)
* Fix incorrect "expected concept name" IntelliSense error. [#6876](https://github.com/microsoft/vscode-cpptools/issues/6876)
* Fix incorrect Outline view with C++20 namespace ::inline syntax. [#7216](https://github.com/microsoft/vscode-cpptools/issues/7216)
* Fix updates to compile_commands.json not being handled if specified using a relative path. [#7610](https://github.com/microsoft/vscode-cpptools/issues/7610)
* Fix variadic macros not expanding correctly. [#8178](https://github.com/microsoft/vscode-cpptools/issues/8178)
* Fix the `editor.parameterHints.enabled` setting not being used when `C_Cpp.autocompleteAddParentheses` is `true`. [#9314](https://github.com/microsoft/vscode-cpptools/issues/9314)
* Fix IntelliSense bug "A result type of `__builtin_choose_expr` that returns a pointer to a function is not correctly inferred in clang mode". [#9368](https://github.com/microsoft/vscode-cpptools/issues/9368)
* Fix some invalid macro redefinition errors. [#9435](https://github.com/microsoft/vscode-cpptools/issues/9435)
* Fix wordexp sometimes getting stuck on Mac (and Linux). [#9688](https://github.com/microsoft/vscode-cpptools/issues/9688)
* Fix ctrl+space completion for Doxygen tags. [#9732](https://github.com/microsoft/vscode-cpptools/issues/9732)
* Fix the position of inlay parameter hints when using at or operator[]. [#9741](https://github.com/microsoft/vscode-cpptools/issues/9741)
* Fix `-std=` being passed to clang-tidy in certain cases . [#9776](https://github.com/microsoft/vscode-cpptools/issues/9776)
* Fix `${workspaceFolder}` not being resolved in `C_Cpp.clang_format_style`. [#9786](https://github.com/microsoft/vscode-cpptools/issues/9786)
* Fix debugger visualization for ArrayItem elements more than 1000. [#9801](https://github.com/microsoft/vscode-cpptools/issues/9801)
* Fix extra comma in the generated the `(gdb) attach` configuration in `launch.json`. [#9818](https://github.com/microsoft/vscode-cpptools/issues/9818)
* Fix IntelliSense crash with range-v3 `ranges::views::addressof`. [#9870](https://github.com/microsoft/vscode-cpptools/issues/9870)
* Fix slow compiler querying. [#9882](https://github.com/microsoft/vscode-cpptools/issues/9882)
* Handle `-fexperimental-library` clang argument. [#9888](https://github.com/microsoft/vscode-cpptools/issues/9888)
* Fix compiler querying with multiple -arch. [#9894](https://github.com/microsoft/vscode-cpptools/issues/9894)
* Fix code analysis errors related to SSE being enabled when gcc is used. [#9898](https://github.com/microsoft/vscode-cpptools/issues/9898)
* Fix issue with parsing SSH configurations that could cause the extension to fail to activate. [#9933](https://github.com/microsoft/vscode-cpptools/pull/9933)
* Fix inlay hints showing "type" for lambdas in certain cases. [#9971](https://github.com/microsoft/vscode-cpptools/issues/9971)
* Resolve variables for `C_Cpp.codeAnalysis.clangTidy.args` and `headerFilter`. [#9981](https://github.com/microsoft/vscode-cpptools/issues/9981), [#9996](https://github.com/microsoft/vscode-cpptools/issues/9996)
* Fix some translations. [#9986](https://github.com/microsoft/vscode-cpptools/issues/9986), [#10011](https://github.com/microsoft/vscode-cpptools/issues/10011), [#10012](https://github.com/microsoft/vscode-cpptools/issues/10012), [#10013](https://github.com/microsoft/vscode-cpptools/issues/10013)
* Fix "Step Over past a logpoint stops at the wrong place". [#9995](https://github.com/microsoft/vscode-cpptools/issues/9995)
* Disable the "Generate Doxygen Comment" context menu when IntelliSense is disabled. [PR #10007](https://github.com/microsoft/vscode-cpptools/pull/10007)
* Fix Doxygen code action from appearing on a function that already has a `*/` comment. [#10009](https://github.com/microsoft/vscode-cpptools/issues/10009)
* Fix clang-tidy and clang-format not working on CentOS7 and other Linux OS's without glibc 2.27 or greater. [#10019](https://github.com/microsoft/vscode-cpptools/issues/10019)
* Fix various bugs with the `C_Cpp.codeAnalysis.clangTidy.headerFilter` setting. [#10023](https://github.com/microsoft/vscode-cpptools/issues/10023)
* Fix Doxygen comment generation when there's a selection. [#10028](https://github.com/microsoft/vscode-cpptools/issues/10028)
* Fix issue that could cause document corruption. [#10035](https://github.com/microsoft/vscode-cpptools/issues/10035)
* Fixed crash on Linux/Mac when a full command line is specified in `compilerPath` containing invalid arguments. [PR #10070](https://github.com/microsoft/vscode-cpptools/pull/10070)
* Fix random "Failed to spawn IntelliSense process: 65520" on Mac. [#10091](https://github.com/microsoft/vscode-cpptools/issues/10091)
* Fix debugger throwing error "stdout maxBuffer exceeded". [10107](https://github.com/microsoft/vscode-cpptools/issues/10107)
* Fix "Can't attach to process on Windows: Unexpected token \ in JSON". [#10108](https://github.com/microsoft/vscode-cpptools/issues/10108)
* Fix "Don't hardcode path to kill in UnixUtilities". [#10124](https://github.com/microsoft/vscode-cpptools/issues/10124)
  * Ellie Hermaszewska (@expipiplus1) [PR #1373](https://github.com/microsoft/MIEngine/pull/1373)
* Fix formatting when clang-format 11 or earlier is used (and another issue for version 8 or earlier). [#10178](https://github.com/microsoft/vscode-cpptools/issues/10178)
* Fix "Natvis: are multi-dimensional arrays supported in gdb natvis?". [MIEngine#980](https://github.com/microsoft/MIEngine/issues/980)
* Fix include completion sorting extensionless headers (e.g. string) after headers with an extension (e.g. string.h).
* Fix extensionHost logging an error related to onWillSaveTextDocument whenever a save is done.
* Fix random "Failed to spawn IntelliSense process" on Mac.
* Fix a deadlock when IntelliSense errors are updating.
* Fix redundant rescan when adding a workspace folder.

### Removed Feature
* Removed explicit WSL support in favor of using the WSL extension. [PR #10066](https://github.com/microsoft/vscode-cpptools/pull/10066)

## Version 1.12.4: August 31, 2022
### Other
* Revert changes to telemetry key format. [PR #9822](https://github.com/microsoft/vscode-cpptools/pull/9822)

## Version 1.12.3: August 30, 2022
### New Features
* Add Doxygen comment generation via command, context menu, code action, or typing. [#5683](https://github.com/microsoft/vscode-cpptools/issues/5683)
* Add auto-complete of Doxygen keywords in comments.

### Enhancements
* Add auto-formatting of lines that are changed by code analysis fixes. [#9322](https://github.com/microsoft/vscode-cpptools/issues/9322)
* Add compile arguments to enable colorized output in cppBuild tasks for clang. [#9643](https://github.com/microsoft/vscode-cpptools/issues/9643)
* Cache and reuse SSH passwords in the current remote debugging session. [PR #9654](https://github.com/microsoft/vscode-cpptools/pull/9654)
* Fix "natvis collections only show the first 50 elements". [MIEngine#821](https://github.com/microsoft/MIEngine/issues/821)
  * Related [#9377](https://github.com/microsoft/vscode-cpptools/issues/9377)
* Fix "cppdbg doesn't support array view of char* buf". [MIEngine#1258](https://github.com/microsoft/MIEngine/issues/1258)
* Support explicit `this` references in natvis files.
  * @Trass3r [PR MIEngine#1163](https://github.com/microsoft/MIEngine/pull/1163)
* Do std fallback when compiler querying, even when explicitly specified via a compiler arg.

### Bug Fixes
* Fix several IntelliSense parsing bugs. [#3683](https://github.com/microsoft/vscode-cpptools/issues/3683), [#6659](https://github.com/microsoft/vscode-cpptools/issues/6659), [#7446](https://github.com/microsoft/vscode-cpptools/issues/7446), [#9215](https://github.com/microsoft/vscode-cpptools/issues/9215)
* Fix crash when tag parsing files containing certain string literals. [#9538](https://github.com/microsoft/vscode-cpptools/issues/9538)
* Fix incorrect semantic tokens with templated operator overloads. [#9556](https://github.com/microsoft/vscode-cpptools/issues/9556)
* Fix `.` to `->` completion in functions defined in the class/struct definition. [#9599](https://github.com/microsoft/vscode-cpptools/issues/9599)
* Fix inlay hint filtering not working with some cases of whitespace. [#9606](https://github.com/microsoft/vscode-cpptools/issues/9606)
* Fix Chinese translation mistakes.
  * kouhe3 (@kouhe3) [PR #9624](https://github.com/microsoft/vscode-cpptools/pull/9624)
* Fix IntelliSense error with ARM register declarations. [#9627](https://github.com/microsoft/vscode-cpptools/issues/9627)
* Fix files with a `.c` extension not using a C++ `std` version passed in the `compilerArgs` or `compilerFragments`. [#9628](https://github.com/microsoft/vscode-cpptools/issues/9628)
* Fix unnecessary IntelliSense process restarting on file creation handling. [#9630](https://github.com/microsoft/vscode-cpptools/issues/9630)
* Fix tag parsing of classes and enums with attributes. [#9672](https://github.com/microsoft/vscode-cpptools/issues/9672)
* Add PID to the extended remote process picker. [PR #9673](https://github.com/microsoft/vscode-cpptools/pull/9673)
* Fix tag parser crash. [#9679](https://github.com/microsoft/vscode-cpptools/issues/9679), [#9695](https://github.com/microsoft/vscode-cpptools/issues/9695)
* Fix code analysis fixes generating invalid code when the fix has escaped characters. [#9683](https://github.com/microsoft/vscode-cpptools/issues/9683)
* Fix unintended generation of `nul.d` file when querying clang or gcc, when compiler arguments include dependency generation arguments. [#9707](https://github.com/microsoft/vscode-cpptools/issues/9707)
* Fix code analysis fixes not being available when more than one check is associated with a fix. [#9755](https://github.com/microsoft/vscode-cpptools/issues/9755)
* Fix error when debugging is started without a launch.json and IntelliSense is disabled. [#9762](https://github.com/microsoft/vscode-cpptools/issues/9762)
* Fix "The result of GDB -exec evaluate request in all contexts is printed in debug console." [MIEngine #1236](https://github.com/microsoft/MIEngine/issues/1236)
* Fix "Evaluating a variable after a failed Step Out causes a fatal error, leaving debug session unusable". [MIEngine#1336](https://github.com/microsoft/MIEngine/issues/1336)
  * Gareth Rees (@gareth-rees) [PR MIEngine#1337](https://github.com/microsoft/MIEngine/pull/1337)
* Fix deadlock in HandleStackTraceRequestAsync where lock was hold too long.
  * GeorgeMay (@JoergMeier106) [PR MIEngine#1309](https://github.com/microsoft/MIEngine/pull/1309)
* Fix potential crashes on shutdown.

## Version 1.11.5: August 9, 2022
### Bug Fixes
* Fix crash when tag parsing files containing certain string literals. [#9538](https://github.com/microsoft/vscode-cpptools/issues/9538)
* Fix `llvm-project` parser crash on file: `clang/test/parser/parser_overflow.c`. [#9653](https://github.com/microsoft/vscode-cpptools/issues/9653)
* Fix `llvm-project` parser crash on file: `libcxx/test/support/test.support/make_string_header.pass.cpp`. [#9679](https://github.com/microsoft/vscode-cpptools/issues/9679)

## Version 1.11.4: July 21, 2022
### New Features
* Add inlay hints for parameters and auto types. [#5845](https://github.com/microsoft/vscode-cpptools/issues/5845)
* Add extended remote support for debugging. [#8497](https://github.com/microsoft/vscode-cpptools/issues/8497), [#9195](https://github.com/microsoft/vscode-cpptools/issues/9195), [#9491](https://github.com/microsoft/vscode-cpptools/discussions/9491), [#9505](https://github.com/microsoft/vscode-cpptools/issues/9505)

### Enhancements
* Add deploySteps and variables to cppdbg. [PR #9418](https://github.com/microsoft/vscode-cpptools/pull/9418)

### Bug Fixes
* Fix "unknown register name" IntelliSense error. [#4382](https://github.com/microsoft/vscode-cpptools/issues/4382)
* Fix performance issue with tag parsing a file with a lot of defines. [#6454](https://github.com/microsoft/vscode-cpptools/issues/6454)
* Fix IntelliSense with gcc vector extension types. [#6890](https://github.com/microsoft/vscode-cpptools/issues/6890)
* Fix doc comments for macros and typedefs. [#8320](https://github.com/microsoft/vscode-cpptools/issues/8320)
* Fix issue with CUDA configuration when using a custom config provider and no config is available for the file. [#8483](https://github.com/microsoft/vscode-cpptools/issues/8483)
* Fix missing logging when `C_Cpp.intelliSenseEngine` is set to `Disabled`. [#9277](https://github.com/microsoft/vscode-cpptools/issues/9277)
* Fix doxygen comments not being displayed for multiple adjacent `@brief` or `@return` tags. [#9316](https://github.com/microsoft/vscode-cpptools/issues/9316)
* Fix the code analysis "disable" option not automatically clearing the disabled diagnostics. [#9364](https://github.com/microsoft/vscode-cpptools/issues/9364)
* Fix `-isystem` not being used for system headers with code analysis. [#9366](https://github.com/microsoft/vscode-cpptools/issues/9366)
* Fix compiler querying for EDG-based compilers. [#9410](https://github.com/microsoft/vscode-cpptools/issues/9410)
* Fix hiding IntelliSense dependent commands when `C_Cpp.intelliSenseEngine` is `Disabled`. [#9451](https://github.com/microsoft/vscode-cpptools/issues/9451)
* Fix cl.exe build tasks not showing for .c files and .c build tasks being cached for .cpp files (and vice versa). [PR #9544](https://github.com/microsoft/vscode-cpptools/pull/9544)
* Fix code analysis not detecting warnings with relative paths. [#9555](https://github.com/microsoft/vscode-cpptools/issues/9555)
* Fix `--header-filter` being used with clang-tidy when it shouldn't when a .clang-tidy file exists. [#9566](https://github.com/microsoft/vscode-cpptools/issues/9566)
* Fix code analysis giving an error with `__has_include` with gcc 9. [#9575](https://github.com/microsoft/vscode-cpptools/issues/9575)
* Fix `-target` not being processed in `compilerArgs`. [#9586](https://github.com/microsoft/vscode-cpptools/issues/9586)

## Version 1.10.8: July 7, 2022
### Enhancements
* Allow breakpoints for Rust debugging. [PR #9484](https://github.com/microsoft/vscode-cpptools/pull/9484)
* Make `C_Cpp.debugShortcut` settable per-workspace folder. [PR #9514](https://github.com/microsoft/vscode-cpptools/pull/9514)

### Bug Fixes
* Fix crash if clang-tidy returns a replacement with an empty FilePath. [#9437](https://github.com/microsoft/vscode-cpptools/issues/9437)
* Fix skipping the compiler argument after `-c`. [#9453](https://github.com/microsoft/vscode-cpptools/issues/9453)
* Fix `-std:c++20` not being handled with cl.exe. [#9458](https://github.com/microsoft/vscode-cpptools/issues/9458)
* Fix bug with the environment being incorrect when compiler querying. [#9472](https://github.com/microsoft/vscode-cpptools/issues/9472)
* Fix duplicate compiler args in compiler query with custom configuration providers using cpptools-api prior to v6. [#9531](https://github.com/microsoft/vscode-cpptools/issues/9531)
* Fix process launching concurrency issues on Windows.

## Version 1.10.7: June 15, 2022
### Bug Fixes
* Fix bugs with process creation on Windows (which caused IntelliSense to fail). [#9431](https://github.com/microsoft/vscode-cpptools/issues/9431)

## Version 1.10.6: June 14, 2022
### Bug Fixes
* Fix `@responseFile` in `compilerArgs` not being handled on Linux/Mac. [#9434](https://github.com/microsoft/vscode-cpptools/issues/9434)
* Fix debug preLaunchTask not working when `C_Cpp.intelliSenseEngine` is `Disabled`. [#9446](https://github.com/microsoft/vscode-cpptools/issues/9446)
* Make the `C_Cpp.legacyCompilerArgsBehavior` setting non-deprecated.

## Version 1.10.5: June 8, 2022
### New Features
* Add code actions to apply clang-tidy fixes (and other actions). [#8476](https://github.com/microsoft/vscode-cpptools/issues/8476)
* Added support for setting values on top level watch window expressions. [#9019](https://github.com/microsoft/vscode-cpptools/issues/9019)
* Make the "Run and Debug" button feature available to all users. [#9306](https://github.com/microsoft/vscode-cpptools/issues/9306)

### Enhancements
* Add `C_Cpp.clangTidy.useBuildPath` setting to enable using `-p` with clang-tidy. [#8740](https://github.com/microsoft/vscode-cpptools/issues/8740), [#8952](https://github.com/microsoft/vscode-cpptools/issues/8952)
* Generate launch.json when adding a new debug configuration. [#9100](https://github.com/microsoft/vscode-cpptools/issues/9100)
* Prioritize the "folder" option when doing a `#include` completion. [#9222](https://github.com/microsoft/vscode-cpptools/issues/9222)
* Add compiler path to debug configuration details. [PR #9264](https://github.com/microsoft/vscode-cpptools/pull/9264)
* Update the bundled clang-format and clang-tidy to version 14.0.0.

### Bug Fixes
* Fix 'System.NullReferenceException when continuing after adding breakpoint.' [#1297](https://github.com/microsoft/MIEngine/issues/1297)
* Fix completion not working in `#define` definitions and in definition names when manually invoked. [#4662](https://github.com/microsoft/vscode-cpptools/issues/4662), [#8973](https://github.com/microsoft/vscode-cpptools/issues/8973), [#9078](https://github.com/microsoft/vscode-cpptools/issues/9078)
* Fix several IntelliSense bugs. [#6226](https://github.com/microsoft/vscode-cpptools/issues/6226), [#8294](https://github.com/microsoft/vscode-cpptools/issues/8294), [#8530](https://github.com/microsoft/vscode-cpptools/issues/8530), [#8725](https://github.com/microsoft/vscode-cpptools/issues/8725), [#8751](https://github.com/microsoft/vscode-cpptools/issues/8751), [#9076](https://github.com/microsoft/vscode-cpptools/issues/9076), [#9224](https://github.com/microsoft/vscode-cpptools/issues/9224), [#9336](https://github.com/microsoft/vscode-cpptools/issues/9336).
* Fix issue with shell processing incorrectly occurring for `arguments` fields in `compile_commands.json` files. [#8649](https://github.com/microsoft/vscode-cpptools/issues/8649)
* Fix handling of `@response` files for clang-tidy on Windows. [#8843](https://github.com/microsoft/vscode-cpptools/issues/8843),  [#9032](https://github.com/microsoft/vscode-cpptools/issues/9032), [#9102](https://github.com/microsoft/vscode-cpptools/issues/9102)
* Fix issue with inconsistent handling of shell escaping in compiler arg fields. All compiler arg array fields are now assumed to not include shell quoting, escaping or shell variables. Added a `C_Cpp.legacyCompilerArgsBehavior` to restore the legacy behavior. [#8963](https://github.com/microsoft/vscode-cpptools/issues/8963)
* Add localized strings for build tasks. [#9051](https://github.com/microsoft/vscode-cpptools/issues/9051)
* Fix Go to Definition with C for identifiers that are C++ keywords. [#9081](https://github.com/microsoft/vscode-cpptools/issues/9081)
* Fix the new Run/Debug Code button not working with a modified program location. [#9082](https://github.com/microsoft/vscode-cpptools/issues/9082)
* Fix `__GNUC__` system defines causing clang-tidy to undefine `_Float32`. [#9091](https://github.com/microsoft/vscode-cpptools/issues/9091)
* Fix 'breakpoints set before launch in shared objects cannot be disabled/deleted' [#9095](https://github.com/microsoft/vscode-cpptools/issues/9095)
* Fix compiler querying failing for compilers that don't output system includes. [#9099](https://github.com/microsoft/vscode-cpptools/issues/9099)
* Fix completion occurring (when it shouldn't) after the comma in a definition list. [#9101](https://github.com/microsoft/vscode-cpptools/issues/9101)
* Fix `;` incorrectly matching for `break;` and `continue;` completion. [#9115](https://github.com/microsoft/vscode-cpptools/issues/9115)
* Fix Go to Definition on a `#include` with an absolute path. [#9287](https://github.com/microsoft/vscode-cpptools/issues/9287)
* Fix formatting issue with vcFormat when using multi-byte UTF-8 sequences. [#9297](https://github.com/microsoft/vscode-cpptools/issues/9297)
* Fix language server disabling due to a TypeError when invalid json values are used. [#9302](https://github.com/microsoft/vscode-cpptools/issues/9302)
* Add support for "user" level and "workspace" level debug configurations. [#9319](https://github.com/microsoft/vscode-cpptools/issues/9319)
* Prevent language service activation for macOS older than 10.12. [PR #9328](https://github.com/microsoft/vscode-cpptools/pull/9328)
* Fix code analysis with g++ 12 system headers. [#9347](https://github.com/microsoft/vscode-cpptools/issues/9347)
* Enable correct symbol parsing for methods that call loop-like macros without requiring the macro be added to cpp.hint. [#9378](https://github.com/microsoft/vscode-cpptools/issues/9378)
* Fix a code analysis error when C++23 is used. [#9404](https://github.com/microsoft/vscode-cpptools/issues/9404)
* Fix a potential crash in cpptools (in `get_identifier_at_offset`).
* Other Run and Debug button updates/fixes.

## Version 1.9.8: April 20, 2022
### Bug Fixes
* Fix an issue with extension activation failing if `C_Cpp.intelliSenseEngine` was set to `Disabled`. [#9083](https://github.com/microsoft/vscode-cpptools/issues/9083)

## Version 1.9.7: March 23, 2022
### New Features
* Add debugger support for Apple M1 (osx-arm64). [#7035](https://github.com/microsoft/vscode-cpptools/issues/7035)
  * Resolves issue "[Big Sur M1] ERROR: Unable to start debugging. Unexpected LLDB output from command "-exec-run". process exited with status -1 (attach failed ((os/kern) invalid argument))". [#6779](https://github.com/microsoft/vscode-cpptools/issues/6779)
* Add a build and debug button when `C_Cpp.debugShortcut` is `true`. [#7497](https://github.com/microsoft/vscode-cpptools/issues/7497)
  * The "Build and Debug Active File" command has been split into "Debug C++ File" and "Run C++ File", and it has been removed from the context menu.
* Add Alpine Linux arm64 support (VSIX).
* Add x64 debugger for CppVsdbg on Windows x64.

### Enhancements
* Reserved identifiers with characters that match typed characters in the correct order but not contiguously are initially filtered in the auto-completion list. Doing a `ctrl` + `space` in the same location will show all auto-complete suggestions. [#4939](https://github.com/microsoft/vscode-cpptools/issues/4939)
* Add `dotConfig` property to IntelliSense Configuration (c_cpp_properties.json) to use .config file created by Kconfig system.
  * Matheus Castello (@microhobby) [PR #7845](https://github.com/microsoft/vscode-cpptools/pull/7845)
* Rework how cancelation is processed for semantic tokens and folding operations. [PR #8739](https://github.com/microsoft/vscode-cpptools/pull/8739)
* Make SwitchHeaderSource use the `workbench.editor.revealIfOpen` setting.
  * Joel Smith (@joelmsmith) [PR #8857](https://github.com/microsoft/vscode-cpptools/pull/8857)
* Add tag parser error logging. [#8907](https://github.com/microsoft/vscode-cpptools/issues/8907)
* Add error and warning messages if the VSIX for an incompatible or mismatching platform or architecture is installed. [#8908](https://github.com/microsoft/vscode-cpptools/issues/8908)
* Add a "More Info" option when an incompatible VSIX is encountered. [PR #8920](https://github.com/microsoft/vscode-cpptools/pull/8920)
* Add `;` to `break` and `continue` completion keywords. [#8932](https://github.com/microsoft/vscode-cpptools/issues/8932)
* Prevent stripping of format specifiers from -exec commands.
  * Gareth Rees (@gareth-rees) [PR MIEngine#1277](https://github.com/microsoft/MIEngine/pull/1278)
* Improve messages for unknown breakpoints and watchpoints.
  * Gareth Rees (@gareth-rees) [PR MIEngine#1282](https://github.com/microsoft/MIEngine/pull/1283)

### Bug Fixes
* Fix some IntelliSense parsing bugs. [#5117](https://github.com/microsoft/vscode-cpptools/issues/5117)
* Fix IntelliSense process crashes caused by a stack overflow on Mac. [#7215](https://github.com/microsoft/vscode-cpptools/issues/7215), [#8653](https://github.com/microsoft/vscode-cpptools/issues/8653)
* Fix exclusions not applying during tag parsing of non-recursive dependent includes. [#8702](https://github.com/microsoft/vscode-cpptools/issues/8702)
* Fix issue that could cause an infinite loop when clicking on a preprocessor conditional directive. [#8717](https://github.com/microsoft/vscode-cpptools/issues/8717)
* Fix excludes applying to cases it should not when running code analysis. [#8724](https://github.com/microsoft/vscode-cpptools/issues/8724)
* Fix a crash when visualizing local variables for Microsoft Edge (msedge.exe) [#8738](https://github.com/microsoft/vscode-cpptools/issues/8738)
* Fix some system defines being incorrectly removed when running code analysis. [#8740](https://github.com/microsoft/vscode-cpptools/issues/8740)
* Prevent an error from being logged due to custom configuration processing prior to the provider being ready. [#8752](https://github.com/microsoft/vscode-cpptools/issues/8752)
* Fix incorrect crash recovery with multi-root. [#8762](https://github.com/microsoft/vscode-cpptools/issues/8762)
* Fix random compiler query, clang-tidy, or clang-format failure on Windows. [#8764](https://github.com/microsoft/vscode-cpptools/issues/8764)
* Fix invoking commands before cpptools is activated. [#8785](https://github.com/microsoft/vscode-cpptools/issues/8785)
* Fix a bug on Windows with semantic tokens updating. [#8799](https://github.com/microsoft/vscode-cpptools/issues/8799)
* Fix tag parser failure due to missing DLL dependencies on Windows. [#8851](https://github.com/microsoft/vscode-cpptools/issues/8851)
* Fix semantic tokens getting cleared for all other files in a TU after editing a file. [#8867](https://github.com/microsoft/vscode-cpptools/issues/8867)
* Fix a bug and typos with cppbuild task providers.
  * InLAnn (@inlann) [PR #8897](https://github.com/microsoft/vscode-cpptools/pull/8897)
* Fix an issue that could cause the extension to fail to start up properly. [PR #8906](https://github.com/microsoft/vscode-cpptools/pull/8906)
* Fix handling of `-B` with compiler querying. [#8962](https://github.com/microsoft/vscode-cpptools/issues/8962)
* Fix incorrect "Running clang-tidy" status indications with multi-root workspaces. [#8964](https://github.com/microsoft/vscode-cpptools/issues/8964)
* Fix a crash during shutdown and potential database resetting due to shutdown being aborted too soon. [PR #8969](https://github.com/microsoft/vscode-cpptools/pull/8969)
* Fix an issue that could cause the active file to not be configured by a configuration provider when custom configurations are reset. [#8974](https://github.com/microsoft/vscode-cpptools/issues/8974)
* Fix detection of Visual Studio 2015. [#8975](https://github.com/microsoft/vscode-cpptools/issues/8975)
* Fix mingw clang being detected as gcc. [#9024](https://github.com/microsoft/vscode-cpptools/issues/9024)
* Fix a random crash on file open.
* Fix some IntelliSense crashes.
* Fix some IntelliSense parsing bugs.
* Fix a bug with IntelliSense updating not working if a file was closed and reopened while its TU was processing an update.
* Fix a potential heap corruption when `files.associations` are changed.
* Update translated text.

### Documentation
* Clarify how to get binaries when debugging the source from GitHub.
  * Hamir Mahal (@hamirmahal) [PR #8788](https://github.com/microsoft/vscode-cpptools/pull/8788)

##  Version 1.8.4: February 7, 2022
### Bug Fixes
* Suppress incorrect warnings on ARM64 macOS. [#8756](https://github.com/microsoft/vscode-cpptools/issues/8756)
* Fix debugger regressions. [#8760](https://github.com/microsoft/vscode-cpptools/issues/8760)
* Remove `Offline Installation` section from README.md. [#8769](https://github.com/microsoft/vscode-cpptools/pull/8769)
* Fix performance issue with loading large PDBs. [#8775](https://github.com/microsoft/vscode-cpptools/issues/8775)

##  Version 1.8.2: January 31, 2022
### New Features
* Add data breakpoints (memory read/write interrupts) with `gdb` debugging. [#1410](https://github.com/microsoft/vscode-cpptools/issues/1410)
* Add "All Exceptions" Breakpoint for cppdbg [#1800](https://github.com/microsoft/vscode-cpptools/issues/1800)
* Add multi-threaded code analysis (using `clang-tidy`) based on the IntelliSense configuration. It defaults to using up to half the cores, but it can be changed via the `C_Cpp.codeAnalysis.maxConcurrentThreads` setting. [#2908](https://github.com/microsoft/vscode-cpptools/issues/2908)
* Add support for Alpine Linux [#4827](https://github.com/microsoft/vscode-cpptools/issues/4827)
* Implement platform-specific VSIX's via the marketplace. [#8152](https://github.com/microsoft/vscode-cpptools/issues/8152)

### Enhancements
* The maximum number of threads to use for Find All References can be configured with the `C_Cpp.references.maxConcurrentThreads` settings. [#4036](https://github.com/microsoft/vscode-cpptools/issues/4036)
* The IntelliSense processes launched to confirm references during Find All References can be cached via the `C_Cpp.references.maxCachedProcesses` setting. [#4038](https://github.com/microsoft/vscode-cpptools/issues/4038)
* The maximum number of IntelliSense processes can be configured with the `C_Cpp.intelliSense.maxCachedProcesses` setting, and the number of processes will automatically decrease when the free memory becomes < 256 MB and it can be configured to use less memory via the `maxMemory` settings (memory usage from code analysis is not handled yet). [#4811](https://github.com/microsoft/vscode-cpptools/issues/4811)
* Switch from 32-bit to 64-bit binaries on 64-bit Windows. [#7230](https://github.com/microsoft/vscode-cpptools/issues/7230)
* Add a compiler arg to the generated gcc build task to display colored text. [PR #8165](https://github.com/microsoft/vscode-cpptools/pull/8165)
* Add `static` and other modifiers to IntelliSense hover results. [#8173](https://github.com/microsoft/vscode-cpptools/issues/8173)
* Add a configuration warning when the default compiler modifies an explicitly set `intelliSenseMode`.

### Bug Fixes
* Fix several IntelliSense bugs. [#5704](https://github.com/microsoft/vscode-cpptools/issues/5704), [#6759](https://github.com/microsoft/vscode-cpptools/issues/6759), [#8412](https://github.com/microsoft/vscode-cpptools/issues/8412), [#8434](https://github.com/microsoft/vscode-cpptools/issues/8434)
* Fix newlines not being handled in comments with a Doxygen tag. [#5741](https://github.com/microsoft/vscode-cpptools/issues/5741)
* Fix Doxygen comments with `\0` being truncated. [#6084](https://github.com/microsoft/vscode-cpptools/issues/6084)
* Fix `files.exclude` not working for directories external to the active workspace folder. [#6877](https://github.com/microsoft/vscode-cpptools/issues/6877)
* Fix [MSYS2 GDB 10.2] gdb: ERROR: Unable to start debugging. Unexpected GDB output from command "-exec-run". Error creating process [#7706](https://github.com/microsoft/vscode-cpptools/issues/7706)
* Fix a bug with vcFormat inserting additional spaces between `}` and `else`. [#7731](https://github.com/microsoft/vscode-cpptools/issues/7731)
* Fix GCC system include processing on Windows. [#8112](https://github.com/microsoft/vscode-cpptools/issues/8112), [#8496](https://github.com/microsoft/vscode-cpptools/issues/8496)
* Remove redundant cl.exe from the build and debug active file configuration list. [#8168](https://github.com/microsoft/vscode-cpptools/issues/8168)
* Fix string elements to render as code in the IntelliSense configuration UI. [PR #8271](https://github.com/microsoft/vscode-cpptools/pull/8271)
* Fix IntelliSense process crash on AMD Ryzen 3000 series processors without updated drivers. [#8312](https://github.com/microsoft/vscode-cpptools/issues/8312)
* Fix bug with `wmic` not being recognized during Windows attach debugging. [#8328](https://github.com/microsoft/vscode-cpptools/issues/8328)
* Fix Go to Type Definition on pointer types. [#8337](https://github.com/microsoft/vscode-cpptools/issues/8337)
* Fix a "Cannot read property" error during deactivation if the language service wasn't fully activated. [#8354](https://github.com/microsoft/vscode-cpptools/issues/8354)
* Fix an issue in which the language id for header files were not updated to match the source file of its TU. [#8381](https://github.com/microsoft/vscode-cpptools/issues/8381)
* Fix parsing of `bit_cast` with gcc mode IntelliSense. [#8434](https://github.com/microsoft/vscode-cpptools/issues/8434)
* Fix the tag parser getting stuck on certain code. [#8459](https://github.com/microsoft/vscode-cpptools/issues/8459)
* Fix an invalid success message when a build task fails. [#8467](https://github.com/microsoft/vscode-cpptools/issues/8467)
* Fix compiler querying with certain Cygwin/MSYS2 compilers on Windows. [#8496](https://github.com/microsoft/vscode-cpptools/issues/8496)
* Fix a bug with conditional breakpoints. [#8515](https://github.com/microsoft/vscode-cpptools/issues/8515)
* Fix non-ASCII output with `cppbuild` tasks. [#8518](https://github.com/microsoft/vscode-cpptools/issues/8518)
* Fix 3 settings not getting environment variables resolved after a settings change. [#8531](https://github.com/microsoft/vscode-cpptools/issues/8531)
* Don't block running a task if it doesn't use the active file. [#8586](https://github.com/microsoft/vscode-cpptools/issues/8586)
* Fix a command not found error message after clicking the database status icon when commands aren't available. [#8599](https://github.com/microsoft/vscode-cpptools/issues/8599)
* Fix /RTC compiler checks failures don't break into debugger [#8646](https://github.com/microsoft/vscode-cpptools/issues/8646)
* Fix workspace rescanning (tag parsing) not automatically happening after c/cpp associations are added to `files.associations`. [#8687](https://github.com/microsoft/vscode-cpptools/issues/8687)
* Fix debugging when Windows binaries are linked with /PDBPageSize > 4k. [#8690](https://github.com/microsoft/vscode-cpptools/issues/8690)
* Switch usage of `-dD` to `-dM` when compiler querying. [#8692](https://github.com/microsoft/vscode-cpptools/issues/8692)
* Fix breakpoints with msys2 gcc. [#8696](https://github.com/microsoft/vscode-cpptools/issues/8696)
* Fix no document symbols appearing in certain cases. [#8726](https://github.com/microsoft/vscode-cpptools/issues/8726)
* Fix an issue in which multiple (potentially different) diagnostics were delivered for headers shared by multiple TUs.
* Fix some translations.

### Other
* Remove trailing whitespaces in source code.
  * Alexander (@Gordon01) [PR #8254](https://github.com/microsoft/vscode-cpptools/pull/8254)

## Version 1.7.1: October 19, 2021
### Bug Fixes
* Fix an extension crash that occurred on activation while a workspace is open with no folders in it. [#8280](https://github.com/microsoft/vscode-cpptools/issues/8280)
* Fix an issue in which configuration defaults were not properly applied. [#8298](https://github.com/microsoft/vscode-cpptools/pull/8298)

## Version 1.7.0: October 13, 2021
### New Features
* Add a command to restart IntelliSense for a specific file. [#3727](https://github.com/microsoft/vscode-cpptools/issues/3727)
* Add support for macOS app bundles [#6726](https://github.com/microsoft/vscode-cpptools/issues/6726)
	* [PR MIEngine#1091](https://github.com/microsoft/MIEngine/pull/1091)
* Add support for Go To / Peek Type Definition. [#7999](https://github.com/microsoft/vscode-cpptools/issues/7999)

### Enhancements
* Detect IntelliSenseMode target architecture for `cl.exe` based on its path. [#8044](https://github.com/microsoft/vscode-cpptools/issues/8044)
* In generated build tasks, add a compiler arg to cause color to be displayed in gcc/clang output in terminal. [PR #8165](https://github.com/microsoft/vscode-cpptools/pull/8165)
* Add new configuration `mergeConfigurations` that enables include paths, defines, and forced includes from c_cpp_properties.json to be merged with those provided by a configuration provider.
  *  Thomas Willson (@willson556) [PR #8174](https://github.com/microsoft/vscode-cpptools/pull/8174)

### Bug Fixes
* Fix an issue with signature help for overloaded constructors. [#1664](https://github.com/microsoft/vscode-cpptools/issues/1664)
* Add markdown to settings descriptions. [#4544](https://github.com/microsoft/vscode-cpptools/issues/4544)
* Fix an IntelliSense process crash. [#5584](https://github.com/microsoft/vscode-cpptools/issues/5548), [#8110](https://github.com/microsoft/vscode-cpptools/issues/8110)
* Fix an issue with incorrect E0513 and E0167 IntelliSense errors. [#6338](https://github.com/microsoft/vscode-cpptools/issues/6338)
* Fix issue with IntelliSense for anonymous members. [#6412](https://github.com/microsoft/vscode-cpptools/issues/6412)
* Fix an issue with incorrect "no suitable user-defined conversion" errors. [#6721](https://github.com/microsoft/vscode-cpptools/issues/6721)
* Fix some issues with punctuation in setting descriptions. [#6870](https://github.com/microsoft/vscode-cpptools/issues/6870)
* Add descriptions for setting enum values. [#7358](https://github.com/microsoft/vscode-cpptools/issues/7358)
* Add support for `${execPath}` and `${pathSeparator}` in `c_cpp_properties.json`. [#7753](https://github.com/microsoft/vscode-cpptools/issues/7753)
* Move the scope of document symbols from the name (on the left) to the details (on the right). [#7785](https://github.com/microsoft/vscode-cpptools/issues/7785)
* Fix an issue with config validation of Force Include values. [#7822](https://github.com/microsoft/vscode-cpptools/issues/7822)
* Fix an issue related to arg parsing in build tasks. [#7891](https://github.com/microsoft/vscode-cpptools/issues/7891)
* Add a check when cppbuild task is used when the active file is not a source file. [#7892](https://github.com/microsoft/vscode-cpptools/issues/7892)
* Fix a cpptools crash [#8055](https://github.com/microsoft/vscode-cpptools/issues/8055)
* Fix issue "LogPoint stopped working v1.6.0". [#8065](https://github.com/microsoft/vscode-cpptools/issues/8065)
	* [PR MIEngine#1208](https://github.com/microsoft/MIEngine/pull/1208)
* Fix issue "Debugger won't read/write from/to stdio". [#8075](https://github.com/microsoft/vscode-cpptools/issues/8075)
	* [PR MIEngine#1209](https://github.com/microsoft/MIEngine/pull/1209)
* Fix an issue with VC 14.0 headers not being found. [#8078](https://github.com/microsoft/vscode-cpptools/issues/8078)
* Fix an issue with CUDA support with `compile_commands.json`. [#8091](https://github.com/microsoft/vscode-cpptools/issues/8091)
* Fix an issue with `/kernel` arg to `cl.exe` for C files. [#8158](https://github.com/microsoft/vscode-cpptools/issues/8158)
* Fix an issue where inactive regions no longer dimmed after switching between open files. [#8206](https://github.com/microsoft/vscode-cpptools/issues/8206)

## Version 1.6.0: August 24, 2021
### New Features
* Added support for standard `.editorconfig` entries when using vcFormat. [#7920](https://github.com/microsoft/vscode-cpptools/issues/7920)
* Debug Step Granularity for cppdbg [PR MIEngine#1169](https://github.com/microsoft/MIEngine/pull/1169)
  * Thank you for the contribution @Trass3r
* InstructionBreakpoints for cppdbg [PR MIEgnine#1192](https://github.com/microsoft/MIEngine/pull/1192)

### Enhancements
* Debugger now runs on .NET 5 [#7858](https://github.com/microsoft/vscode-cpptools/pull/7858)
* When using the `Default` setting for `C_Cpp.formatting`, vcFormat will now be selected if a `.editorconfig` file is found with vcFormat entries and no `.clang-format` file was found with nearer proximity to the source file. [#7929](https://github.com/microsoft/vscode-cpptools/issues/7929)

### Bug Fixes
* Fix incorrect sizeof for packed structs (gcc/clang) [#5267](https://github.com/microsoft/vscode-cpptools/issues/5267)
* Fix designated initializers not working at file scope. [#6316](https://github.com/microsoft/vscode-cpptools/issues/6316)
* Fix an IntelliSense crash on template code. [#7349](https://github.com/microsoft/vscode-cpptools/issues/7349)
* Rank existence of a custom configuration higher than filename similarity and path proximity, when choosing a TU source for a header [#7396](https://github.com/microsoft/vscode-cpptools/issues/7396)
* Fix an IntelliSense crash when the display language is set to Italian. [#7685](https://github.com/microsoft/vscode-cpptools/issues/7685)
* Enable the C++ status bar items to be selectively disabled. [#7700](https://github.com/microsoft/vscode-cpptools/issues/7700)
* Fix an issue causing incorrect color selection for semantic tokens. [#7773](https://github.com/microsoft/vscode-cpptools/issues/7773)
* Fix some cl.exe and clang installations not being detected. [#7767](https://github.com/microsoft/vscode-cpptools/issues/7767) [#7795](https://github.com/microsoft/vscode-cpptools/issues/7795) [#7800](https://github.com/microsoft/vscode-cpptools/issues/7800)
* Fix an issue with recursive includes not found. [#7783](https://github.com/microsoft/vscode-cpptools/issues/7783)
* Fix an issue with code folding of single-line blocks. [#7809](https://github.com/microsoft/vscode-cpptools/issues/7809)
* Fix a typo in a localized string. [#7823](https://github.com/microsoft/vscode-cpptools/issues/7823)
* Add open file parsing status when hovering over the database icon. [PR #7831](https://github.com/microsoft/vscode-cpptools/pull/7831)
* Fix an issue with IntelliSense flame icon getting stuck on. [#7838](https://github.com/microsoft/vscode-cpptools/issues/7838)
* Fix an issue with character position after include completion. [#7856](https://github.com/microsoft/vscode-cpptools/issues/7856)
* Fix wrong version of clang-format being used in multi-root workspaces. [#7870](https://github.com/microsoft/vscode-cpptools/issues/7870)
* Fix issue with setting of MS extensions when `-fms-extensions` is used. [#7886](https://github.com/microsoft/vscode-cpptools/issues/7886)
* Fix an issue with support detection on Android. [#7906](https://github.com/microsoft/vscode-cpptools/issues/7906)
* Fix a bug with handling of `"C_Cpp.vcFormat.newLine.beforeOpenBrace.block": "newLine"`. [#7926](https://github.com/microsoft/vscode-cpptools/issues/7926)
* Fix Disassembly view is blank on linux [#7960](https://github.com/microsoft/vscode-cpptools/issues/7960)
* Fix an issue with cppdbg debugging on Windows x64. [#7971](https://github.com/microsoft/vscode-cpptools/issues/7971)
* Fix an issue with VS `<execution>` header causing IntelliSense process crash. [#7972](https://github.com/microsoft/vscode-cpptools/issues/7972)
* Fix insiders update install loop for remote scenarios. [#8000](https://github.com/microsoft/vscode-cpptools/issues/8000)
* Fix macOS unable to use external terminal to debug [#8008](https://github.com/microsoft/vscode-cpptools/issues/8008)

## Version 1.5.1: July 9, 2021
### Bug Fixes
* cppvsdbg Debugging becomes no-op between 1.4.1 and 1.5.0 [#7808](https://github.com/microsoft/vscode-cpptools/issues/7808)

## Version 1.5.0: July 8, 2021
### New Feature
* Add the "Inline macro" code action. [#4183](https://github.com/microsoft/vscode-cpptools/issues/4183)
* Add a Windows ARM64 debugger. [PR #7798](https://github.com/microsoft/vscode-cpptools/pull/7798)

### Enhancements
* Add auto-detection of clang compilers on Windows (and different versions of cl.exe). [#6718](https://github.com/microsoft/vscode-cpptools/issues/6718)
* Stop adding .cu files to `files.associations` (switch to using setTextDocumentLanguage). [#7359](https://github.com/microsoft/vscode-cpptools/issues/7359)
* Add "Symbol Options" for CppVsdbg to configure symbol settings [PR #7680](https://github.com/microsoft/vscode-cpptools/pull/7680)
* Update CppVsdbg to use newer CppEE and msdia.

### Bug Fixes
* Fix switch header/source not checking `files.exclude`. [#4429](https://github.com/microsoft/vscode-cpptools/issues/4429)
* Fix code folding causing `} else if` lines to be hidden. [#5521](https://github.com/microsoft/vscode-cpptools/issues/5521)
* Add abort handling to recursive includes directory iteration. [#6461](https://github.com/microsoft/vscode-cpptools/issues/6461)
* Fix include completion with recursive includes in header files. [#6842](https://github.com/microsoft/vscode-cpptools/issues/6842)
* Add the get-task-allow entitlement to macOS binaries to enable call stacks to be obtained when SIP is enabled. [#7412](https://github.com/microsoft/vscode-cpptools/issues/7412)
* Fix Find All References reporting certain references in headers as inactive. [#7609](https://github.com/microsoft/vscode-cpptools/issues/7609)
* Fix IntelliSense process crash and tag parser failure with columns > 65535. [#7621](https://github.com/microsoft/vscode-cpptools/issues/7621)
* Fix incorrect localization translations.
  * jogo- (@jogo-) [PR #7625](https://github.com/microsoft/vscode-cpptools/pull/7625)
* Fix `autocompleteAddParentheses` for some template argument deduction cases. [#7626](https://github.com/microsoft/vscode-cpptools/issues/7626)
* Fix some incorrect IntelliSense errors. [#6639](https://github.com/microsoft/vscode-cpptools/issues/6639), [#7630](https://github.com/microsoft/vscode-cpptools/issues/7630)
* Change references of "OS X" to "macOS".
  * Tyler Davis (@TylerADavis) [PR #7636](https://github.com/microsoft/vscode-cpptools/pull/7636)
* Prevent the root path from being added to the `browse.path`. [#7648](https://github.com/microsoft/vscode-cpptools/issues/7648)
* Fix a configuration squiggle when `${workspaceFolder}` is used with `compilerPath`. [#7649](https://github.com/microsoft/vscode-cpptools/issues/7649)
* Fix an issue causing editorConfig not to be used or cached. [PR #7666](https://github.com/microsoft/vscode-cpptools/pull/7666)
* Fix document symbols nesting with templates. [#7673](https://github.com/microsoft/vscode-cpptools/issues/7673)
* Fix include paths not being found when the paths start with /D or /I. [#7701](https://github.com/microsoft/vscode-cpptools/issues/7701), [#7757](https://github.com/microsoft/vscode-cpptools/issues/7756)
* Fix Find All References on a global variable giving incorrect references to local variables. [#7702](https://github.com/microsoft/vscode-cpptools/issues/7702)
* Fix `vcFormat` not working near the end of the file with UTF-8 characters > 1 byte. [#7704](https://github.com/microsoft/vscode-cpptools/issues/7704)
* Fix a configuration squiggle for a recursively resolved `forcedInclude`. [PR #7722](https://github.com/microsoft/vscode-cpptools/pull/7722)
* Fix `Build and Debug Active File` for certain file extensions (.cu, .cp, etc.).
  * jogo- (@jogo-) [PR #7726](https://github.com/microsoft/vscode-cpptools/pull/7726)
* Fix `browse.path` being incorrect if an invalid `compileCommands` is set. [#7737](https://github.com/microsoft/vscode-cpptools/issues/7737)
* Fix an incorrect error message when `C_Cpp.errorSquiggles` is `Enabled`. [#7744](https://github.com/microsoft/vscode-cpptools/issues/7744)
* Fix compiler querying sometimes not working with Cygwin. [#7751](https://github.com/microsoft/vscode-cpptools/issues/7751)
* Fix a duplicate IntelliSense update when a new C/C++ file is opened and after switching from a non-C/C++ file and back.
* Fix a potential IntelliSense process crash on shutdown.

## Version 1.4.1: June 8, 2021
### Bug Fixes
* Fix the configuration UI sometimes not populating initially with VS Code 1.56 or later. [#7641](https://github.com/microsoft/vscode-cpptools/issues/7641)

## Version 1.4.0: May 27, 2021
### New Features
* Add a C++ walkthrough to the "Getting Started" page. [#7273](https://github.com/microsoft/vscode-cpptools/issues/7273)
  * Note: VS Code may only make this available to a subset of users while they continue working on the feature.

### Enhancements
* Update to clang-format 12. [#6434](https://github.com/microsoft/vscode-cpptools/issues/6434)
* Add `private` or `protected` scope labels to class symbols. [#7120](https://github.com/microsoft/vscode-cpptools/issues/7120)
* Fix file:line path for $FILEPOS [#7193](https://github.com/microsoft/vscode-cpptools/issues/7193)
	* [PR MIEngine#1124](https://github.com/microsoft/MIEngine/pull/1124)
* Add `stopAtConnect` and `hardwareBreakpoints` launch options [PR #7449](https://github.com/microsoft/vscode-cpptools/pull/7449)
  * `stopAtConnect` stops the debugger on connection to a remote target [PR MIEngine#1109](https://github.com/microsoft/MIEngine/pull/1109)
  * `hardwareBreakpoints` controls usage and number of remote hardware breakpoints [PR MIEngine#1128](https://github.com/microsoft/MIEngine/pull/1128)
* Add support for loading Concord extensions to the cppvsdbg debug adapter (see [documentation](https://github.com/microsoft/ConcordExtensibilitySamples/wiki/Support-for-VS-Code-cppvsdbg-Scenarios) for more information)
* Add support for exception conditions to cppvsdbg (see [documentation](https://aka.ms/VSCode-Cpp-ExceptionSettings) for more information)

### Bug Fixes
* Fix an incorrect IntelliSense error with object initialization. [#3212](https://github.com/microsoft/vscode-cpptools/issues/3212)
* Fix IntelliSense errors with designated initializers. [#3491](https://github.com/microsoft/vscode-cpptools/issues/3491), [#5500](https://github.com/microsoft/vscode-cpptools/issues/5550)
* Fix IntelliSense configuration with cl.exe compiler args `/external:I`, `/Zc:preprocessor`, and others. [#4980](https://github.com/microsoft/vscode-cpptools/issues/4980), [#6531](https://github.com/microsoft/vscode-cpptools/issues/6531), [#7259](https://github.com/microsoft/vscode-cpptools/issues/7259)
* Switch to showing no document symbols instead of random symbols for `files.exclude`'d documents. [#5142](https://github.com/microsoft/vscode-cpptools/issues/5142)
* Fix macros getting undefined when duplicate `#include` are used. [#5182](https://github.com/microsoft/vscode-cpptools/issues/5182), [#7270](https://github.com/microsoft/vscode-cpptools/issues/7270)
* Fix provider failed error logging. [#5487](https://github.com/microsoft/vscode-cpptools/issues/5487)
* Fix an IntelliSense crash with `#pragma GCC target`. [#6698](https://github.com/microsoft/vscode-cpptools/issues/6698), [#7377](https://github.com/microsoft/vscode-cpptools/issues/7377)
* Fix bitness detection for compilers targeting esp32. [#7034](https://github.com/microsoft/vscode-cpptools/issues/7034)
* Fix -idirafter directories being included too early. [#7129](https://github.com/microsoft/vscode-cpptools/issues/7129)
* Fix issue with the cpptools process lingering when no longer needed. [#7262](https://github.com/microsoft/vscode-cpptools/issues/7262)
* Filter out C++ std when querying the compiler as C (and vice versa). [#7269](https://github.com/microsoft/vscode-cpptools/issues/7269)
* Fix `files.exclude` ending with `/folder/**` not excluding `/folder`. [#7331](https://github.com/microsoft/vscode-cpptools/issues/7331)
* Fix VS Code UI freezing when hovering over very large literals. [#7334](https://github.com/microsoft/vscode-cpptools/issues/7334), [#7577](https://github.com/microsoft/vscode-cpptools/issues/7577)
* Fix clang-format formatting bug when new lines are removed. [#7360](https://github.com/microsoft/vscode-cpptools/issues/7360)
* Change default cwd in launch.json to `${fileDirname}`. [#7362](https://github.com/microsoft/vscode-cpptools/issues/7362)
  * Syed Ahmad (@HackintoshwithUbuntu) [PR #7363](https://github.com/microsoft/vscode-cpptools/pull/7363)
* Fix the compile commands entry not being used when -Werror is used. [#7388](https://github.com/microsoft/vscode-cpptools/issues/7388)
* Fix some potential race conditions during vsix installation. [#7405](https://github.com/microsoft/vscode-cpptools/issues/7405)
* Fix completion at the end of a file. [#7472](https://github.com/microsoft/vscode-cpptools/issues/7472)
* Fix completion of constructors. [#7505](https://github.com/microsoft/vscode-cpptools/issues/7505)
* Fix typos.
  * jogo- (@jogo-) [PR #7509](https://github.com/microsoft/vscode-cpptools/pull/7509), [PR #7568](https://github.com/microsoft/vscode-cpptools/pull/7568), [PR #7573](https://github.com/microsoft/vscode-cpptools/pull/7573)
* Fix an IntelliSense crash with the arrow library. [#7518](https://github.com/microsoft/vscode-cpptools/issues/7518)
* Fix the configuration UI randomly being blank (more frequently when remote). [#7523](https://github.com/microsoft/vscode-cpptools/issues/7523)
* Fix IntelliSense mode switching from `linux` to `macos` if `__unix__` is defined but `__linux__` is not. [#7525](https://github.com/microsoft/vscode-cpptools/issues/7525)
* Fix enabling of the `ms_extensions` flag for clang on Windows. [#7529](https://github.com/microsoft/vscode-cpptools/issues/7529)
* Fix `autocompleteAddParentheses` with no argument const/non-const overloads and deduction guides. [#7540](https://github.com/microsoft/vscode-cpptools/issues/7540), [#7541](https://github.com/microsoft/vscode-cpptools/issues/7541)
* Fix the browse configuration not being preserved when the configuration provider is auto-detected. [#7542](https://github.com/microsoft/vscode-cpptools/issues/7542)
* Fix clang-format failure on macOS 10.13 or older. [#7561](https://github.com/microsoft/vscode-cpptools/issues/7561)
* Fix an IntelliSense crash with std::ranges::unique. [#7576](https://github.com/microsoft/vscode-cpptools/issues/7576)
* Prevent 'Configuration Warnings' output when a custom configuration provider omits optional fields.
* Prevent 'Configuration Warnings' caused by corrections to auto-detected default configuration values.
* Reduce IntelliSense memory and CPU usage in certain scenarios (e.g. large files).
* Fix a crash on Linux with a `/**` includePath.

## Version 1.3.1: April 19, 2021
### Bug Fixes
* Fix extension not activating when `/.vscode/c_cpp_properties.json` exists but no C/C++ file is open. [#7344](https://github.com/microsoft/vscode-cpptools/issues/7344)
* Fix logging for an invalid provider configuration.
  * Yonggang Luo (@lygstate) [PR #7350](https://github.com/microsoft/vscode-cpptools/pull/7350)
* Fix extension activation with 32-bit Windows. [#7368](https://github.com/microsoft/vscode-cpptools/issues/7368)

## Version 1.3.0: April 13, 2021
### New Features
* Add language service support for CUDA.
* Add highlighting of matching conditional preprocessor statements. [#2565](https://github.com/microsoft/vscode-cpptools/issues/2565)
* Add commands for navigating to matching preprocessor directives in conditional groups. [#4779](https://github.com/microsoft/vscode-cpptools/issues/4779)
* Add native language service binaries for ARM64 Mac. [#6595](https://github.com/microsoft/vscode-cpptools/issues/6595)

### Enhancements
* Add parentheses to function calls when `C_Cpp.autocompleteAddParentheses` is `true`. [#882](https://github.com/microsoft/vscode-cpptools/issues/882)
* Add @retval support to the simplified view of doc comments. [#6816](https://github.com/microsoft/vscode-cpptools/issues/6816)
* Add auto-closing of include completion brackets. [#7054](https://github.com/microsoft/vscode-cpptools/issues/7054)
* Add support for nodeAddonIncludes with Yarn PnP.
  * Mestery (@Mesterry) [PR #7123](https://github.com/microsoft/vscode-cpptools/pull/7123)
* Add a `C_Cpp.files.exclude` setting, which is identical to `files.exclude` except items aren't excluded from the Explorer view. [PR #7285](https://github.com/microsoft/vscode-cpptools/pull/7285)

### Bug Fixes
* Display integer values for char and unsigned char on hover instead of character symbols. [#1552](https://github.com/microsoft/vscode-cpptools/issues/1552)
* Fix directory iteration to check files.exclude and symlinks and use less memory. [#3123](https://github.com/microsoft/vscode-cpptools/issues/3123), [#4206](https://github.com/microsoft/vscode-cpptools/issues/4206), [#6864](https://github.com/microsoft/vscode-cpptools/issues/6864)
* Fix an issue with stale IntelliSense due to moving or renaming header files. [#3849](https://github.com/microsoft/vscode-cpptools/issues/3849)
* Fix go to definition on large macros. [#4306](https://github.com/microsoft/vscode-cpptools/issues/4306)
* Fix a spurious asterisk being inserted on a new line if the previous line starts with an asterisk. [#5733](https://github.com/microsoft/vscode-cpptools/issues/5733)
* Fix bug with placement new on Windows with gcc mode. [#6246](https://github.com/microsoft/vscode-cpptools/issues/6246)
* Fix size_t and placement new squiggles with clang on Windows. [#6573](https://github.com/microsoft/vscode-cpptools/issues/6573), [#7106](https://github.com/microsoft/vscode-cpptools/issues/7016)
* Fix an incorrect IntelliSense error squiggle when assigning to std::variant in clang mode. [#6623](https://github.com/microsoft/vscode-cpptools/issues/6623)
* Fix incorrect squiggle with range-v3 library. [#6639](https://github.com/microsoft/vscode-cpptools/issues/6639)
* Fix incorrect squiggle with auto parameters. [#6714](https://github.com/microsoft/vscode-cpptools/issues/6714)
* Fix (reimplement) nested document symbols. [#6830](https://github.com/microsoft/vscode-cpptools/issues/6830), [#7023](https://github.com/microsoft/vscode-cpptools/issues/7023), [#7024](https://github.com/microsoft/vscode-cpptools/issues/7024)
* Fix detection of bitness for compilers targeting esp32. [#7034](https://github.com/microsoft/vscode-cpptools/issues/7034)
* Fix include completion not working after creating a new header with a non-standard extension until a reload is done. [#6987](https://github.com/microsoft/vscode-cpptools/issues/6987), [#7061](https://github.com/microsoft/vscode-cpptools/issues/7061)
* Fix endless CPU/memory usage in cpptools-srv when certain templated type aliases are used. [#7085](https://github.com/microsoft/vscode-cpptools/issues/7085)
* Fix "No symbols found" sometimes occurring when a document first opens. [#7103](https://github.com/microsoft/vscode-cpptools/issues/7103)
* Fix vcFormat formatting after typing brackets and a newline. [#7125](https://github.com/microsoft/vscode-cpptools/issues/7125)
* Fix a performance bug after formatting a document. [#7159](https://github.com/microsoft/vscode-cpptools/issues/7159)
* Fix random crashes of cpptools-srv during shutdown. [#7161](https://github.com/microsoft/vscode-cpptools/issues/7161)
* Fix a bug with relative "." paths in compile commands. [#7221](https://github.com/microsoft/vscode-cpptools/issues/7221)
* Fix configuration issues with Unreal Engine projects. [#7222](https://github.com/microsoft/vscode-cpptools/issues/7222)
* Fix bug when `${workspaceFolder}` is used in `compileCommands`. [#7241](https://github.com/microsoft/vscode-cpptools/issues/7241)
  * Aleksa Pavlovic (@aleksa2808) [PR #7242](https://github.com/microsoft/vscode-cpptools/pull/7242)
* Fix field requirements for custom configurations. [PR #7295](https://github.com/microsoft/vscode-cpptools/pull/7295)
* Fix integrity hash checking of downloaded packages for the extension. [PR #7300](https://github.com/microsoft/vscode-cpptools/pull/7300)
* Fix a bug preventing successful validation and receipt of browse configurations from custom configuration providers. [PR# 7131](https://github.com/microsoft/vscode-cpptools/pull/7313)
* Fix a potential crash when editing at the end of a document.
* Fix "Configure Task" selection to show root folder names for multi-root workspace [PR #7315](https://github.com/microsoft/vscode-cpptools/pull/7315)

## Version 1.2.2: February 25, 2021
### Bug Fixes
* Fix IntelliSense errors with variable length arrays with C Clang mode. [#6500](https://github.com/microsoft/vscode-cpptools/issues/6500)
* Fix for random IntelliSense communication failures on Mac. [#6809](https://github.com/microsoft/vscode-cpptools/issues/6809), [#6958](https://github.com/microsoft/vscode-cpptools/issues/6958)
* Fix an extension activation failure when a non-existent folder exists in the workspace. [#6981](https://github.com/microsoft/vscode-cpptools/issues/6981)
* Fix infinite loops during document symbol processing. [#6988](https://github.com/microsoft/vscode-cpptools/issues/6988), [#7012](https://github.com/microsoft/vscode-cpptools/issues/7012), [#7022](https://github.com/microsoft/vscode-cpptools/issues/7022), [#7025](https://github.com/microsoft/vscode-cpptools/issues/7025)
* Fix a regression with handling of -isysroot/--sysroot compiler arguments. [#6992](https://github.com/microsoft/vscode-cpptools/issues/6992)
* Fix issue querying certain compilers, including armclang and arm-poky-linux-musleabi-gcc. [#7021](https://github.com/microsoft/vscode-cpptools/issues/7021)
* Fix invalid "console" property when generating a "cppdbg" task. [#7048](https://github.com/microsoft/vscode-cpptools/issues/7048)

## Version 1.2.1: February 16, 2021
### Bug Fixes
* Fix `Switch Header/Source` in two cases when symlinks are in the path. [#6855](https://github.com/microsoft/vscode-cpptools/issues/6855)
* Fix clang-format FixNamespaceComments default. [#6894](https://github.com/microsoft/vscode-cpptools/issues/6894)
* Fix an issue with querying certain compilers for system defines and system includes [#6898](https://github.com/microsoft/vscode-cpptools/issues/6898)
* Fix an issue preventing detection of default target and default language standard of Cygwin and WSL compilers. [#6902](https://github.com/microsoft/vscode-cpptools/issues/6902)
* Fix an issue with detection of Apple Clang. [#6916](https://github.com/microsoft/vscode-cpptools/issues/6916)
* Fix endless memory usage (or a crash) with certain code. [#6940](https://github.com/microsoft/vscode-cpptools/issues/6940)
* Fix "format after newline" with vcFormat. [#6942](https://github.com/microsoft/vscode-cpptools/issues/6942)
* Fix compiler querying with -Xclang and -include-pch arguments. [#6944](https://github.com/microsoft/vscode-cpptools/issues/6944)
* Switch to the signed LLDB-MI on Mac 10.14 or newer with the online vsix. [#6945](https://github.com/microsoft/vscode-cpptools/issues/6945)

## Version 1.2.0: February 2, 2021
### New Features
* Add support for cross-compilation configurations for IntelliSense. For example, `intelliSenseMode` value "linux-gcc-x64" could be used on a Mac host machine. [#1083](https://github.com/microsoft/vscode-cpptools/issues/1083)

### Enhancements
* Show configuration squiggles when configurations with the same name exist. [#3412](https://github.com/microsoft/vscode-cpptools/issues/3412)
* Add `C_Cpp.addNodeAddonIncludePaths` setting to add include paths from `nan` and `node-addon-api` when they're dependencies. [#4854](https://github.com/microsoft/vscode-cpptools/issues/4854)
  * Bruce MacNaughton (@bmacnaughton) [PR #67331](https://github.com/microsoft/vscode-cpptools/pull/6731)
* Add command `Generate EditorConfig contents from VC Format settings`. [#6018](https://github.com/microsoft/vscode-cpptools/issues/6018)
* Update to clang-format 11.1. [#6326](https://github.com/microsoft/vscode-cpptools/issues/6326)
* Add clang-format built for Windows ARM64. [#6494](https://github.com/microsoft/vscode-cpptools/issues/6494)
* Add support for the `/await` flag with msvc IntelliSense. [#6596](https://github.com/microsoft/vscode-cpptools/issues/6596)
* Increase document/workspace symbol limit from 1000 to 10000. [#6766](https://github.com/microsoft/vscode-cpptools/issues/6766)
* Add new "console" launch config for cppvsdbg. [PR #6794](https://github.com/microsoft/vscode-cpptools/pull/6794)

### Bug Fixes
* Fix handling of `--sysroot` and `-isysroot` with `compileCommands`. [#1575](https://github.com/microsoft/vscode-cpptools/issues/1575)
* Fix IntelliSense not updating if a non-opened header is changed. [#1780](https://github.com/microsoft/vscode-cpptools/issues/1780)
* Fix IntelliSense involving overflow for unsigned int values. [#2202](https://github.com/microsoft/vscode-cpptools/issues/2202)
* Fix IntelliSense not switching the language mode after changing C versus C++ `files.associations`. [#2557](https://github.com/microsoft/vscode-cpptools/issues/2557)
* Fix Switch Header/Source not switching to an existing file in another column if it's not visible. [#2667](https://github.com/microsoft/vscode-cpptools/issues/2667), [#6749](https://github.com/microsoft/vscode-cpptools/issues/6749)
* Fix autocomplete not working with `for` loop variables with C code. [#2946](https://github.com/microsoft/vscode-cpptools/issues/2946)
* Fix `#include` completion not sorting _ last. [#3465](https://github.com/microsoft/vscode-cpptools/issues/3465)
* Fix completion not working for templates in gcc/clang mode. [#3501](https://github.com/microsoft/vscode-cpptools/issues/3501)
* Fix crash when certain JavaScript files are parsed as C++. [#3858](https://github.com/microsoft/vscode-cpptools/issues/3858)
* Fix IntelliSense squiggle about not being able to assign to an object of its own type. [#3883](https://github.com/microsoft/vscode-cpptools/issues/3883)
* Fix hover and Find All References for template function overloads. [#4044](https://github.com/microsoft/vscode-cpptools/issues/4044), [#4249](https://github.com/microsoft/vscode-cpptools/issues/4249)
* Fix the Outline view for nested namespaces. [#4456](https://github.com/microsoft/vscode-cpptools/issues/4456)
* Fix some IntelliSense parsing errors. [#4595](https://github.com/microsoft/vscode-cpptools/issues/4595), [#6362](https://github.com/microsoft/vscode-cpptools/issues/6362), [#6685](https://github.com/microsoft/vscode-cpptools/issues/6685)
* Fix Outline view with`"**/.*"` in `files.exclude`. [#4602](https://github.com/microsoft/vscode-cpptools/issues/4602)
* Fix build tasks errors in single file mode. [#4638](https://github.com/microsoft/vscode-cpptools/issues/4638), [#6764](https://github.com/microsoft/vscode-cpptools/issues/6764)
* Fix the Outline view for nested structs/classes. [#4781](https://github.com/microsoft/vscode-cpptools/issues/4871)
* Fix `files.exclude` not applying to watched files handlers. [#5141](https://github.com/microsoft/vscode-cpptools/issues/5141)
* Fix code folding incorrectly matching an inactive `}`. [#5429](https://github.com/microsoft/vscode-cpptools/issues/5429)
* Fix IntelliSense Clang version for Apple Clang. [#5500](https://github.com/microsoft/vscode-cpptools/issues/5500)
* Fix hover doc comments not working if there's a selection. [#5635](https://github.com/microsoft/vscode-cpptools/issues/5635), [#6583](https://github.com/microsoft/vscode-cpptools/issues/6583)
* Fix `#include` completion to include results for non-standard header file extensions. [#5698](https://github.com/microsoft/vscode-cpptools/issues/5698)
* Fix clang-format failing due to missing libtinfo5 on Linux ARM/ARM64. [#5958](https://github.com/microsoft/vscode-cpptools/issues/5958)
* Automatically configure to use a custom configuration provider if available and no other configuration exists. [#6150](https://github.com/microsoft/vscode-cpptools/issues/6150)
* Fix not being able to attach to cpptools and cpptools-srv on Mac (to get crash call stacks). [#6151](https://github.com/microsoft/vscode-cpptools/issues/6151), [#6736](https://github.com/microsoft/vscode-cpptools/issues/6736)
* Fix IntelliSense crashing with cl.exe with C++20 and span. [#6251](https://github.com/microsoft/vscode-cpptools/issues/6251)
* Stop querying unsupported compilers. [#6314](https://github.com/microsoft/vscode-cpptools/issues/6314)
* Fix an entry not found error for files in `compile_commands.json` that didn't initially exist. [#6311](https://github.com/microsoft/vscode-cpptools/issues/6311)
* Fix IntelliSense errors with C++20 std::ranges in gcc/clang modes. [#6342](https://github.com/microsoft/vscode-cpptools/issues/6342)
* Add a workaround for a missing compiler path for the `compile_commands.json` generated by Unreal Engine. [#6358](https://github.com/microsoft/vscode-cpptools/issues/6358)
* Fix IntelliSense crash with coroutines. [#6363](https://github.com/microsoft/vscode-cpptools/issues/6363)
* Add localized strings for `cppbuild` tasks. [#6436](https://github.com/microsoft/vscode-cpptools/issues/6436)
* Fix IntelliSense squiggle with C++20 non-type templates. [#6462](https://github.com/microsoft/vscode-cpptools/issues/6462)
* Fix `compilerArgs` processing with `-MF` and other multi-arg arguments. [#6478](https://github.com/microsoft/vscode-cpptools/issues/6478)
* Fix bug causing `Unable to read process.env.HOME`. [#6468](https://github.com/microsoft/vscode-cpptools/issues/6468)
* Fix gcc problem matcher when the column is missing.
  * @guntern [PR #6490](https://github.com/microsoft/vscode-cpptools/pull/6490)
* Disable Insiders prompt for Codespaces. [#6491](https://github.com/microsoft/vscode-cpptools/issues/6491)
* Fix `compile_commands.json` not working correctly for `*.C` files. [#6497](https://github.com/microsoft/vscode-cpptools/issues/6497)
* Show an error message when gdb can't be found when generating a `launch.json` (instead of using an invalid `miDebuggerPath`). [#6511](https://github.com/microsoft/vscode-cpptools/issues/6511)
* Fix IntelliSense not supporting `__float128` (and `Q` literals) on x64 Linux. [#6574](https://github.com/microsoft/vscode-cpptools/issues/6574)
* Fix IntelliSense crash with a parenthesized type followed by an initializer list. [#6554](https://github.com/microsoft/vscode-cpptools/issues/6554), [#6624](https://github.com/microsoft/vscode-cpptools/issues/6624)
* Fix IntelliSense updating after pasting multi-line code. [#6565](https://github.com/microsoft/vscode-cpptools/issues/6565)
* Use "method" instead of "member" for semantic tokens. [#6569](https://github.com/microsoft/vscode-cpptools/issues/6569)
* Fix `__builtin_coro_*` methods not recognized by IntelliSense in gcc mode with `-fcoroutines`. [#6575](https://github.com/microsoft/vscode-cpptools/issues/6575)
* Fix the `else` snippet interfering with entering one line `else` statements. [#6582](https://github.com/microsoft/vscode-cpptools/issues/6582)
* Stop showing an "unknown error" message after canceling the creation of a `launch.json`. [#6608](https://github.com/microsoft/vscode-cpptools/issues/6608)
* Fix potential extension activation delay. [#6630](https://github.com/microsoft/vscode-cpptools/issues/6630)
* Fix the executed command not appearing with cppbuild tasks. [#6647](https://github.com/microsoft/vscode-cpptools/issues/6647)
* Fix IntelliSense crash on Mac due to IPCH file corruption. [#6673](https://github.com/microsoft/vscode-cpptools/issues/6673)
* Fix `_Debug` not being defined when `/MDd` or `/MTd` are used. [#6690](https://github.com/microsoft/vscode-cpptools/issues/6690)
* Fix infinite IntelliSense processing when C++20, gcc mode, and `-fcoroutines` and used. [#6709](https://github.com/microsoft/vscode-cpptools/issues/6709)
* Allow the extension to run on M1 Macs. [#6713](https://github.com/microsoft/vscode-cpptools/issues/6713)
  * Xiangyi Meng (@xymeng16) [PR #6601](https://github.com/microsoft/vscode-cpptools/pull/6601)
* Fix IntelliSense errors when "module" is used as a variable name with C++20. [#6719](https://github.com/microsoft/vscode-cpptools/issues/6719)
* Fix `.` to `->` completion with multiple cursors. [#6720](https://github.com/microsoft/vscode-cpptools/issues/6720)
* Fix bug with configured cl.exe path not being used to choose appropriate system include paths, or cl.exe not being used at all if it's not also installed via the VS Installer. [#6746](https://github.com/microsoft/vscode-cpptools/issues/6746)
* Fix bugs with parsing of quotes and escape sequences in compiler args. [#6761](https://github.com/microsoft/vscode-cpptools/issues/6761)
* Fix the configuration not showing in the status bar when `c_cpp_properties.json` is active. [#6765](https://github.com/microsoft/vscode-cpptools/issues/6765)
* Fix compiler querying with compilers that do not output `__STD_VERSION__` by default (gcc <= 4.8.x). [#6792](https://github.com/microsoft/vscode-cpptools/issues/6792)
* Fix document symbols when nested symbols have the same name as a parent. [#6830](https://github.com/microsoft/vscode-cpptools/issues/6830)
* Fix automatic adding of header files to `files.associations` after `Go to Definition` on a `#include`. [#6845](https://github.com/microsoft/vscode-cpptools/issues/6845)
* Fix `Insiders` `updateChannel` for VS Code - Exploration. [#6875](https://github.com/microsoft/vscode-cpptools/issues/6875)
* Fix "D" command line warnings not appearing with cl.exe cppbuild build tasks.
* Fix cl.exe cppbuild tasks when `/nologo` is used (and make /nologo a default arg).
* Fix a cpptools crash and multiple deadlocks.

## Version 1.1.3: December 3, 2020
### Bug Fixes
* Disable the "join Insiders" prompt for Linux CodeSpaces. [#6491](https://github.com/microsoft/vscode-cpptools/issues/6491)
* Fix "shell" tasks giving error "Cannot read property `includes` of undefined". [#6538](https://github.com/microsoft/vscode-cpptools/issues/6538)
* Fix various task variables not getting resolved with `cppbuild` tasks. [#6538](https://github.com/microsoft/vscode-cpptools/issues/6538)
* Fix warnings not appearing with `cppbuild` tasks. [#6556](https://github.com/microsoft/vscode-cpptools/issues/6556)
* Fix endless CPU/memory usage if the cpptools process crashes. [#6603](https://github.com/microsoft/vscode-cpptools/issues/6603)
* Fix the default `cwd` for `cppbuild` tasks. [#6618](https://github.com/microsoft/vscode-cpptools/issues/6618)

## Version 1.1.2: November 17, 2020
### Bug Fixes
* Fix resolution of `${fileDirname}` with `cppbuild` tasks. [#6386](https://github.com/microsoft/vscode-cpptools/issues/6386)

## Version 1.1.1: November 9, 2020
### Bug Fixes
* Fix cpptools binaries sometimes not getting installed on Windows. [#6453](https://github.com/microsoft/vscode-cpptools/issues/6453)

## Version 1.1.0: November 5, 2020
### New Features
* Add language server support for Windows ARM64 (no debugging yet). [#5583](https://github.com/microsoft/vscode-cpptools/issues/5583)
* [cppdbg] Debugger Protocol Updates:
  * ReadMemoryRequest [PR MIEngine#1028](https://github.com/microsoft/MIEngine/pull/1028)
  * ModulesRequest and ModuleEvent [PR MIEngine#1054](https://github.com/microsoft/MIEngine/pull/1054)
* [cppdbg] Support new SourceFileMap schema [PR #6319](https://github.com/microsoft/vscode-cpptools/pull/6319)

### Enhancements
* Add support to run c/cpp build tasks. [#3674](https://github.com/microsoft/vscode-cpptools/issues/3674), [#5270](https://github.com/microsoft/vscode-cpptools/issues/5270), [#5285](https://github.com/microsoft/vscode-cpptools/issues/5285)
  * Tasks: Configure Task
  * Tasks: Run Build Task
  * C/C++: Build and debug active file.
* Add logging around compiler querying, and the "C/C++ Configuration Warnings" output channel. [#5259](https://github.com/microsoft/vscode-cpptools/issues/5259)
* Add compile commands info to Log Diagnostics. [#5761](https://github.com/microsoft/vscode-cpptools/issues/5761)
* Add `intelliSenseUpdateDelay` setting. [#6142](https://github.com/microsoft/vscode-cpptools/issues/6142)
  * YuTengjing (@tjx666) [PR #6344](https://github.com/microsoft/vscode-cpptools/pull/6344)
* Enable support for specifying a compiler by only the filename if it's in the environment path. [#6179](https://github.com/microsoft/vscode-cpptools/issues/6179)
* Restart the IntelliSense process if its memory usage exceeds the `C_Cpp.intelliSenseMemoryLimit` setting. [#6230](https://github.com/microsoft/vscode-cpptools/issues/6230)
* [cppdbg] Stepping out of a function will display '$ReturnValue'.
  * @Trass3r [PR MIEngine#1036](https://github.com/microsoft/MIEngine/pull/1036)
* [cppdbg] Support composite expressions in natvis ArrayItems
  * @Trass3r [PR MIEngine#1044](https://github.com/microsoft/MIEngine/pull/1044)
* Add handling of the "-ansi" compiler arg when querying gcc/clang compilers.
* Add support for inferring the IntelliSenseMode based on the "--target" compiler arg.
* Add support for inferring the C standard based on new c11/c17 language standard args for cl.exe.
* Allow custom config providers to omit IntelliSenseMode and C/C++ language standard, enabling them to be inferred from the `compilerPath` and `compilerArgs`.

### Bug Fixes
* Change macOS Framework searching to only parse the "Current" framework folder when the "Headers" folder is not found. [#2046](https://github.com/microsoft/vscode-cpptools/issues/2046)
* Show the compiler path in the `Build and Debug Active File` dropdown. [#4278](https://github.com/microsoft/vscode-cpptools/issues/4278)
* Fix incorrect signature help active argument with multiple template parameters. [#4786](https://github.com/microsoft/vscode-cpptools/issues/4786)
* Fix bug with directories not getting created for browse.databaseFilename. [#5181](https://github.com/microsoft/vscode-cpptools/issues/5181)
* Allow the debug configuration to wait for the preLaunchTask to complete before continuing on and resolving environment variables or processes that may have been set in the 'tasks.json'. [#5287](https://github.com/microsoft/vscode-cpptools/issues/5287)
* Change the Windows SDK detection to require the shared, ucrt, and um folders. [#5817](https://github.com/microsoft/vscode-cpptools/issues/5817)
* Fix issues with IntelliSense for clang-cl.exe. [#6075](https://github.com/microsoft/vscode-cpptools/issues/6075)
* Fix "Comments are not permitted in JSON" error when `c_cpp_properties.json` is open but not active. [#6132](https://github.com/microsoft/vscode-cpptools/issues/6132)
* Rename the C language standard setting values from c18 and gnu18 to c17 and gnu17. [#6105](https://github.com/microsoft/vscode-cpptools/issues/6105)
* Add more IntelliSense support for std ranges, concepts, and modules exports (__cpp_lib_concepts is now enabled). [#6173](https://github.com/microsoft/vscode-cpptools/issues/6173)
* Add "-fnoblocks" when querying clang on Mac, as IntelliSense does not currently support blocks. [#6189](https://github.com/microsoft/vscode-cpptools/issues/6189)
* Fix clang-format on 32-bit Windows. [#6195](https://github.com/microsoft/vscode-cpptools/issues/6195)
* Fix incorrect formatting results when clang-format removes duplicate includes. [#6205](https://github.com/microsoft/vscode-cpptools/issues/6205)
* Fix a case where the main process could get stuck. [#6207](https://github.com/microsoft/vscode-cpptools/issues/6207)
* Fix C files being treated as C++ files with compile_commands.json. [#6279](https://github.com/microsoft/vscode-cpptools/issues/6279)
* Fix `Build and Debug Active File` race condition with EngineLogs. [#6304](https://github.com/microsoft/vscode-cpptools/pull/6304)
* Fix changes to some `c_cpp_properties.json` properties not taking effect (until a reload) if `compileCommands` is set. [#6332](https://github.com/microsoft/vscode-cpptools/issues/6332)
* Fix issue with compiler querying not handling various clang command line options correctly. [#6356](https://github.com/microsoft/vscode-cpptools/issues/6356),  [#6359](https://github.com/microsoft/vscode-cpptools/issues/6359)
* Fix multi-root workspace tag parsing when `compileCommands` is set. [#6383](https://github.com/microsoft/vscode-cpptools/issues/6383)
* Fix mingw32 compilers not being detected. [#6394](https://github.com/microsoft/vscode-cpptools/issues/6394)
* Various bug fixes for vcFormat. [PR #6408](https://github.com/microsoft/vscode-cpptools/pull/6408)
* Fix issue causing zh-cn and zh-tw language files not to be used. [PR #6418](https://github.com/microsoft/vscode-cpptools/pull/6418)
* Fix the handling of various compiler arg pairs when querying compilers.
* Avoid parsing entries in compile_commands.json for file types that we do not support.
* Fixed an issue in which only C or C++ system headers were added to the browse path, rather than both.
* Fix issue causing some localized messages to be displayed incorrectly.
* Fixed issue with shipping an older version of vsdbg in offline packages.

### Other Contributions
* Refactoring provider classes.
  * Abhishek Pal (@devabhishekpal) [PR #5998](https://github.com/microsoft/vscode-cpptools/pull/5998)

## Version 1.0.1: September 21, 2020
### Bug Fixes
* Fix "No IL available" IntelliSense error on Linux/macOS when `#error` directives are present in the source code. [#6009](https://github.com/microsoft/vscode-cpptools/issues/6009), [#6114](https://github.com/microsoft/vscode-cpptools/issues/6114)
* Fix issue on Windows with the language server not shutting down properly which causes the IntelliSense database to become corrupted. [PR #6141](https://github.com/microsoft/vscode-cpptools/issues/6141)
* Fix "No IL available" IntelliSense error when predefined macros are undefined. [#6147](https://github.com/microsoft/vscode-cpptools/issues/6147)
* Fix infinite loop IntelliSense regression. [#6166](https://github.com/microsoft/vscode-cpptools/issues/6166)

## Version 1.0.0: September 14, 2020
### New Features
* Support non-UTF-8 file encodings (GBK, UTF-16, etc.), excluding `files.autoGuessEncoding` support. [#414](https://github.com/microsoft/vscode-cpptools/issues/414)
* Support for running the extension on Linux ARM devices (armhf/armv7l and aarch64/arm64), using remoting. [#429](https://github.com/microsoft/vscode-cpptools/issues/429), [#2506](https://github.com/microsoft/vscode-cpptools/issues/2506)
* Add the `vcFormat` option to `C_Cpp.formatting` (with `C_Cpp.vcFormat.*` options) to enable VS-style formatting (instead of clang-format formatting). [#657](https://github.com/microsoft/vscode-cpptools/issues/657)
  * Add support for vcFormat settings in `.editorconfig` files. [PR #5932](https://github.com/microsoft/vscode-cpptools/pull/5932)

### Enhancements
* Improve the download and installation progress bar. [#1961](https://github.com/microsoft/vscode-cpptools/issues/1961)
* Add error codes and the "C/C++" source to IntelliSense errors. [#2345](https://github.com/microsoft/vscode-cpptools/issues/2345)
* Add support for `/Zc:__cplusplus` in `compilerArgs` for cl.exe. [#2595](https://github.com/microsoft/vscode-cpptools/issues/2595)
* Search for `compilerPath` in the PATH environment variable. [#3078](https://github.com/microsoft/vscode-cpptools/issues/3078), [#5908](https://github.com/microsoft/vscode-cpptools/issues/5908)
* Validate crypto signatures of binaries we download. [#5268](https://github.com/microsoft/vscode-cpptools/issues/5268)
* Add link to the documentation in the configuration UI. [#5875](https://github.com/microsoft/vscode-cpptools/issues/5875)
  * Abhishek Pal (@devabhishekpal) [PR #5991](https://github.com/microsoft/vscode-cpptools/pull/5991)
* Allow comments, trailing commas, etc. in `c_cpp_properties.json` [#5885](https://github.com/microsoft/vscode-cpptools/issues/5885)
* Prevent comments from being removed from json files when the extension modifies them.
  * @dan-shaw [PR #5954](https://github.com/microsoft/vscode-cpptools/pull/5954)
* Add diagnostics on potentially conflicting recursive includes to `C/C++: Log Diagnostics`, i.e. if a workspace uses files with the same name as system headers. [#6009](https://github.com/microsoft/vscode-cpptools/issues/6009)
* Add workspace parsing diagnostics. [#6048](https://github.com/microsoft/vscode-cpptools/issues/6048)
* Add `wmain` snippet on Windows. [#6064](https://github.com/microsoft/vscode-cpptools/issues/6064)
* More C++20 support.

### Bug Fixes
* Fix member completion in C code after an operator is used in an expression. [#2184](https://github.com/microsoft/vscode-cpptools/issues/2184)
* Fix extension not creating `tasks.json` if the `.vscode` folder doesn’t exist. [#4280](https://github.com/microsoft/vscode-cpptools/issues/4280)
* Fix installation of clang-format 10 with the online vsix. [#5194](https://github.com/microsoft/vscode-cpptools/issues/5194)
* Get the compiler type to determine if it's Clang when querying for default compiler so that the correct default `intelliSenseMode` is set. [#5352](https://github.com/microsoft/vscode-cpptools/issues/5352)
* Get the default language standard of the compiler and use that std version if no version is specified. [#5579](https://github.com/microsoft/vscode-cpptools/issues/5579)
* Fix `configuration.includePath` to only add the `defaultFolder` when the default `includePath` is set. [#5621](https://github.com/microsoft/vscode-cpptools/issues/5621)
* Fix an IntelliSense crash when using C++20 on Linux. [#5727](https://github.com/microsoft/vscode-cpptools/issues/5727)
* Get the default target of the compiler. If the default target is ARM/ARM64, do not use the generic "--target" option to determine bitness. [#5772](https://github.com/microsoft/vscode-cpptools/issues/5772)
* Fix `compilerArgs` not being used if no `compilerPath` is set. [#5776](https://github.com/microsoft/vscode-cpptools/issues/5776)
* Fix an incorrect IntelliSense error squiggle. [#5783](https://github.com/microsoft/vscode-cpptools/issues/5783)
* Fix semantic colorization and inactive regions for multi-root workspaces. [#5812](https://github.com/microsoft/vscode-cpptools/issues/5812), [#5828](https://github.com/microsoft/vscode-cpptools/issues/5828)
* Fix bug with cl.exe flags /FU and /FI not being processed. [#5819](https://github.com/microsoft/vscode-cpptools/issues/5819)
* Fix `cStandard` being set to `c11` instead of `gnu18` with gcc. [#5834](https://github.com/microsoft/vscode-cpptools/issues/5834)
* Fix Doxygen parameterHint comment to display for a parameter name that is followed by colon. [#5836](https://github.com/microsoft/vscode-cpptools/issues/5836)
* Fix compiler querying when relative paths are used in `compile_commands.json`. [#5848](https://github.com/microsoft/vscode-cpptools/issues/5848)
* Fix the compile commands compiler not being used if `C_Cpp.default.compilerPath` is set. [#5848](https://github.com/microsoft/vscode-cpptools/issues/5848)
* Fix Doxygen comment to escape markdown characters. [#5904](https://github.com/microsoft/vscode-cpptools/issues/5904)
* Remove keyword completion of C identifiers that are defined in headers and aren't keywords (e.g. `alignas`). [#6022](https://github.com/microsoft/vscode-cpptools/issues/6022)
* Fix error message with `Build and Debug Active File`. [#6071](https://github.com/microsoft/vscode-cpptools/issues/6071)
* Restore fallback to the base configuration if a custom configuration provider does not provide a configuration for a file and does not provide compiler info in a custom browse configuration.
* Fix a bug that could cause the extension to delay processing a newly opened file until any outstanding IntelliSense operations are complete, if using a custom configuration provider.
* Fix a bug with incorrect configuration of a file when using a custom configuration provider and no custom configuration is available for that file. This now falls back to the compiler info received from the configuration provider with the browse configuration.
* Fix a bug in which making a modification to `c_cpp_properties.json` could result in custom configurations for currently open files being discarded and not re-requested.

### Potentially Breaking Changes
* Settings `commentContinuationPatterns`, `enhancedColorization`, and `codeFolding` are no longer available in per-Folder settings (only Workspace or higher settings). [PR #5830](https://github.com/microsoft/vscode-cpptools/pull/5830)
* Fix compile command arguments not being used when `compilerPath` is set (so the compile command arguments need to be compatible now).
* If a non-matching `intelliSenseMode` was being used, such as clang-x64 with a gcc ARM compiler, then we may auto-fix it internally, which may cause changes to IntelliSense behavior.

### Known Issues
* Using `clang-format` on ARM may require installing libtinfo5. [#5958](https://github.com/microsoft/vscode-cpptools/issues/5958)
