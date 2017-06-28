For developers using the Windows Subsystem for Linux, we recommend you start with the following **c_cpp_properties.json** template.  Select "C/Cpp: Edit Configurations" from the command palette to create this file if you haven't already.

```
        {
            "name": "WSL",
            "intelliSenseMode": "clang-x64",
            "includePath": [
                "${workspaceRoot}",
                "${localappdata}/lxss/rootfs/usr/include/c++/5",
                "${localappdata}/lxss/rootfs/usr/include/x86_64-linux-gnu/c++/5",
                "${localappdata}/lxss/rootfs/usr/include/c++/5/backward",
                "${localappdata}/lxss/rootfs/usr/lib/gcc/x86_64-linux-gnu/5/include",
                "${localappdata}/lxss/rootfs/usr/local/include",
                "${localappdata}/lxss/rootfs/usr/lib/gcc/x86_64-linux-gnu/5/include-fixed",
                "${localappdata}/lxss/rootfs/usr/include/x86_64-linux-gnu",
                "${localappdata}/lxss/rootfs/usr/include"
            ],
            "defines": [
                "__linux__",
                "__x86_64__"
            ],
            "browse": {
                "path": [
                    "${localappdata}/lxss/rootfs/usr/include/c++/5",
                    "${localappdata}/lxss/rootfs/usr/include/x86_64-linux-gnu/c++/5",
                    "${localappdata}/lxss/rootfs/usr/lib/gcc/x86_64-linux-gnu/5/include",
                    "${localappdata}/lxss/rootfs/usr/local/include",
                    "${localappdata}/lxss/rootfs/usr/lib/gcc/x86_64-linux-gnu/5/include-fixed",
                    "${localappdata}/lxss/rootfs/usr/include/x86_64-linux-gnu",
                    "${localappdata}/lxss/rootfs/usr/include/*"
                ],
                "limitSymbolsToIncludedHeaders": true,
                "databaseFilename": ""
            }
        }

```

The `includePath` above includes the system header paths that gcc uses for C++ projects and matches the output of `gcc -v -E -x c++ - < /dev/null`. The intelliSenseMode should be set to **"clang-x64"** to get WSL projects to work properly with IntelliSense.

For C projects, simply remove the c++ lines:

```
        {
            "name": "WSL",
            "intelliSenseMode": "clang-x64",
            "includePath": [
                "${workspaceRoot}",
                "${localappdata}/lxss/rootfs/usr/lib/gcc/x86_64-linux-gnu/5/include",
                "${localappdata}/lxss/rootfs/usr/local/include",
                "${localappdata}/lxss/rootfs/usr/lib/gcc/x86_64-linux-gnu/5/include-fixed",
                "${localappdata}/lxss/rootfs/usr/include/x86_64-linux-gnu",
                "${localappdata}/lxss/rootfs/usr/include"
            ],
            "defines": [
                "__linux__",
                "__x86_64__"
            ],
            "browse": {
                "path": [
                    "${localappdata}/lxss/rootfs/usr/lib/gcc/x86_64-linux-gnu/5/include",
                    "${localappdata}/lxss/rootfs/usr/local/include",
                    "${localappdata}/lxss/rootfs/usr/lib/gcc/x86_64-linux-gnu/5/include-fixed",
                    "${localappdata}/lxss/rootfs/usr/include/x86_64-linux-gnu",
                    "${localappdata}/lxss/rootfs/usr/include/*"
                ],
                "limitSymbolsToIncludedHeaders": true,
                "databaseFilename": ""
            }
        }
```

With these configurations, you should be all set up to use the new IntelliSense engine for linting, memberlist autocomplete, and quick info (tooltips).  Add `"C_Cpp.intelliSenseEngine": "Default"` to your **settings.json** file to try out the new IntelliSense engine.

And remember to [heed the warnings of the Windows team about not creating or editing Linux files from a Windows app](https://blogs.msdn.microsoft.com/commandline/2016/11/17/do-not-change-linux-files-using-windows-apps-and-tools/)! 
