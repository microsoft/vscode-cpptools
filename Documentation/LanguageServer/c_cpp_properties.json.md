# `c_cpp_properties.json` Reference Guide

### Example

```json
{
    "configurations": [
        {
            "name": "Win32",
            "intelliSenseMode": "msvc-x64",
            "includePath": [ "${workspaceFolder}" ],
            "macFrameworkPath": [ "/System/Library/Frameworks" ],
            "defines": [ "FOO", "BAR=100" ],
            "forcedInclude": [ "${workspaceFolder}/include/config.h" ],
            "compilerPath": "/usr/bin/clang",
            "cStandard": "c11",
            "cppStandard": "c++17",
            "compileCommands": "/path/to/compile_commands.json",
            "browse": {
                "path": [ "${workspaceFolder}" ],
                "limitSymbolsToIncludedHeaders": true,
                "databaseFilename": ""
            }
        }
    ],
    "version": 3
}
```

## Top-level properties

* #### `configurations`
  An array of configuration objects that provide the IntelliSense engine with information about your project and your preferences. By default, the extension creates 3 configurations for you, one each for Linux, Mac, and Windows, but it is not required to keep them all. You may also add additional configurations if necessary.

* #### `version`
  We recommend you don't edit this field. It tracks the current version of the **c_cpp_properties.json** file so that the extension knows what properties and settings should be present and how to upgrade this file to the latest version.

## Configuration properties

* #### `name`
  A friendly name for the configuration. "Linux", "Mac", and "Win32" are special names that instruct the extension to load that configuration by default on the associated operating system unless additional configurations have been created. The status bar in VS Code will show you which configuration is active. You can also click on the label in the status bar to change the active configuration.

* #### `intelliSenseMode`
  If `"C_Cpp.intelliSenseEngine"` is set to "Default" in your settings file, this property determines which mode the IntelliSense engine will run in. `"msvc-x64"` maps to Visual Studio mode with 64-bit pointer sizes. `"clang-x64"` maps to GCC/CLang mode with 64-bit pointer sizes. Windows uses `"msvc-x64"` by default and Linux/Mac use `"clang-x64"` by default.

* #### `includePath`
  If `"C_Cpp.intelliSenseEngine"` is set to "Default" in your settings file, this list of paths will be used by IntelliSense to search for headers included by your source files. This is basically the same as the list of paths you pass to your compiler with the `-I` switch; the IntelliSense engine will not do a recursive search in these paths for includes. If a GCC/CLang compiler is specified in the `compilerPath` setting, it is not necessary to list the system include paths in this list.

* #### `macFrameworkPath`
  If `"C_Cpp.intelliSenseEngine"` is set to "Default" in your settings file, this list of paths will be used by IntelliSense to search for framework headers included by your source files. This is basically the same as the list of paths you pass to your compiler with the `-F` switch; the IntelliSense engine will not do a recursive search in these paths for includes.

* #### `defines`
  If `"C_Cpp.intelliSenseEngine"` is set to "Default" in your settings file, this list of preprocessor symbols will be used by IntelliSense during the compilation of your source files. This is basically the same as the list of symbols you pass to your compiler with the `-D` switch.

* #### `forcedInclude` (optional)
  A list of files that should be included before any other characters in the source file are processed. Files are included in the order listed.

* #### `compilerPath` (optional)
  The absolute path to the compiler you use to build your project. The extension will query the compiler to determine the system include paths and default defines to use for IntelliSense. Args can be added to modify the includes/defines used, e.g. `-nostdinc++`, `-m32`, etc., but paths with spaces must be surrounded by double quotes (`"`) if args are used.

* #### `cStandard`
  The C standard revision to use for IntelliSense in your project.

* #### `cppStandard`
  The C++ standard revision to use for IntelliSense in your project.

* #### `compileCommands` (optional)
  If `"C_Cpp.intelliSenseEngine"` is set to "Default" in your settings file, the includes and defines discovered in this file will be used instead of the values set for `includePath` and `defines`. If the compile commands database does not contain an entry for the translation unit that corresponds to the file you opened in the editor, then a warning message will appear and the extension will use the `includePath` and `defines` settings instead.

  *For more information about the file format, see the [Clang documentation](https://clang.llvm.org/docs/JSONCompilationDatabase.html). Some build systems, such as CMake, [simplify generating this file](https://cmake.org/cmake/help/v3.5/variable/CMAKE_EXPORT_COMPILE_COMMANDS.html).*

* #### `browse`
  The set of properties used when `"C_Cpp.intelliSenseEngine"` is set to `"Tag Parser"` (also referred to as "fuzzy" IntelliSense, or the "browse" engine). These properties are also used by the Go To Definition/Declaration features, or when the "Default" IntelliSense engine is unable to resolve the #includes in your source files.

### Browse properties

* #### `path`
  This list of paths will be used by the Tag Parser to search for headers included by your source files. The Tag Parser will automatically search all subfolders in these paths unless the path ends with a `/*` or `\*`. For example, `/usr/include` directs the Tag Parser to search the `include` folder and its subfolders for headers while `/usr/include/*` directs the Tag Parser not to look in any subfolders of `/usr/include`.

* #### `limitSymbolsToIncludedHeaders`
  When true, the Tag Parser will only parse code files that have been directly or indirectly included by a source file in `${workspaceRoot}`. When false, the Tag Parser will parse all code files found in the paths specified in the **path** list.

* #### `databaseFilename`
  When set, this instructs the extension to save the Tag Parser's symbol database somewhere other than the workspace's default storage location. If a relative path is specified, it will be made relative to the workspace's default storage location, not the workspace folder itself. The `${workspaceRoot}` variable can be used to specify a path relative to the workspace folder (e.g. `${workspaceRoot}/.vscode/browse.vc.db`)
