## How to build and debug the Microsoft CppTools Extension  
  
These steps will allow you to debug the TypeScript code that is part of the Microsoft CppTools extension for Visual Studio Code.  
  
Prerequisite steps:  
  * Clone [this](https://github.com/Microsoft/vscode-cpptools) repository.  
  * Install [npm](https://nodejs.org).  
  * From a command line, run the following commands from the **Extension** folder in the root of the repository:  
      * `npm install -g vsce` will install `vsce` globally to create the vsix package.  
      * `npm install` will install the dependencies needed to build the extension.  
  * Set an environment variable `CPPTOOLS_DEV=1`.  
    * This enables the local developer workflow, copying dependencies from the **node_modules** folder.  
  * Open the **Extension** folder in Visual Studio Code and F5.  
  * Read the [contributing guidelines](https://github.com/Microsoft/vscode-cpptools/blob/master/CONTRIBUTING.md).  
