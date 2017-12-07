#### The IntelliSense engines

When the extension was first released, we shipped an IntelliSense engine that provided quick, but "fuzzy" results for common operations like auto-complete, parameter help, quick info tooltips, and goto definition. This "tag parser" built up a database of symbols by parsing the most important "tags" from your source files, ignoring preprocessor blocks, local variables, and most errors. More recently, we have begun the process of porting the MSVC IntelliSense engine from Visual Studio to VS Code to provide more accurate results. 

You can choose the engine that works best for your projects by editing your [user or workspace settings](https://code.visualstudio.com/docs/getstarted/settings). The setting you should modify is `"C_Cpp.intelliSenseEngine"`. There are two values for this setting:

* `"Default"` - use Visual Studio's IntelliSense engine (in preview, the default for VS Code Insiders)
* `"Tag Parser"` - use the "fuzzy" IntelliSense engine (the default for users on the stable VS Code build)

There are two settings in this file that you should pay particular attention to: `"includePath"` and `"browse.path"`.  `"includePath"` is the setting used by the `"Default"` IntelliSense engine and `"browse.path"` is the setting used by the tag parser engine.  [More information about these settings is documented here](https://github.com/Microsoft/vscode-cpptools/blob/master/Documentation/LanguageServer/FAQ.md#what-is-the-difference-between-includepath-and-browsepath-in-c_cpp_propertiesjson).

#### The fallback 