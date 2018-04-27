For developers using MinGW on Windows, we recommend you start with the following **c_cpp_properties.json** template.  Select "C/Cpp: Edit Configurations" from the command palette to create this file if you haven't already.

## With extension version 0.16.1 and higher:

Starting with version 0.16.1, if you set the `compilerPath` property and change `intelliSenseMode` to `clang-x64`, you no longer need to copy the system include path or defines to `includePath` and `defines` to enable IntelliSense to work properly. However, `browse.path` still needs to be updated manually to add the system include paths to enable code browsing for system headers. For example:

```json
{
    "configurations": [
        {
            "name": "MinGW",
            "intelliSenseMode": "clang-x64",
            "compilerPath": "C:/MinGW/bin/gcc.exe",
            "includePath": [
                "${workspaceFolder}"
            ],
            "defines": [
                "_DEBUG"
            ],
            "browse": {
                "path": [
                    "C:/MinGW/lib/gcc/mingw32/6.3.0/include",
                    "C:/MinGW/lib/gcc/mingw32/6.3.0/include-fixed",
                    "C:/MinGW/include/*",
                    "${workspaceFolder}"
                ],
                "limitSymbolsToIncludedHeaders": true,
                "databaseFilename": ""
            },
            "cStandard": "c11",
            "cppStandard": "c++17"
        }
    ],
    "version": 3
}
```

Note that the `browse.path` setting is not automatically updated at this time and you may have to change the MinGW version number to match what you have installed. If you are using a different MinGW distribution, the values for `compilerPath` and `browse.path` will likely be different than what is written here.

## With extension version 0.16.0 and earlier:

In earlier versions of the extension, the `includePath` and a some system defines need to be set in order for IntelliSense to work properly. Note that you may have to change the MinGW version number to match what you have installed. Eg. `C:/MinGW/lib/gcc/mingw32/5.3.0/` instead of `C:/MinGW/lib/gcc/mingw32/6.3.0/`.

```json
{
    "configurations": [
        {
            "name": "MinGW",
            "intelliSenseMode": "clang-x64",
            "includePath": [
                "${workspaceRoot}",
                "C:/MinGW/lib/gcc/mingw32/6.3.0/include/c++",
                "C:/MinGW/lib/gcc/mingw32/6.3.0/include/c++/mingw32",
                "C:/MinGW/lib/gcc/mingw32/6.3.0/include/c++/backward",
                "C:/MinGW/lib/gcc/mingw32/6.3.0/include",
                "C:/MinGW/include",
                "C:/MinGW/lib/gcc/mingw32/6.3.0/include-fixed"
            ],
            "defines": [
                "_DEBUG",
                "__GNUC__=6",
                "__cdecl=__attribute__((__cdecl__))"
            ],
            "browse": {
                "path": [
                    "C:/MinGW/lib/gcc/mingw32/6.3.0/include",
                    "C:/MinGW/lib/gcc/mingw32/6.3.0/include-fixed",
                    "C:/MinGW/include/*",
                    "${workspaceRoot}"
                ],
                "limitSymbolsToIncludedHeaders": true,
                "databaseFilename": ""
            }
        }
    ]
}
```

The `includePath` above includes the system header paths that gcc uses in version 6.3.0 for C++ projects and matches the output of `"gcc -v -E -x c++ nul"`. The `intelliSenseMode` should be set to **"clang-x64"** to get MinGW projects to work properly with IntelliSense. The `__GNUC__=#` define should match the major version of the toolchain in your installation (6 in this example).

For C projects, simply remove the C++ lines:

```json
{
    "configurations": [
        {
            "name": "MinGW",
            "intelliSenseMode": "clang-x64",
            "includePath": [
                "${workspaceRoot}",
                "C:/MinGW/lib/gcc/mingw32/6.3.0/include",
                "C:/MinGW/include",
                "C:/MinGW/lib/gcc/mingw32/6.3.0/include-fixed"
            ],
            "defines": [
                "_DEBUG",
                "__GNUC__=6",
                "__cdecl=__attribute__((__cdecl__))"
            ],
            "browse": {
                "path": [
                    "C:/MinGW/lib/gcc/mingw32/6.3.0/include",
                    "C:/MinGW/lib/gcc/mingw32/6.3.0/include-fixed",
                    "C:/MinGW/include/*",
                    "${workspaceRoot}"
                ],
                "limitSymbolsToIncludedHeaders": true,
                "databaseFilename": ""
            }
        }
    ]
}
```
