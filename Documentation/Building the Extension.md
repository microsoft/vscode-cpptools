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
  * **(optional)** Set an environment variable `CPPTOOLS_DEV=1`.
    * This enables the local developer workflow when testing the debugger, copying dependencies from the **node_modules** folder. Testing the language server does not require this step.
  * Open the **Extension** folder in Visual Studio Code and press F5. This will launch a VS Code Extension Host window and activate the TypeScript debugger. You can set breakpoints on the extension source code and debug your scenario.
