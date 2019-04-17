# FAQs

## Table of Contents
* Setup: [Debugging Setup](#debugging-setup)
* Setup: [What is the .vscode/ipch folder?](#what-is-the-vscodeipch-folder)
* Setup: [How do I disable the IntelliSense cache (ipch)?](#how-do-i-disable-the-intellisense-cache-ipch)
* Debugger: [Why is debugging not working?](#why-is-debugging-not-working)
* Build: [How to enable debug symbols](#how-to-enable-debug-symbols)
* Logging: [How to enable logging](#how-to-enable-logging)

## Debugging Setup
The debugger needs to be configured to know which executable and debugger to use:

Click menu item: `Debug` -> `Add Configuration...`

The file **launch.json** will now be open for editing with a new configuration. The default settings will *probably* work except that you need to specify the **program** setting.

See the [**Documentation/Debugger**](https://github.com/Microsoft/vscode-cpptools/tree/master/Documentation/Debugger) folder in this repository for more in-depth documentation on how to configure the debugger.

## What is the .vscode/ipch folder?

The language server caches information about included header files to improve the performance of IntelliSense. When you edit C/C++ files in your workspace folder, the language server will store cache files in the `.vscode/ipch` folder by default. VS Code per-workspace storage folders were not selected for the following reasons:
* The workspace storage location provided by VS Code is somewhat obscure and we had reservations about writing GB's worth of files in this location where users may not see them or know where to find them.
* Parity with Visual Studio. This is how Visual Studio works and they receive little to no feedback/complaints on the location.

With this in mind we knew that we wouldn't be able to please everyone, so we provided settings to allow you to customize this the way that works best for your situation.  We also figured that putting the files in the workspace folder would bring the issue to your attention quickly so that you can take action if you don't like the default behavior.

#### `"C_Cpp.intelliSenseCachePath": <string>`
This setting allows you to set workspace or global overrides for the cache path. For example, if you want to share a single cache location for all workspace folders, you just open the VS Code settings, and add a "User" setting for "IntelliSense Cache Path".

#### `"C_Cpp.intelliSenseCacheSize": <number>`
This setting allows you to set a limit on the amount of caching the extension does. This is an approximation, but the extension will make a best effort to keep the cache size as close to the limit you set as possible. If you are sharing the cache location across workspaces as explained above, you can still increase/decrease the limit, but you should make sure that you add a "User" setting for "IntelliSense Cache Size".

## How do I disable the IntelliSense cache (ipch)?

If you do not want to use the IntelliSense caching feature to improve the performance of IntelliSense, you can disable the feature by setting the "IntelliSense Cache Size" setting to 0. (or `"C_Cpp.intelliSenseCacheSize": 0"` in the JSON settings editor)

## Why is debugging not working?

### My breakpoints aren't being hit

When you start debugging, if it is showing that your breakpoints aren't bound (solid red circle) or they are not being hit, you may need to enable [debug symbols](#how-to-enable-debug-symbols) during compilation. 

### Debugging starts but all the lines in my stack trace are grey

If your debugger is showing a grey stacktrace or won't stop at a breakpoint, or the symbols in the call stack are grey then your executable was compiled without [debug symbols](#how-to-enable-debug-symbols).

## How to enable debug symbols?

Enabling debug symbols are dependent on the type of compiler you are using. Below are some of the compilers and the compiler options necessary to enable debug symbols.

When in doubt, please check your compiler's documentation for the options necessary to include debug symbols in the output. This may be some variant of `-g` or `--debug`.

* #### Clang (C++)
  * If you invoke the compiler manually then add the `--debug` option.
  * If you're using a script then make sure the `CXXFLAGS` environment variable is set; e.g. `export CXXFLAGS="${CXXFLAGS} --debug"`
  * If you're using CMake then set make sure the `CMAKE_CXX_FLAGS` is set; e.g. `export CMAKE_CXX_FLAGS=${CXXFLAGS}`

* #### Clang (C)
  See Clang C++ but use `CFLAGS` instead of `CXXFLAGS`.

* #### gcc or g++
  If you invoke the compiler manually, add the `-g` option.

* #### cl.exe
  Symbols are located in the `*.pdb` file.

## How to enable logging

Enabling logging will show communication information between VS Code and our extension and between our extension and the debugger.

### Logging for `MI` debuggers

The logging block with its defaults is as follows:

```
"logging": {
    "trace": false,
    "traceResponse": false,
    "engineLogging": false
}
```

#### VS Code and the CppTools extension

The logging here is called `trace` logging and can be enabled by setting `trace` and `traceResponse` to `true` in the logging block inside `launch.json`. This will help diagnose issues related to VS Code's communication to our extension and our responses.

#### CppTools extension and the debugger

The logging between CppTools and the debugger is called `engineLogging`. When using an `MI` debugger such as `gdb` or `lldb`, this will show the request, response and events using the `mi` interpreter. This logging will help us determine whether the debugger is receiving the right commands and generating the correct responses.

### Logging for `Visual C++` debugger

The logging block with its defaults is as follows:

```
"logging": { 
    "engineLogging": false
}
```

The `Visual C++` debugger logging will show only the communication to and from VS Code as all communication to the debugger is done internally to the process and is not visible through logging.
