# Frequently asked questions

[Why do I have red underlines everywhere after updating to the latest version](#why-do-i-have-red-underlines-everywhere-after-updating-to-the-latest-version)?

[How do I get the new IntelliSense to work with MinGW on Windows](#how-do-i-get-the-new-intellisense-to-work-with-mingw-on-windows)?

[What is the difference between "includePath" and "browse.path" in c\_cpp\_properties.json](#what-is-the-difference-between-includepath-and-browsepath-in-c_cpp_propertiesjson)?

## Why do I have red underlines everywhere after updating to the latest version?

If you are using the VS Code Insider build with version 0.11.0 or higher of the cpptools extension or any build of VS Code with version 0.11.1 of the extension, then the extension will default to using the new IntelliSense engine for linting and providing quick info tooltips in your source files.

For some users this may result in a large number of red underlines ("squiggles") appearing in your source files. There are a few things you can do to resolve this issue. Select the one that best meets your needs for your situation.

1. Update your includePath and defines
2. Disable the error squiggles
3. Disable the new IntelliSense engine

#### Update your includePath and defines

If you haven't already created a c_cpp_properties.json file for your project, you can do so by selecting "C/Cpp: Edit Configurations" from the command palette. This will create and open the c_cpp_properties.json file for you. Add the necessary paths to your include files to the `"includePath"` array. The `${workspaceRoot}` variable is available to use to get a relative path to the folder you have opened. Also add any required symbols that need to be defined to the `"defines"` array. Both "\<var\>" and "\<var\>=\<value\>" syntax is accepted. When you edit and save this file, the IntelliSense engine will reset and reparse source your source files and headers with the new settings.

#### Disable the error squiggles

If you want to keep using the semantic-aware features that will be coming online via the new IntelliSense engine, but don't want to see the error squiggles in the editor, then you can disable the lint messages by adding `"C_Cpp.errorSquiggles": "Disabled"` to your settings.json file.

#### Disable the new IntelliSense engine

If you were happy with the old behavior of the extension or want to wait to get the semantic-aware features until build system support arrives in the extension so that you don't have to manually configure a c_cpp_properties.json file, you can disable the new IntelliSense engine entirely by adding `"C_Cpp.intelliSenseEngine": "Tag Parser"` to your settings.json file.

## How do I get the new IntelliSense to work with MinGW on Windows?

Since MinGW is a relative of GCC, Microsoft mode compilation (which is the default on Windows) doesn't work very well with it. To use GCC/CLang mode, set the `"intelliSenseMode"` property in your **c_cpp_properties.json** file to `"clang-x64"`. An example **c_cpp_properties.json** [is shared here for your convenience](https://github.com/Microsoft/vscode-cpptools/blob/master/Documentation/LanguageServer/MinGW.md).

## What is the difference between "includePath" and "browse.path" in c\_cpp\_properties.json?

Starting with version 0.11.0 of the cpptools extension, there are now two settings in the c\_cpp\_properties.json file. They are used by the different IntelliSense engines that we support and have slightly different meanings for the components that use them.

The active IntelliSense engine is controlled via the `"C_Cpp.intelliSenseEngine"` setting in your settings.json file. The valid values for this setting are:
* `"Default"`
* `"Tag Parser"`

**includePath**: This array of path strings is used by the new "Default" IntelliSense engine that was introduced in version 0.11.0 of the extension. This new engine provides semantic-aware IntelliSense features and will be the eventual replacement for the Tag Parser that has been powering the extension since it was first released. It currently provides tooltips and error squiggles in the editor. The remaining features (e.g. code completion, signature help, go to definition, ...) are implemented using the Tag Parser's database, so it is still important to ensure that the browse.path setting is properly set.

The paths that you specify for this setting are the same paths that you would send to your compiler via the `-I` switch. When your source files are parsed, the IntelliSense engine will prepend these paths to the files specified by your `#include` directives while attempting to resolve them. These paths are _not searched recursively_.

**browse.path**: This array of path strings is used by the "Tag Parser" (a.k.a. "browse engine"). This engine will _recursively_ enumerate all files under the paths specified and track them as potential includes while tag parsing your project folder. To disable recursive enumeration of a path, you can append a `/*` to the path string.

The extension will also implicitly add `${workspaceRoot}` to the array of paths unless `"C_Cpp.addWorkspaceRootToIncludePath"` is explicitly set to `false` in your settings.json file.
