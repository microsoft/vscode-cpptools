# Windows Subsystem for Linux

To use the Windows Subsystem for Linux with this extension you need to add a configuration to your **c_cpp_properties.json** file which adds the necessary header paths from within the WSL filesystem to the `includePath`.

Select "C/Cpp: Edit Configurations" from the command palette to create the **c_cpp_properties.json** file if you haven't already.

## Release

For developers using Ubuntu with the current version of WSL released with the Fall Creators Update, you can add the following configuration template to your **c_cpp_properties.json** file.

```json
{
    "name": "WSL",
    "intelliSenseMode": "clang-x64",
    "includePath": [
        "${workspaceRoot}",
        "${localappdata}/Packages/CanonicalGroupLimited.UbuntuonWindows_79rhkp1fndgsc/LocalState/rootfs/usr/include/c++/5",
        "${localappdata}/Packages/CanonicalGroupLimited.UbuntuonWindows_79rhkp1fndgsc/LocalState/rootfs/usr/include/x86_64-linux-gnu/c++/5",
        "${localappdata}/Packages/CanonicalGroupLimited.UbuntuonWindows_79rhkp1fndgsc/LocalState/rootfs/usr/include/c++/5/backward",
        "${localappdata}/Packages/CanonicalGroupLimited.UbuntuonWindows_79rhkp1fndgsc/LocalState/rootfs/usr/lib/gcc/x86_64-linux-gnu/5/include",
        "${localappdata}/Packages/CanonicalGroupLimited.UbuntuonWindows_79rhkp1fndgsc/LocalState/rootfs/usr/local/include",
        "${localappdata}/Packages/CanonicalGroupLimited.UbuntuonWindows_79rhkp1fndgsc/LocalState/rootfs/usr/lib/gcc/x86_64-linux-gnu/5/include-fixed",
        "${localappdata}/Packages/CanonicalGroupLimited.UbuntuonWindows_79rhkp1fndgsc/LocalState/rootfs/usr/include/x86_64-linux-gnu",
        "${localappdata}/Packages/CanonicalGroupLimited.UbuntuonWindows_79rhkp1fndgsc/LocalState/rootfs/usr/include"
    ],
    "defines": [
        "__linux__",
        "__x86_64__"
    ],
    "browse": {
        "path": [
            "${localappdata}/Packages/CanonicalGroupLimited.UbuntuonWindows_79rhkp1fndgsc/LocalState/rootfs/usr/include/c++/5",
            "${localappdata}/Packages/CanonicalGroupLimited.UbuntuonWindows_79rhkp1fndgsc/LocalState/rootfs/usr/include/x86_64-linux-gnu/c++/5",
            "${localappdata}/Packages/CanonicalGroupLimited.UbuntuonWindows_79rhkp1fndgsc/LocalState/rootfs/usr/lib/gcc/x86_64-linux-gnu/5/include",
            "${localappdata}/Packages/CanonicalGroupLimited.UbuntuonWindows_79rhkp1fndgsc/LocalState/rootfs/usr/local/include",
            "${localappdata}/Packages/CanonicalGroupLimited.UbuntuonWindows_79rhkp1fndgsc/LocalState/rootfs/usr/lib/gcc/x86_64-linux-gnu/5/include-fixed",
            "${localappdata}/Packages/CanonicalGroupLimited.UbuntuonWindows_79rhkp1fndgsc/LocalState/rootfs/usr/include/x86_64-linux-gnu",
            "${localappdata}/Packages/CanonicalGroupLimited.UbuntuonWindows_79rhkp1fndgsc/LocalState/rootfs/usr/include/*"
        ],
        "limitSymbolsToIncludedHeaders": true,
        "databaseFilename": ""
    }
}
```

The `includePath` above includes the system header paths that gcc uses for C++ projects and matches the output of `gcc -v -E -x c++ - < /dev/null`. The intelliSenseMode should be set to **"clang-x64"** to get WSL projects to work properly with IntelliSense.

Note that `${localappdata}/Packages/CanonicalGroupLimited.UbuntuonWindows_79rhkp1fndgsc/LocalState/rootfs/` is the path to the root of the Ubuntu filesystem. This will be different if you are using a different distro. You can discover the paths to your distro's filesystem by using this handy PowerShell command:

```Powershell
PS R:\> ($(get-appxpackage).PackageFamilyName | findstr /i 'SUSE Ubuntu') -replace '^', "$`{localappdata`}/Packages/"

${localappdata}/Packages/CanonicalGroupLimited.UbuntuonWindows_79rhkp1fndgsc
${localappdata}/Packages/46932SUSE.openSUSELeap42.2_022rs5jcyhyac
${localappdata}/Packages/46932SUSE.SUSELinuxEnterpriseServer12SP2_022rs5jcyhyac
```

For C projects, simply remove the C++ lines:

```json
{
    "name": "WSL",
    "intelliSenseMode": "clang-x64",
    "includePath": [
        "${workspaceRoot}",
        "${localappdata}/Packages/CanonicalGroupLimited.UbuntuonWindows_79rhkp1fndgsc/LocalState/rootfs/usr/lib/gcc/x86_64-linux-gnu/5/include",
        "${localappdata}/Packages/CanonicalGroupLimited.UbuntuonWindows_79rhkp1fndgsc/LocalState/rootfs/usr/local/include",
        "${localappdata}/Packages/CanonicalGroupLimited.UbuntuonWindows_79rhkp1fndgsc/LocalState/rootfs/usr/lib/gcc/x86_64-linux-gnu/5/include-fixed",
        "${localappdata}/Packages/CanonicalGroupLimited.UbuntuonWindows_79rhkp1fndgsc/LocalState/rootfs/usr/include/x86_64-linux-gnu",
        "${localappdata}/Packages/CanonicalGroupLimited.UbuntuonWindows_79rhkp1fndgsc/LocalState/rootfs/usr/include"
    ],
    "defines": [
        "__linux__",
        "__x86_64__"
    ],
    "browse": {
        "path": [
            "${localappdata}/Packages/CanonicalGroupLimited.UbuntuonWindows_79rhkp1fndgsc/LocalState/rootfs/usr/lib/gcc/x86_64-linux-gnu/5/include",
            "${localappdata}/Packages/CanonicalGroupLimited.UbuntuonWindows_79rhkp1fndgsc/LocalState/rootfs/usr/local/include",
            "${localappdata}/Packages/CanonicalGroupLimited.UbuntuonWindows_79rhkp1fndgsc/LocalState/rootfs/usr/lib/gcc/x86_64-linux-gnu/5/include-fixed",
            "${localappdata}/Packages/CanonicalGroupLimited.UbuntuonWindows_79rhkp1fndgsc/LocalState/rootfs/usr/include/x86_64-linux-gnu",
            "${localappdata}/Packages/CanonicalGroupLimited.UbuntuonWindows_79rhkp1fndgsc/LocalState/rootfs/usr/include/*"
        ],
        "limitSymbolsToIncludedHeaders": true,
        "databaseFilename": ""
    }
}
```

### Beta

For developers using Bash on Ubuntu on Windows with the beta version of WSL from before the Fall Creators Update, you can add the following configuration template to your **c_cpp_properties.json** file.

```json
{
    "name": "WSL (Beta)",
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

Note that `${localappdata}/lxss/rootfs/` is the path to the root of the filesystem for Bash on Ubuntu on Windows.

For C projects, simply remove the C++ lines as in the previous example.

---

With these configurations, you should be all set up to use the new IntelliSense engine for linting, memberlist autocomplete, and quick info (tooltips).  Add `"C_Cpp.intelliSenseEngine": "Default"` to your **settings.json** file to try out the new IntelliSense engine.

And remember to [heed the warnings of the Windows team about not creating or editing Linux files from a Windows app](https://blogs.msdn.microsoft.com/commandline/2016/11/17/do-not-change-linux-files-using-windows-apps-and-tools/)!
