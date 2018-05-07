# Windows Subsystem for Linux

> **Note:** If you are on **build 17110 of Windows or higher**, you must use version 0.17.0 or higher for IntelliSense to work. The Windows team turned on case-sensitive folders for the WSL environment and the C/C++ extension doesn't support case-sensitive folders until version 0.17.0.

To use the Windows Subsystem for Linux with this extension you need to add a configuration to your **c_cpp_properties.json** file which adds the necessary header paths from within the WSL filesystem to the `includePath`.

Select "C/Cpp: Edit Configurations" from the command palette to create the **c_cpp_properties.json** file if you haven't already.

## With extension version 0.17.0 and higher:

In **c_cpp_properties.json** you can directly address your WSL compiler and include paths by using *nix-style paths and we will do the conversion to Windows paths for you.  If you have multiple distros installed, we disambiguate the `compilerPath` by picking the one marked as Default when you run `wslconfig.exe /l` in a CMD or PowerShell window. We continue to support Windows-style paths for these properties as outlined in the [archived instructions](Archive/Windows%20Subsystem%20for%20Linux.md) if you prefer to use those.

```json
{
    "name": "WSL",
    "intelliSenseMode": "clang-x64",
    "compilerPath": "/usr/bin/gcc",
    "includePath": [
        "${workspaceFolder}",
        "/mnt/c/libraries/lib1/include",
        "C:/libraries/lib2/include"
    ],
    "defines": [],
    "browse": {
        "path": [
            "${workspaceFolder}",
            "/mnt/c/libraries"
        ],
        "limitSymbolsToIncludedHeaders": true,
        "databaseFilename": ""
    },
    "cStandard": "c11",
    "cppStandard": "c++17"
}
```

## Earlier versions of the extension:

If you are on a build of Windows prior to 17110 and you have an older version of the C/C++ extension installed, use [these instructions](Archive/Windows%20Subsystem%20for%20Linux.md) instead.

---

Remember to [heed the warnings of the Windows team about not creating or editing Linux files from a Windows app](https://blogs.msdn.microsoft.com/commandline/2016/11/17/do-not-change-linux-files-using-windows-apps-and-tools/)!
