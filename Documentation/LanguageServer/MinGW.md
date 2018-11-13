# MinGW

To use MinGW on Windows, we recommend you add the following configuration to your **c_cpp_properties.json** file.  Select "C/Cpp: Edit Configurations" from the command palette to create this file if you haven't already.

## Extension version 0.17.0 and higher:

When you set the `compilerPath` property and change `intelliSenseMode` to `clang-x64` (or `gcc-x64` in version 0.18.0 and higher), you no longer need to copy the system include path or defines to `includePath`, `browse.path`, or `defines` to enable IntelliSense to work properly. For example:

```json
{
    "name": "MinGW",
    "intelliSenseMode": "gcc-x64",
    "compilerPath": "C:/mingw64/bin/gcc.exe",
    "includePath": [
        "${workspaceFolder}"
    ],
    "defines": [],
    "cStandard": "c11",
    "cppStandard": "c++17"
}
```

For Cygwin, the `compilerPath` should be set to something like "C:/cygwin64/bin/g++.exe".

## Extension version 0.16.1 and earlier:

If you have an older version of the C/C++ extension installed, use [these instructions](Archive/MinGW.md) instead.
