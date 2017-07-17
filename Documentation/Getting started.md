# Getting started

## Configuring IntelliSense

**TL;DR**: Open your settings file and add `"intelliSenseEngine": "Default"` to preview the new and improved IntelliSense. Then add the necessary include paths to your c_cpp_properties.json file so that IntelliSense can find your symbols.

#### The IntelliSense engines

When the extension was first released, we shipped an IntelliSense engine that provided quick, but "fuzzy" results for common operations like auto-complete, parameter help, quick info tooltips, and goto definition. This "tag parser" built up a database of symbols by parsing the most important "tags" from your source files, ignoring preprocessor blocks, local variables, and most errors. More recently, we have begun the process of porting the MSVC IntelliSense engine from Visual Studio to VS Code to provide more accurate results. 

You can choose the engine that works best for your projects by editing your [user or workspace settings](https://code.visualstudio.com/docs/getstarted/settings). The setting you should modify is `"C_Cpp.intelliSenseEngine"`. There are two values for this setting:

* `"Default"` - use Visual Studio's IntelliSense engine (in preview, the default for VS Code Insiders)
* `"Tag Parser"` - use the "fuzzy" IntelliSense engine (the default for users on the stable VS Code build)

#### Include paths

In order to get accurate IntelliSense results with either engine, the extension needs some information about your project.  When you open a folder, the extension will attempt to locate your system headers based on your operating system, but it does not know about any auxiliary libraries that your project depends on.  You can specify the remaining paths by using the `"C/Cpp: Edit Configurations"` command in the command palette.

This command will create or open a file called **c_cpp_properties.json** in your workspace.  In this file, you can specify the paths to the headers that your project depends on.  There are two settings in this file that you should pay particular attention to: `"includePath"` and `"browse.path"`.  `"includePath"` is the setting used by the `"Default"` IntelliSense engine and `"browse.path"` is the setting used by the tag parser engine.  [More information about these settings is documented here](https://github.com/Microsoft/vscode-cpptools/blob/master/Documentation/LanguageServer/FAQ.md#what-is-the-difference-between-includepath-and-browsepath-in-c_cpp_propertiesjson).

