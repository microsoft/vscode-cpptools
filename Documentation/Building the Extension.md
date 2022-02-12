## How to build and debug the Microsoft CppTools Extension

These steps will allow you to debug the TypeScript code that is part of the Microsoft CppTools extension for Visual Studio Code.

Prerequisite steps:
  * Clone the release branch of [this](https://github.com/Microsoft/vscode-cpptools) repository.
      * git clone -b release https://github.com/Microsoft/vscode-cpptools
  * Install [node](https://nodejs.org).
  * Install [yarn](https://yarnpkg.com).
  * From a command line, run the following commands from the **Extension** folder in the root of the repository:
      * `yarn install` will install the dependencies needed to build the extension.
      * **(optional)** `yarn global add vsce` will install `vsce` globally to create a VSIX package that you can install.
  * Open the **Extension** folder in Visual Studio Code and press F5. This will launch a VS Code Extension Host window and activate the TypeScript debugger. You can set breakpoints on the extension source code and debug your scenario.
      * If, after pressing F5, you see the following error in the `[Extension Development Host]` window,
      > Unable to start the C/C++ language server. IntelliSense features will be disabled. Error: Missing binary at .../vscode-cpptools/Extension/bin/cpptools
      * ... Then, you can follow the instructions in this [comment in a discussion about building this extension locally](https://github.com/microsoft/vscode-cpptools/discussions/8745#discussioncomment-2091563).
        > get the <package.version.number> binaries from installing the extension and then copying the binaries
        1. To do this, install this extension from the Visual Studio Marketplace and find its location on your device. It might be in a directory like `\\wsl$\Ubuntu\home\hamir\.vscode-server\extensions\ms-vscode.cpptools-<package.version.number>`, for example.
        2. Next, go to the `bin/` directory of the aforementioned directory, and drag-and-drop, or copy-and-paste, `cpptools` and `cpptools-srv` from `\extensions\ms-vscode.cpptools-<package.version.number>\bin\` to this repository's `Extension\bin\` directory on your local device, so that `/vscode-cpptools/Extension/bin/cpptools` and `/vscode-cpptools/Extension/bin/cpptools-srv` both exist in your workspace.
        3. The aforementioned warning should be gone, and Intellisense, which gives those squiggly red error lines, should now be present.
        4. The `insiders` branch has binaries compatible with the latest Pre-Release version of the extension, and the `release` branch has binaries compatible with the latest Release version, but the `main` branch may have TypeScript changes that are incompatible with the published binaries, in which case, you'll need to create a branch off the `insiders` or `release` branches."

      * Feel free to use [the Discussions tab of this repository](https://github.com/microsoft/vscode-cpptools/discussions) if you have any further questions on building this extension locally.
