# C/C++ for Visual Studio Code

#### [Repository](https://github.com/microsoft/vscode-cpptools)&nbsp;&nbsp;|&nbsp;&nbsp;[Issues](https://github.com/microsoft/vscode-cpptools/issues)&nbsp;&nbsp;|&nbsp;&nbsp;[Documentation](https://code.visualstudio.com/docs/languages/cpp)&nbsp;&nbsp;|&nbsp;&nbsp;[Code Samples](https://github.com/microsoft/vscode-cpptools/tree/main/Code%20Samples)&nbsp;&nbsp;|&nbsp;&nbsp;[Offline Installers](https://github.com/microsoft/vscode-cpptools/releases)

[![Badge](https://aka.ms/vsls-badge)](https://aka.ms/vsls)

The C/C++ extension adds language support for C/C++ to Visual Studio Code, including features such as IntelliSense and debugging.

## Overview and tutorials
* [C/C++ extension overview](https://code.visualstudio.com/docs/languages/cpp)

C/C++ extension tutorials per compiler and platform
* [Microsoft C++ compiler (MSVC) on Windows](https://code.visualstudio.com/docs/cpp/config-msvc)
* [GCC and Mingw-w64 on Windows](https://code.visualstudio.com/docs/cpp/config-mingw)
* [GCC on Windows Subsystem for Linux (WSL)](https://code.visualstudio.com/docs/cpp/config-wsl)
* [GCC on Linux](https://code.visualstudio.com/docs/cpp/config-linux)
* [Clang on macOS](https://code.visualstudio.com/docs/cpp/config-clang-mac)

## Quick links
* [Editing features (IntelliSense)](https://code.visualstudio.com/docs/cpp/cpp-ide) 
* [IntelliSense configuration](https://code.visualstudio.com/docs/cpp/customize-default-settings-cpp)
* [Enhanced colorization](https://code.visualstudio.com/docs/cpp/colorization-cpp)
* [Debugging](https://code.visualstudio.com/docs/cpp/cpp-debug)
* [Debug configuration](https://code.visualstudio.com/docs/cpp/launch-json-reference)
* [Enable logging for IntelliSense or debugging](https://code.visualstudio.com/docs/cpp/enable-logging-cpp)

## Questions and feedback

**[FAQs](https://code.visualstudio.com/docs/cpp/faq-cpp)**
<br>
Check out the FAQs before filing a question.
<br>

**[Provide feedback](https://github.com/microsoft/vscode-cpptools/issues/new/choose)**
<br>
File questions, issues, or feature requests for the extension.
<br>

**[Known issues](https://github.com/Microsoft/vscode-cpptools/issues)**
<br>
If someone has already filed an issue that encompasses your feedback, please leave a 👍 or 👎 reaction on the issue to upvote or downvote it to help us prioritize the issue.
<br>

**[Quick survey](https://www.research.net/r/VBVV6C6)**
<br>
Let us know what you think of the extension by taking the quick survey.

## Offline installation

The extension has platform-specific binary dependencies, therefore installation via the Marketplace requires an Internet connection in order to download additional dependencies. If you are working on a computer that does not have access to the Internet or is behind a strict firewall, you may need to use our platform-specific packages and install them by running VS Code's `"Install from VSIX..."` command. These "offline' packages are available at: https://github.com/Microsoft/vscode-cpptools/releases.

 Package | Platform
:--- | :---
`cpptools-linux.vsix` | Linux 64-bit
`cpptools-linux-armhf.vsix` | Linux ARM 32-bit
`cpptools-linux-aarch64.vsix` | Linux ARM 64-bit
`cpptools-osx.vsix` | macOS
`cpptools-win32.vsix` | Windows 64-bit & 32-bit
`cpptools-win-arm64.vsix` | Windows ARM64
`cpptools-linux32.vsix` | Linux 32-bit ([available up to version 0.27.0](https://github.com/microsoft/vscode-cpptools/issues/5346))

## Contribution

Contributions are always welcome. Please see our [contributing guide](CONTRIBUTING.md) for more details.

## Microsoft Open Source Code of Conduct

This project has adopted the [Microsoft Open Source Code of Conduct](https://opensource.microsoft.com/codeofconduct/). For more information see the [Code of Conduct FAQ](https://opensource.microsoft.com/codeofconduct/faq/) or contact opencode@microsoft.com with any additional questions or comments.

## Data and telemetry

This extension collects usage data and sends it to Microsoft to help improve our products and services. Collection of telemetry is controlled via the same setting provided by Visual Studio Code: `"telemetry.enableTelemetry"`. Read our [privacy statement](https://privacy.microsoft.com/en-us/privacystatement) to learn more.