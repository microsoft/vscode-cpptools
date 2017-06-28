For developers using MinGW on Windows, we recommend you start with the following **c_cpp_properties.json** template.  Select "C/Cpp: Edit Configurations" from the command palette to create this file if you haven't already.

```
{
    "configurations": [
        {
            "name": "Win32",
            "intelliSenseMode": "clang-x64",
            "includePath": [
                "${workspaceRoot}",
                "C:/MinGW/lib/gcc/mingw32/5.3.0/include/c++",
                "C:/MinGW/lib/gcc/mingw32/5.3.0/include/c++/mingw32",
                "C:/MinGW/lib/gcc/mingw32/5.3.0/include/c++/backward",
                "C:/MinGW/lib/gcc/mingw32/5.3.0/include",
                "C:/MinGW/include",
                "C:/MinGW/lib/gcc/mingw32/5.3.0/include-fixed"
            ],
            "defines": [
                "_DEBUG",
                "UNICODE"
            ],
            "browse": {
                "path": [
                    "C:/MinGW/lib/gcc/mingw32/5.3.0/include",
                    "C:/MinGW/lib/gcc/mingw32/5.3.0/include-fixed",
                    "C:/MinGW/include/*"
                ],
                "limitSymbolsToIncludedHeaders": true,
                "databaseFilename": ""
            }
        }
    ]
}
```

The `includePath` above includes the system header paths that gcc uses in version 5.3.0 for C++ projects and matches the output of `gcc -v -E -x c++ -`. The `intelliSenseMode` should be set to **"clang-x64"** to get MinGW projects to work properly with IntelliSense.

For C projects, simply remove the c++ lines:

```
{
    "configurations": [
        {
            "name": "Win32",
            "intelliSenseMode": "clang-x64",
            "includePath": [
                "${workspaceRoot}",
                "C:/MinGW/lib/gcc/mingw32/5.3.0/include",
                "C:/MinGW/include",
                "C:/MinGW/lib/gcc/mingw32/5.3.0/include-fixed"
            ],
            "defines": [
                "_DEBUG",
                "UNICODE"
            ],
            "browse": {
                "path": [
                    "C:/MinGW/lib/gcc/mingw32/5.3.0/include",
                    "C:/MinGW/lib/gcc/mingw32/5.3.0/include-fixed",
                    "C:/MinGW/include/*"
                ],
                "limitSymbolsToIncludedHeaders": true,
                "databaseFilename": ""
            }
        }
    ]
}
```

With these configurations, you should be all set up to use the new IntelliSense engine for linting, memberlist autocomplete, and quick info (tooltips).  Add `"C_Cpp.intelliSenseEngine": "Default"` to your **settings.json** file to try out the new IntelliSense engine.
