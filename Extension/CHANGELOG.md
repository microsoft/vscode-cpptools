# C/C++ for Visual Studio Code Change Log

## Version 0.17.5: June 21, 2018
* Detect `compile_commands.json` and show prompt to use it. [#1297](https://github.com/Microsoft/vscode-cpptools/issues/1297)
* Change inactive regions from gray to translucent. [#1907](https://github.com/Microsoft/vscode-cpptools/issues/1907)
* Improve performance of recursive includes paths. [#2068](https://github.com/Microsoft/vscode-cpptools/issues/2068)
* Fix IntelliSense client failure due to `No args provider`. [#1908](https://github.com/Microsoft/vscode-cpptools/issues/1908)
* Fix `#include` completion with headers in the same directory. [#2031](https://github.com/Microsoft/vscode-cpptools/issues/2031)
* Fix non-header files outside the workspace folder not being parsed (i.e. so `Go to Definition` works). [#2053](https://github.com/Microsoft/vscode-cpptools/issues/2053)
* Fix some crashes. [#2080](https://github.com/Microsoft/vscode-cpptools/issues/2080)
* Support asm clobber registers on Windows. [#2090](https://github.com/Microsoft/vscode-cpptools/issues/2090)
* Fix usage of `${config:section.setting}`. [#2165](https://github.com/Microsoft/vscode-cpptools/issues/2165)
* `browse.path` now inherits `includePath` if not set in `c_cpp_properties.json`.
* On Windows, `compilerPath` now populates with the guessed `cl.exe` path, and the `MSVC` include path is based on the `cl.exe` path.
* Fix files under a non-recursive `browse.path` being removed from the database.
* Fix `*` not working in `browse.path` with WSL.
* Fix for -break-insert main returning multiple bind points. [#729](https://github.com/Microsoft/MIEngine/pull/729)
* Use -- instead of -x for gnome-terminal. [#733](https://github.com/Microsoft/MIEngine/pull/733)
* Added `miDebuggerArgs` in order to pass arguments to the program in `miDebuggerPath`. [#720](https://github.com/Microsoft/MIEngine/pull/720)

## Version 0.17.4: May 31, 2018
* Fix infinite loop (caused by deadlock) when using recursive includes. [#2043](https://github.com/Microsoft/vscode-cpptools/issues/2043)
* Stop using recursive includes in the default configuration.
  * @Hyzeta [PR #2059](https://github.com/Microsoft/vscode-cpptools/pull/2059)
* Fix various other potential deadlocks and crashes.
* Fix `Go to Definition` on `#include` not filtering out results based on the path. [#1253](https://github.com/Microsoft/vscode-cpptools/issues/1253), [#2033](https://github.com/Microsoft/vscode-cpptools/issues/2033)
* Fix database icon getting stuck. [#1917](https://github.com/Microsoft/vscode-cpptools/issues/1917)

## Version 0.17.3: May 22, 2018
* Add support for `${workspaceFolder:folderName}`. [#1774](https://github.com/Microsoft/vscode-cpptools/issues/1774)
* Fix infinite loop during initialization on Windows. [#1960](https://github.com/Microsoft/vscode-cpptools/issues/1960)
* Fix main process IntelliSense-related crashes. [#2006](https://github.com/Microsoft/vscode-cpptools/issues/2006)
* Fix deadlock after formatting large files. [#2007](https://github.com/Microsoft/vscode-cpptools/issues/2007)
* Fix recursive includes failing to find some system includes. [#2019](https://github.com/Microsoft/vscode-cpptools/issues/2019)

## Version 0.17.1: May 17, 2018
* Fix IntelliSense update slowness when using recursive includes. [#1949](https://github.com/Microsoft/vscode-cpptools/issues/1949)
* Fix code navigation failure after switching between WSL and non-WSL configs. [#1958](https://github.com/Microsoft/vscode-cpptools/issues/1958)
* Fix extension crash when the `includePath` is a file or the root drive. [#1979](https://github.com/Microsoft/vscode-cpptools/issues/1979), [#1965](https://github.com/Microsoft/vscode-cpptools/issues/1965)
* Fix IntelliSense crash in `have_member_access_from_class_scope`. [#1763](https://github.com/Microsoft/vscode-cpptools/issues/1763)
* Fix `#include` completion bugs. [#1959](https://github.com/Microsoft/vscode-cpptools/issues/1959), [#1970](https://github.com/Microsoft/vscode-cpptools/issues/1970)
* Add `Debug` value for `loggingLevel` (previously the hidden value `"6"`).
* Fix C++17 features not being fully enabled with msvc-x64 mode. [#1990](https://github.com/Microsoft/vscode-cpptools/issues/1990)
* Fix IntelliSense interprocess deadlocks. [#1407](https://github.com/Microsoft/vscode-cpptools/issues/1407), [#1777](https://github.com/Microsoft/vscode-cpptools/issues/1777)

## Version 0.17.0: May 7, 2018
* Auto-complete for headers after typing `#include`. [#802](https://github.com/Microsoft/vscode-cpptools/issues/802)
* Add support for recursive `includePath`, e.g. `${workspaceFolder}/**`. [#897](https://github.com/Microsoft/vscode-cpptools/issues/897)
* Configuration improvements. [#1338](https://github.com/Microsoft/vscode-cpptools/issues/1338)
  * Potentially addresses: [#368](https://github.com/Microsoft/vscode-cpptools/issues/368), [#410](https://github.com/Microsoft/vscode-cpptools/issues/410), [#1229](https://github.com/Microsoft/vscode-cpptools/issues/1229), [#1270](https://github.com/Microsoft/vscode-cpptools/issues/1270), [#1404](https://github.com/Microsoft/vscode-cpptools/issues/1404)
* Add support for querying system includes/defines from WSL and Cygwin compilers. [#1845](https://github.com/Microsoft/vscode-cpptools/issues/1845), [#1736](https://github.com/Microsoft/vscode-cpptools/issues/1736)
* Fix IntelliSense for WSL projects in Windows builds 17110 and greater. [#1694](https://github.com/Microsoft/vscode-cpptools/issues/1694)
* Add snippets. [PR #1823](https://github.com/Microsoft/vscode-cpptools/pull/1823)
* Add support for vcpkg. [PR #1886](https://github.com/Microsoft/vscode-cpptools/pull/1886)
* Add support for custom variables in `c_cpp_properties.json` via `env`. [#1857](https://github.com/Microsoft/vscode-cpptools/issues/1857), [#368](https://github.com/Microsoft/vscode-cpptools/issues/368)
* Stop automatically adding `/usr/include` to the `includePath`. [#1819](https://github.com/Microsoft/vscode-cpptools/issues/1819)
* Fix wrong configuration being used if there are four or more. [#1599](https://github.com/Microsoft/vscode-cpptools/issues/1599)
* Fix `c_cpp_properties.json` requiring write access. [#1790](https://github.com/Microsoft/vscode-cpptools/issues/1790)
* Change file not found in `compile_commands.json` message from an error to a warning. [#1783](https://github.com/Microsoft/vscode-cpptools/issues/1783)
* Fix an IntelliSense crash during completion requests. [#1782](https://github.com/Microsoft/vscode-cpptools/issues/1782)
* Update the installed clang-format to 6.0.
* Fix bug with `compile_commands.json` when "arguments" have both a switch and a value in the arg. [#1890](https://github.com/Microsoft/vscode-cpptools/issues/1890)
* Fix bug with garbage data appearing in tooltips on Linux/Mac. [#1577](https://github.com/Microsoft/vscode-cpptools/issues/1577)

## Version 0.16.1: March 30, 2018
* Fix random deadlock caused by logging code on Linux/Mac. [#1759](https://github.com/Microsoft/vscode-cpptools/issues/1759)
* Fix compiler from `compileCommands` not being queried for includes/defines if `compilerPath` isn't set on Windows. [#1754](https://github.com/Microsoft/vscode-cpptools/issues/1754)
* Fix OSX `UseShellExecute` I/O bug. [#1756](https://github.com/Microsoft/vscode-cpptools/issues/1756)
* Invalidate partially unzipped files from package manager. [#1757](https://github.com/Microsoft/vscode-cpptools/issues/1757)

## Version 0.16.0: March 28, 2018
* Enable autocomplete for local and global scopes. [#13](https://github.com/Microsoft/vscode-cpptools/issues/13)
* Add a setting to define multiline comment patterns: `C_Cpp.commentContinuationPatterns`. [#1100](https://github.com/Microsoft/vscode-cpptools/issues/1100), [#1539](https://github.com/Microsoft/vscode-cpptools/issues/1539)
* Add a setting to disable inactive region highlighting: `C_Cpp.dimInactiveRegions`. [#1592](https://github.com/Microsoft/vscode-cpptools/issues/1592)
* Add `forcedInclude` configuration setting. [#852](https://github.com/Microsoft/vscode-cpptools/issues/852)
* Add `compilerPath`, `cStandard`, and `cppStandard` configuration settings, and query gcc/clang-based compilers for default defines. [#1293](https://github.com/Microsoft/vscode-cpptools/issues/1293), [#1251](https://github.com/Microsoft/vscode-cpptools/issues/1251), [#1448](https://github.com/Microsoft/vscode-cpptools/issues/1448), [#1465](https://github.com/Microsoft/vscode-cpptools/issues/1465), [#1484](https://github.com/Microsoft/vscode-cpptools/issues/1484)
* Fix text being temporarily gray when an inactive region is deleted. [Microsoft/vscode#44872](https://github.com/Microsoft/vscode/issues/44872)
* Add support for `${workspaceFolder}` variable in **c_cpp_properties.json**. [#1392](https://github.com/Microsoft/vscode-cpptools/issues/1392)
* Fix IntelliSense not updating in source files after dependent header files are changed. [#1501](https://github.com/Microsoft/vscode-cpptools/issues/1501)
* Change database icon to use the `statusBar.foreground` color. [#1638](https://github.com/Microsoft/vscode-cpptools/issues/1638)
* Enable C++/CLI IntelliSense mode via adding the `/clr` arg to the `compilerPath`. [#1596](https://github.com/Microsoft/vscode-cpptools/issues/1596)
* Fix delay in language service activation caused by **cpptools.json** downloading. [#1640](https://github.com/Microsoft/vscode-cpptools/issues/1640)
* Fix debugger failure when a single quote is in the path. [#1554](https://github.com/Microsoft/vscode-cpptools/issues/1554)
* Fix terminal stdout and stderr redirection to not send to VS Code. [#1348](https://github.com/Microsoft/vscode-cpptools/issues/1348)
* Fix blank config and endless "Initializing..." if the file watcher limit is hit when using `compileCommands`. [PR #1709](https://github.com/Microsoft/vscode-cpptools/pull/1709)
* Fix error squiggles re-appearing after editing then closing a file. [#1712](https://github.com/Microsoft/vscode-cpptools/issues/1712)
* Show error output from clang-format. [#1259](https://github.com/Microsoft/vscode-cpptools/issues/1259)
* Fix `add_expression_to_index` crash (most frequent crash in 0.15.0). [#1396](https://github.com/Microsoft/vscode-cpptools/issues/1396)
* Fix incorrect error squiggle `explicitly instantiated more than once`. [#871](https://github.com/Microsoft/vscode-cpptools/issues/871)

## Version 0.15.0: February 15, 2018
* Add colorization for inactive regions. [#1466](https://github.com/Microsoft/vscode-cpptools/issues/1466)
* Fix 3 highest hitting crashes. [#1137](https://github.com/Microsoft/vscode-cpptools/issues/1137), [#1337](https://github.com/Microsoft/vscode-cpptools/issues/1337), [#1497](https://github.com/Microsoft/vscode-cpptools/issues/1497)
* Update IntelliSense compiler (bug fixes and more C++17 support). [#1067](https://github.com/Microsoft/vscode-cpptools/issues/1067), [#1313](https://github.com/Microsoft/vscode-cpptools/issues/1313)
* Fix duplicate `cannot open source file` errors. [#1469](https://github.com/Microsoft/vscode-cpptools/issues/1469)
* Fix `Go to Symbol in File...` being slow for large workspaces. [#1472](https://github.com/Microsoft/vscode-cpptools/issues/1472)
* Fix stuck processes during shutdown. [#1474](https://github.com/Microsoft/vscode-cpptools/issues/1474)
* Fix error popup appearing with non-workspace files when using `compile_commands.json`. [#1475](https://github.com/Microsoft/vscode-cpptools/issues/1475)
* Fix snippet completions being blocked after `#`. [#1531](https://github.com/Microsoft/vscode-cpptools/issues/1531)
* Add more macros to `cpp.hint` (fixing missing symbols).
* Add `__CHAR_BIT__=8` to default defines on Mac. [#1510](https://github.com/Microsoft/vscode-cpptools/issues/1510)
* Added support for config variables to `c_cpp_properties.json`. [#314](https://github.com/Microsoft/vscode-cpptools/issues/314)
  * Joshua Cannon (@thejcannon) [PR #1529](https://github.com/Microsoft/vscode-cpptools/pull/1529)
* Define `_UNICODE` by default on Windows platforms. [#1538](https://github.com/Microsoft/vscode-cpptools/issues/1538)
  * Charles Milette (@sylveon) [PR #1540](https://github.com/Microsoft/vscode-cpptools/pull/1540)

## Version 0.14.6: January 17, 2018
* Fix tag parser failing (and continuing to fail after edits) when it shouldn't. [#1367](https://github.com/Microsoft/vscode-cpptools/issues/1367)
* Fix tag parser taking too long due to redundant processing. [#1288](https://github.com/Microsoft/vscode-cpptools/issues/1288)
* Fix debugging silently failing the 1st time if a C/C++ file isn't opened. [#1366](https://github.com/Microsoft/vscode-cpptools/issues/1366)
* Skip automatically adding to `files.associations` if it matches an existing glob pattern or if `C_Cpp.autoAddFileAssociations` is `false`. [#722](https://github.com/Microsoft/vscode-cpptools/issues/722)
* The debugger no longer requires an extra reload. [#1362](https://github.com/Microsoft/vscode-cpptools/issues/1362)
* Fix incorrect "Warning: Expected file ... is missing" message after installing on Linux. [#1334](https://github.com/Microsoft/vscode-cpptools/issues/1334)
* Fix "Include file not found" messages not re-appearing after settings changes. [#1363](https://github.com/Microsoft/vscode-cpptools/issues/1363)
* Performance improvements with `browse.path` parsing, and stop showing "Parsing files" when there's no actual parsing. [#1393](https://github.com/Microsoft/vscode-cpptools/issues/1393)
* Fix crash when settings with the wrong type are used. [#1396](https://github.com/Microsoft/vscode-cpptools/issues/1396)
* Allow semicolons in `browse.path`. [#1415](https://github.com/Microsoft/vscode-cpptools/issues/1415)
* Fix to handle relative pathing in source file paths properly when normalizing. [#1228](https://github.com/Microsoft/vscode-cpptools/issues/1228)
* Fix delay in language service activation caused by cpptools.json downloading. [#1429](https://github.com/Microsoft/vscode-cpptools/issues/1429)
* Add `C_Cpp.workspaceParsingPriority` setting to enable using less than 100% CPU during parsing of workspace files.
* Add `C_Cpp.exclusionPolicy` default to `checkFolders` to avoid expensive `files.exclude` checking on every file.

## Version 0.14.5: December 18, 2017
* Fix for stackwalk `NullReferenceException`. [#1339](https://github.com/Microsoft/vscode-cpptools/issues/1339)
* Fix for `-isystem` (or `-I`) not being used in `compile_commands.json` if there's a space after it. [#1343](https://github.com/Microsoft/vscode-cpptools/issues/1343)
* Fix for header switching from `.cc` to `.hpp` files (and other cases). [#1341](https://github.com/Microsoft/vscode-cpptools/issues/1341)
* Fix reload prompts not appearing in debugging scenarios (after the initial installation). [#1344](https://github.com/Microsoft/vscode-cpptools/issues/1344)
* Add a "wait" message when commands are invoked during download/installation. [#1344](https://github.com/Microsoft/vscode-cpptools/issues/1344)
* Prevent blank "C/C++ Configuration" from appearing when debugging is started but the language service is not. [#1353](https://github.com/Microsoft/vscode-cpptools/issues/1353)

## Version 0.14.4: December 11, 2017
* Enable the language service processes to run without glibc 2.18. [#19](https://github.com/Microsoft/vscode-cpptools/issues/19)
* Enable the language service processes to run on 32-bit Linux. [#424](https://github.com/Microsoft/vscode-cpptools/issues/424)
* Fix extension process not working on Windows with non-ASCII usernames. [#1319](https://github.com/Microsoft/vscode-cpptools/issues/1319)
* Fix IntelliSense on single processor VMs. [#1321](https://github.com/Microsoft/vscode-cpptools/issues/1321)
* Enable offline installation of the extension. [#298](https://github.com/Microsoft/vscode-cpptools/issues/298)
* Add support for `-isystem` in `compile_commands.json`. [#1156](https://github.com/Microsoft/vscode-cpptools/issues/1156)
* Remember the selected configuration across launches of VS Code. [#1273](https://github.com/Microsoft/vscode-cpptools/issues/1273)
* Fix 'Add Configuration...` entries not appearing if the extension wasn't previously activated. [#1287](https://github.com/Microsoft/vscode-cpptools/issues/1287)
* Add `(declaration)` to declarations in the navigation list. [#1311](https://github.com/Microsoft/vscode-cpptools/issues/1311)
* Fix function definition body not being visible after navigation. [#1311](https://github.com/Microsoft/vscode-cpptools/issues/1311)
* Improve performance for fetching call stacks with large arguments. [#363](https://github.com/Microsoft/vscode-cpptools/issues/363)

## Version 0.14.3: November 27, 2017
* Fix for disappearing parameter hints tooltip. [#1165](https://github.com/Microsoft/vscode-cpptools/issues/1165)
* Fix for parameter hints only showing up after the opening parenthesis. [#902](https://github.com/Microsoft/vscode-cpptools/issues/902), [#819](https://github.com/Microsoft/vscode-cpptools/issues/819)
* Fix for customer reported crashes in the TypeScript extension code. [#1240](https://github.com/Microsoft/vscode-cpptools/issues/1240), [#1245](https://github.com/Microsoft/vscode-cpptools/issues/1245)
* Fix .browse.VC-#.db files being unnecessarily created when an shm file exists. [#1234](https://github.com/Microsoft/vscode-cpptools/issues/1234)
* Fix language service to only activate after a C/C++ file is opened or a C/Cpp command is used (not onDebug).
* Fix database resetting if shutdown got blocked by an IntelliSense operation. [#1260](https://github.com/Microsoft/vscode-cpptools/issues/1260)
* Fix deadlock that can occur when switching configurations.
* Fix browse.databaseFilename changing not taking effect until a reload.

## Version 0.14.2: November 9, 2017
* Unsupported Linux clients sending excessive telemetry when the language server fails to start. [#1227](https://github.com/Microsoft/vscode-cpptools/issues/1227)

## Version 0.14.1: November 9, 2017
* Add support for multi-root workspaces. [#1070](https://github.com/Microsoft/vscode-cpptools/issues/1070)
* Fix files temporarily being unsavable after Save As and other scenarios on Windows. [Microsoft/vscode#27329](https://github.com/Microsoft/vscode/issues/27329)
* Fix files "permanently" being unsavable if the IntelliSense process launches during tag parsing of the file. [#1040](https://github.com/Microsoft/vscode-cpptools/issues/1040)
* Show pause and resume parsing commands after clicking the database icon. [#1141](https://github.com/Microsoft/vscode-cpptools/issues/1141)
* Don't show the install output unless an error occurs. [#1160](https://github.com/Microsoft/vscode-cpptools/issues/1160)
* Fix bug with `${workspaceRoot}` symbols not getting added if a parent folder is in the `browse.path`. [#1185](https://github.com/Microsoft/vscode-cpptools/issues/1185)
* Fix `Add configuration` C++ launch.json on Insiders. [#1191](https://github.com/Microsoft/vscode-cpptools/issues/1191)
* Fix extension restart logic so that the extension doesn't get stuck on "Initializing..." when it crashes. [#893](https://github.com/Microsoft/vscode-cpptools/issues/893)
* Remove the Reload window prompt after installation (it only appears if launch.json is active).
* Prevent browse database from being reset if shutdown takes > 1 second.
* Remove the `UnloadLanguageServer` command and the `clang_format_formatOnSave` setting.
* Fix bugs with include path suggestions.
* Fix max files to parse status number being too big, due to including non-`${workspaceRoot}` files.
* Update default `launch.json` configurations to use `${workspaceFolder}` instead of `${workspaceRoot}`.
* Update how default initial configurations for `launch.json` are being provided. [Microsoft/vscode#33794](https://github.com/Microsoft/vscode/issues/33794)
* Add support for normalizing source file locations. (Windows [#272](https://github.com/Microsoft/vscode-cpptools/issues/272)), (Mac OS X [#1095](https://github.com/Microsoft/vscode-cpptools/issues/1095))

## Version 0.14.0: October 19, 2017
* Add support for `compile_commands.json`. [#156](https://github.com/Microsoft/vscode-cpptools/issues/156)
* Fix crash with signature help. [#1076](https://github.com/Microsoft/vscode-cpptools/issues/1076)
* Skip parsing redundant browse.path directories. [#1106](https://github.com/Microsoft/vscode-cpptools/issues/1106)
* Fix `limitSymbolsToIncludedHeaders` not working with single files. [#1109](https://github.com/Microsoft/vscode-cpptools/issues/1109)
* Add logging to Output window. Errors will be logged by default. Verbosity is controlled by the `"C_Cpp.loggingLevel"` setting.
* Add new database status bar icon for "Indexing" or "Parsing" with progress numbers, and the previous flame icon is now just for "Updating IntelliSense".
* Stop showing `(Global Scope)` if there's actually an error in identifying the correct scope.
* Fix crash with the IntelliSense process when parsing certain template code (the most frequently hit crash).
* Fix main thread being blocked while searching for files to remove after changing `files.exclude`.
* Fix incorrect code action include path suggestion when a folder comes after "..".
* Fix a crash on shutdown.

## Version 0.13.1: October 5, 2017
* Delete unused symbol databases when `browse.databaseFilename` in `c_cpp_properties.json` changes. [#558](https://github.com/Microsoft/vscode-cpptools/issues/558)
* Fix infinite loop during IntelliSense parsing. [#981](https://github.com/Microsoft/vscode-cpptools/issues/981)
* Fix database resetting due to the extension process not shutting down fast enough. [#1060](https://github.com/Microsoft/vscode-cpptools/issues/1060)
* Fix crash with document highlighting [#1076](https://github.com/Microsoft/vscode-cpptools/issues/1076)
* Fix bug that could cause symbols to be missing when shutdown occurs during tag parsing.
* Fix bug that could cause included files to not be reparsed if they were modified after the initial parsing.
* Fix potential buffer overrun when logging is enabled.
* Add logging to help diagnose cause of document corruption after formatting.

## Version 0.13.0: September 25, 2017
* Reference highlighting is now provided by the extension for both IntelliSense engines.
* Parameter help is now provided by both IntelliSense engines.
* Light bulbs (code actions) for #include errors now suggest potential paths to add to the `includePath` based on a recursive search of the `browse.path`. [#846](https://github.com/Microsoft/vscode-cpptools/issues/846)
* Browse database now removes old symbols when `browse.path` changes. [#262](https://github.com/Microsoft/vscode-cpptools/issues/262)
* Add `*` on new lines after a multiline comment with `/**` is started. [#579](https://github.com/Microsoft/vscode-cpptools/issues/579)
* Fix `Go to Definition`, completion, and parameter hints for partially scoped members. [#635](https://github.com/Microsoft/vscode-cpptools/issues/635)
* Fix bug in `macFrameworkPath` not resolving variables.

## Version 0.12.4: September 12, 2017
* Fix a crash in IntelliSense for users with non-ASCII user names (Windows-only). [#910](https://github.com/Microsoft/vscode-cpptools/issues/910)
* Add `macFrameworkPath` to `c_cpp_properties.json`. [#970](https://github.com/Microsoft/vscode-cpptools/issues/970)
* Fix incorrect auto-complete suggestions when using template types with the scope operator `::`. [#988](https://github.com/Microsoft/vscode-cpptools/issues/988)
* Fix potential config file parsing failure. [#989](https://github.com/Microsoft/vscode-cpptools/issues/989)
* Support `${env:VAR}` syntax for environment variables in `c_cpp_properties.json`. [#1000](https://github.com/Microsoft/vscode-cpptools/issues/1000)
* Support semicolon delimiters for include paths in `c_cpp_properties.json` to better support environment variables. [#1001](https://github.com/Microsoft/vscode-cpptools/issues/1001)
* Add `__LITTLE_ENDIAN__=1` to default defines so that "endian.h" is not needed on Mac projects. [#1005](https://github.com/Microsoft/vscode-cpptools/issues/1005)
* Fix for source code files on Windows with incorrect casing. [#984](https://github.com/Microsoft/vscode-cpptools/issues/984)

## Version 0.12.3: August 17, 2017
* Fix regression for paths containing multibyte characters. [#958](https://github.com/Microsoft/vscode-cpptools/issues/958)
* Fix bug with the Tag Parser completion missing results. [#943](https://github.com/Microsoft/vscode-cpptools/issues/943)
* Add /usr/include/machine or i386 to the default Mac `includePath`. [#944](https://github.com/Microsoft/vscode-cpptools/issues/944)
* Add a command to reset the Tag Parser database. [#601](https://github.com/Microsoft/vscode-cpptools/issues/601), [#464](https://github.com/Microsoft/vscode-cpptools/issues/464)
* Fix bug with error-related code actions remaining after the errors are cleared.
* Fix bug with Tag Parser completion not working when :: preceded an identifier.
* Upgrade SQLite (for better reliability and performance).

## Version 0.12.2: August 2, 2017
* Fix bug in our build system causing Windows binaries to build against the wrong version of the Windows SDK. [#325](https://github.com/Microsoft/vscode-cpptools/issues/325)
* Added a gcc problemMatcher. [#854](https://github.com/Microsoft/vscode-cpptools/issues/854)
* Fix bug where .c/.cpp files could get added to `files.associations` as the opposite "cpp"/"c" language after `Go to Definition` on a symbol. [#884](https://github.com/Microsoft/vscode-cpptools/issues/884)
* Remove completion results after `#pragma`. [#886](https://github.com/Microsoft/vscode-cpptools/issues/886)
* Fix a possible infinite loop when viewing Boost sources. [#888](https://github.com/Microsoft/vscode-cpptools/issues/888)
* Fix `Go to Definition` not working for files in `#include_next`. [#906](https://github.com/Microsoft/vscode-cpptools/issues/906)
  * Also fix incorrect preprocessor suggestions at the end of a `#include_next`.
* Skip automatically adding to `files.associations` if they already match global patterns. [Microsoft/vscode#27404](https://github.com/Microsoft/vscode/issues/27404)
* Fix a crash with the IntelliSense process (responsible for ~25% of all crashes).

## Version 0.12.1: July 18, 2017
* Fix Tag Parser features not working with some MinGW library code.
* Fix a symbol search crash.
* Fix an IntelliSense engine compiler crash.
* Fix `Go to Declaration` to return `Go to Definition` results if the declarations have no results.
* Fix formatting with non-ASCII characters in the path. [#870](https://github.com/Microsoft/vscode-cpptools/issues/870)
* Fix handling of symbolic links to files on Linux/Mac. [#872](https://github.com/Microsoft/vscode-cpptools/issues/872)
* Move red flame icon to its own section so the configuration text is always readable. [#875](https://github.com/Microsoft/vscode-cpptools/issues/875)
* Remove `addWorkspaceRootToIncludePath` setting and instead make `${workspaceRoot}` in `browse.path` explicit.
* Add `Show Release Notes` command.
* Add `Edit Configurations...` command to the `Select a Configuration...` dropdown.
* Update Microsoft Visual C++ debugger to Visual Studio 2017 released components.
  * Fix issue with showing wrong thread. [#550](https://github.com/Microsoft/vscode-cpptools/issues/550)
  * Fix issue with binaries compiled with /FASTLINK causing debugger to hang. [#484](https://github.com/Microsoft/vscode-cpptools/issues/484)
* Fix issue in MinGW/Cygwin debugging where stop debugging causes VS Code to hang. [Microsoft/MIEngine#636](https://github.com/Microsoft/MIEngine/pull/636)

## Version 0.12.0: June 26, 2017
* The default IntelliSense engine now provides semantic-aware autocomplete suggestions for `.`, `->`, and `::` operators. [#13](https://github.com/Microsoft/vscode-cpptools/issues/13)
* The default IntelliSense engine now reports the unresolved include files in referenced headers and falls back to the Tag Parser until headers are resolved.
  * This behavior can be overridden by setting `"C_Cpp.intelliSenseEngineFallback": "Disabled"`
* Added `"intelliSenseMode"` property to `c_cpp_properties.json` to allow switching between MSVC and Clang modes. [#710](https://github.com/Microsoft/vscode-cpptools/issues/710), [#757](https://github.com/Microsoft/vscode-cpptools/issues/757)
* A crashed IntelliSense engine no longer gives the popup message, and it automatically restarts after an edit to the translation unit occurs.
* Fix the IntelliSense engine to use "c" mode if a C header is opened before the C file.
* Fix a bug which could cause the IntelliSense engine to not update results if changes are made to multiple files of a translation unit.
* Auto `files.association` registers "c" language headers when `Go to Definition` is used in a C file.
* Downloading extension dependencies will retry up to 5 times in the event of a failure. [#694](https://github.com/Microsoft/vscode-cpptools/issues/694)
* Changes to `c_cpp_properties.json` are detected even if file watchers fail.
* Update default IntelliSense options for MSVC mode to make Boost projects work better. [#775](https://github.com/Microsoft/vscode-cpptools/issues/775)
* Fix `Go to Definition` not working until all `browse.path` files are re-scanned. [#788](https://github.com/Microsoft/vscode-cpptools/issues/788)

## Version 0.11.4: June 2, 2017
* Fix for `System.Xml.Serialization.XmlSerializationReader threw an exception` when debugging on Linux. [#792](https://github.com/Microsoft/vscode-cpptools/issues/792)
* Fix for escaping for `${workspaceRoot}` in `launch.json`.

## Version 0.11.3: May 31, 2017
* Fix `x86_64-pc-linux-gnu` and `x86_64-linux-gnu` paths missing from the default `includePath`.

## Version 0.11.2: May 24, 2017
* Revert the default `C_Cpp.intelliSenseEngine` setting back to "Tag Parser" for non-Insiders while we work on improving the migration experience.

## Version 0.11.1: May 19, 2017
* Add keywords to auto-complete (C, C++, or preprocessor). [#120](https://github.com/Microsoft/vscode-cpptools/issues/120)
* Fix non-recursive `browse.path` on Linux/Mac. [#546](https://github.com/Microsoft/vscode-cpptools/issues/546)
* Fix .clang-format file not being used on Linux/Mac. [#604](https://github.com/Microsoft/vscode-cpptools/issues/604)
* Stop setting the c/cpp `editor.quickSuggestions` to false. [#606](https://github.com/Microsoft/vscode-cpptools/issues/606)
  * We also do a one-time clearing of that user setting, which will also copy any other c/cpp workspace settings to user settings. The workspace setting isn't cleared.
* Fix selection range off by one with `Peek Definition`. [#648](https://github.com/Microsoft/vscode-cpptools/issues/648)
* Upgrade the installed clang-format to 4.0 [#656](https://github.com/Microsoft/vscode-cpptools/issues/656)
* Make keyboard shortcuts only apply to c/cpp files. [#662](https://github.com/Microsoft/vscode-cpptools/issues/662)
* Fix autocomplete with qstring.h. [#666](https://github.com/Microsoft/vscode-cpptools/issues/666)
* Fix C files without a ".c" extension from being treated like C++ for `errorSquiggles`. [#673](https://github.com/Microsoft/vscode-cpptools/issues/673)
* Make the C IntelliSense engine use C11 instead of C89. [#685](https://github.com/Microsoft/vscode-cpptools/issues/685)
* Fix bug with clang-format not working with non-trimmed styles. [#691](https://github.com/Microsoft/vscode-cpptools/issues/691)
* Enable the C++ IntelliSense engine to use six C++17 features. [#699](https://github.com/Microsoft/vscode-cpptools/issues/699)
* Add reload prompt when a settings change requires it.
* Prevent non-existent files from being returned in `Go To Definition` results.

## Version 0.11.0: April 24, 2017
* Enabled first IntelliSense features based on the MSVC engine.
  * Quick info tooltips and compiler errors are provided by the MSVC engine.
  * `C_Cpp.intelliSenseEngine` property controls whether the new engine is used or not.
  * `C_Cpp.errorSquiggles` property controls whether compiler errors are made visible in the editor.
* Add `Go to Declaration` and `Peek Declaration`. [#271](https://github.com/Microsoft/vscode-cpptools/issues/271)
* Fix language-specific workspace settings leaking into user settings. [Microsoft/vscode#23118](https://github.com/Microsoft/vscode/issues/23118)
* Fix `files.exclude` not being used in some cases. [#485](https://github.com/Microsoft/vscode-cpptools/issues/485)
* Fix a couple potential references to an undefined `textEditor`. [#584](https://github.com/Microsoft/vscode-cpptools/issues/584)
* Move changes from `README.md` to `CHANGELOG.md`. [#586](https://github.com/Microsoft/vscode-cpptools/issues/586)
* Fix crash on Mac/Linux when building the browse database and `nftw` fails. [#591](https://github.com/Microsoft/vscode-cpptools/issues/591)
* Add `Alt+N` keyboard shortcut for navigation. [#593](https://github.com/Microsoft/vscode-cpptools/issues/593)
* Fix autocomplete crash when the result has an invalid UTF-8 character. [#608](https://github.com/Microsoft/vscode-cpptools/issues/608)
* Fix symbol search crash with `_` symbol. [#611](https://github.com/Microsoft/vscode-cpptools/issues/611)
* Fix the `Edit Configurations` command when '#' is in the workspace root path. [#625](https://github.com/Microsoft/vscode-cpptools/issues/625)
* Fix clang-format `TabWidth` not being set when formatting with the `Visual Studio` style. [#630](https://github.com/Microsoft/vscode-cpptools/issues/630)
* Enable `clang_format_fallbackStyle` to be a custom style. [#641](https://github.com/Microsoft/vscode-cpptools/issues/641)
* Fix potential `undefined` references when attaching to a process. [#650](https://github.com/Microsoft/vscode-cpptools/issues/650)
* Fix `files.exclude` not working on Mac. [#653](https://github.com/Microsoft/vscode-cpptools/issues/653)
* Fix crashes during edit and hover with unexpected UTF-8 data. [#654](https://github.com/Microsoft/vscode-cpptools/issues/654)

## Version 0.10.5: March 21, 2017
* Fix a crash that randomly occurred when the size of a document increased. [#430](https://github.com/Microsoft/vscode-cpptools/issues/430)
* Fix for browsing not working for Linux/Mac stdlib.h functions. [#578](https://github.com/Microsoft/vscode-cpptools/issues/578)
* Additional fixes for switch header/source not respecting `files.exclude`. [#485](https://github.com/Microsoft/vscode-cpptools/issues/485)
* Made `editor.quickSuggestions` dependent on `C_Cpp.autocomplete`. [#572](https://github.com/Microsoft/vscode-cpptools/issues/572)
  * We recommend you close and reopen your settings.json file anytime you change the `C_Cpp.autocomplete` setting. [More info here](https://github.com/Microsoft/vscode-cpptools/releases).

## Version 0.10.4: March 15, 2017
* Fix a crash in signature help. [#525](https://github.com/microsoft/vscode-cpptools/issues/525)
* Re-enable switch header/source when no workspace folder is open. [#541](https://github.com/microsoft/vscode-cpptools/issues/541)
* Fix inline `clang_format_style`. [#536](https://github.com/microsoft/vscode-cpptools/issues/536)
* Some other minor bug fixes.

## Version 0.10.3: March 7, 2017
* Database stability fixes.
* Added enums to the C_Cpp settings so the possible values are displayed in the dropdown.
* Change from `${command.*}` to `${command:*}`. [#521](https://github.com/Microsoft/vscode-cpptools/issues/521)
* Current execution row was not highlighting in debug mode when using gdb. [#526](https://github.com/microsoft/vscode-cpptools/issues/526)

## Version 0.10.2: March 1, 2017
* New `addWorkspaceRootToIncludePath` setting allows users to disable automatic parsing of all files under the workspace root. [#374](https://github.com/Microsoft/vscode-cpptools/issues/374)
* The cpp.hint file was missing from the vsix package. [#508](https://github.com/Microsoft/vscode-cpptools/issues/508)
* Switch header/source now respects `files.exclude`. [#485](https://github.com/Microsoft/vscode-cpptools/issues/485)
* Switch header/source performance improvements. [#231](https://github.com/Microsoft/vscode-cpptools/issues/231)
* Switch header/source now appears in the right-click menu.
* Improvements to signature help.
* Various other bug fixes.

## Version 0.10.1: February 9, 2017
* Bug fixes.

## Version 0.10.0: January 24, 2017
* Suppressed C++ language auto-completion inside a C++ comment or string literal. TextMate based completion is still available.
* Fixed bugs regarding the filtering of files and symbols, including:
  * Find-symbol now excludes symbols found in `files.exclude` or `search.exclude` files
  * Go-to-definition now excludes symbols found in `files.exclude` files (i.e. `search.exclude` paths are still included).
* Added option to disable `clang-format`-based formatting provided by this extension via `"C_Cpp.formatting" : "disabled"`
* Added new `pipeTransport` functionality within the `launch.json` to support pipe communications with `gdb/lldb` such as using `plink.exe` or `ssh`.
* Added support for `{command.pickRemoteProcess}` to allow picking of processes for remote pipe connections during `attach` scenarios. This is similar to how `{command.pickProcess}` works for local attach.
* Bug fixes.

## Version 0.9.3: December 8, 2016
* [December update](https://aka.ms/cppvscodedec) for C/C++ extension
* Ability to map source files during debugging using `sourceFileMap` property in `launch.json`.
* Enable pretty-printing by default for gdb users in `launch.json`.
* Bug fixes.

## Version 0.9.2: September 22, 2016
* Bug fixes.

## Version 0.9.1: September 7, 2016
* Bug fixes.

## Version 0.9.0: August 29, 2016
* [August update](https://blogs.msdn.microsoft.com/vcblog/2016/08/29/august-update-for-the-visual-studio-code-cc-extension/) for C/C++ extension.
* Debugging for Visual C++ applications on Windows (Program Database files) is now available.
* `clang-format` is now automatically installed as a part of the extension and formats code as you type.
* `clang-format` options have been moved from c_cpp_properties.json file to settings.json (File->Preferences->User settings).
* `clang-format` fallback style is now set to 'Visual Studio'.
* Attach now requires a request type of `attach` instead of `launch`.
* Support for additional console logging using the keyword `logging` inside `launch.json`.
* Bug fixes.

## Version 0.8.1: July 27, 2016
* Bug fixes.

## Version 0.8.0: July 21, 2016
* [July update](https://blogs.msdn.microsoft.com/vcblog/2016/07/26/july-update-for-the-visual-studio-code-cc-extension/) for C/C++ extension.
* Support for debugging on OS X with LLDB 3.8.0. LLDB is now the default debugging option on OS X.
* Attach to process displays a list of available processes.
* Set variable values through Visual Studio Code's locals window.
* Bug fixes.

## Version 0.7.1: June 27, 2016
* Bug fixes.

## Version 0.7.0: June 20, 2016
* [June Update](https://blogs.msdn.microsoft.com/vcblog/2016/06/01/may-update-for-the-cc-extension-in-visual-studio-code/) for C/C++ extension.
* Bug fixes.
* Switch between header and source.
* Control which files are processed under include path.

## Version 0.6.1: June 03, 2016
* Bug fixes.

## Version 0.6.0: May 24, 2016
* [May update](https://blogs.msdn.microsoft.com/vcblog/2016/07/26/july-update-for-the-visual-studio-code-cc-extension/) for C/C++ extension.
* Support for debugging on OS X with GDB.
* Support for debugging with GDB on MinGW.
* Support for debugging with GDB on Cygwin.
* Debugging on 32-bit Linux now enabled.
* Format code using clang-format.
* Experimental fuzzy auto-completion.
* Bug fixes.

## Version 0.5.0: April 14, 2016
* Usability and correctness bug fixes.
* Simplify installation experience.
* Usability and correctness bug fixes.
