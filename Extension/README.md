# C/C++ for Visual Studio Code

### [Repository](https://github.com/microsoft/vscode-cpptools)&nbsp;&nbsp;|&nbsp;&nbsp;[Issues](https://github.com/microsoft/vscode-cpptools/issues)&nbsp;&nbsp;|&nbsp;&nbsp;[Documentation](https://github.com/microsoft/vscode-cpptools/tree/master/Documentation)&nbsp;&nbsp;|&nbsp;&nbsp;[Code Samples](https://github.com/microsoft/vscode-cpptools/tree/master/Code%20Samples)&nbsp;&nbsp;|&nbsp;&nbsp;[Offline Installers](https://github.com/microsoft/vscode-cpptools/releases)

[![Badge](https://aka.ms/vsls-badge)](https://aka.ms/vsls)

This preview release of the extension adds language support for C/C++ to Visual Studio Code including:
* Language service
  * Code Formatting (clang-format)
  * Auto-Completion
  * Symbol Searching
  * Go to Definition/Declaration
  * Peek Definition/Declaration
  * Class/Method Navigation
  * Signature Help
  * Quick Info (Hover)
  * Error Squiggles
* Debugging
  * Support for debugging Windows (PDB, MinGW/Cygwin), Linux and macOS applications
  * Line by line code stepping
  * Breakpoints (including conditional and function breakpoints)
  * Variable inspection
  * Multi-threaded debugging support
  * Core dump debugging support
  * Executing GDB or MI commands directly when using 'C++ (GDB/LLDB)' debugging environment
  * For help configuring the debugger see [Configuring launch.json for C/C++ debugging](https://github.com/Microsoft/vscode-cpptools/blob/master/launch.md)
    on our [GitHub page](https://github.com/Microsoft/vscode-cpptools).

You can find more detailed information about C/C++ support for Visual Studio Code at our [GitHub page](https://github.com/Microsoft/vscode-cpptools/tree/master/Documentation) and our [VS Code documentation page](https://code.visualstudio.com/docs/languages/cpp).

## Installation
The extension has OS-specific binary dependencies, so installation via the Marketplace requires an Internet connection so that these additional dependencies can be downloaded. If you are working on a computer that does not have access to the Internet or is behind a strict firewall, you may need to use our OS-specific packages and install them by invoking VS Code's `"Install from VSIX..."` command. These "offline' packages are available at: https://github.com/Microsoft/vscode-cpptools/releases.
* `cpptools-linux.vsix` - for 64-bit Linux
* `cpptools-linux32.vsix` - for 32-bit Linux
* `cpptools-osx.vsix` - for macOS
* `cpptools-win32.vsix` - for 64-bit & 32-bit Windows

## Contact Us
If you run into any issues or have suggestions for us, please file [issues and suggestions on GitHub](https://github.com/Microsoft/vscode-cpptools/issues). If you haven’t already provided us feedback, please take this [quick survey](https://www.research.net/r/VBVV6C6) and let us know what you think!
