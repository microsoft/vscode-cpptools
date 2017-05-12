# Frequently asked questions

## What is the difference between "includePath" and "browse.path" in c\_cpp\_properties.json?

Starting with version 0.11.0 of the cpptools extension, there are now two settings in the c\_cpp\_properties.json file. They are used by the different IntelliSense engines that we support and have slightly different meanings for the components that use them.

The active IntelliSense engine is controlled via the `"intelliSenseEngine"` setting in your settings.json file. The valid values for this setting are:
* `"Default"`
* `"Tag Parser"`

**includePath**: This array of path strings is used by the new "Default" IntelliSense engine that was introduced in version 0.11.0 of the extension. This new engine provides semantic-aware IntelliSense features and will be the eventual replacement for the Tag Parser that has been powering the extension since it was first released. It currently provides tooltips and error squiggles in the editor. The remaining features (e.g. code completion, signature help, go to definition, ...) are implemented using the Tag Parser's database, so it is still important to ensure that the browse.path setting is properly set.

The paths that you specify for this setting are the same paths that you would send to your compiler via the `-I` switch. When your source files are parsed, the IntelliSense engine will prepend these paths to the files specified by your `#include` directives while attempting to resolve them. These paths are _not searched recursively_.

**browse.path**: This array of path strings is used by the "Tag Parser" (a.k.a. "browse engine"). This engine will _recursively_ enumerate all files under the paths specified and track them as potential includes while tag parsing your project folder. To disable recursive enumeration of a path, you can append a `/*` to the path string.

The extension will also implicitly add `${workspaceRoot}` to the array of paths unless `"C_Cpp.addWorkspaceRootToIncludePath"` is explicitly set to `false` in your settings.json file.