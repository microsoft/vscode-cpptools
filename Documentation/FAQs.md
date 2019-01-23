# FAQs

## Table of Contents
* Setup: [Debugging Setup](#debugging-setup)
* Debugger: [Why is debugging not working?](#why-is-debugging-not-working)
* Build: [How to enable debug symbols](#how-to-enable-debug-symbols)
* Logging: [How to enable logging](#how-to-enable-logging)

## Debugging Setup
The debugger needs to be configured to know which executable and debugger to use:

Click menu item: `Debug` -> `Add Configuration...`

The file **launch.json** will now be open for editing with a new configuration. The default settings will *probably* work except that you need to specify the **program** setting.

See the [**Documentation/Debugger**](https://github.com/Microsoft/vscode-cpptools/tree/master/Documentation/Debugger) folder in this repository for more in-depth documentation on how to configure the debugger.

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
