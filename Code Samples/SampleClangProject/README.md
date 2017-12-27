# README
This is a sample debuggable C++ project. It uses the vendor provided version of clang installed. `tasks.json` and `launch.json` have been edited to demonstrate how to create a configuration for a C++ project that builds with clang.

There's a sample build task in `.vscode/tasks.json`; you can also see the build configurations by using the menu option `Configure` -> `Configure Tasks` or by clicking the gear icon in the Debug Panel.

To run a build, use the menu option `Tasks` -> `Run Build Task...`.

There's a sample debug configuration in `.vscode/launch.json`; you can also see the configuration by using the menu option `Debug` -> `Open Configurations`.

To debug the build, use the menu option `Debug` -> `Start Debugging`. The executable will launch and stop in the main function.