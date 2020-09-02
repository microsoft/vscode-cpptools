# OptionsSchema
OptionsSchema.json defines the type for Launch/Attach options.

# GenerateOptionsSchema
If there are any modifications to the OptionsSchema.json file. Please run `yarn run generateOptionsSchema` at the repo root.
This will call GenerateOptionsSchema and update the package.json file.

### Important notes:

1. Any manual changes to package.json's object.contributes.debuggers[0].configurationAttributes (cppdbg) or object.contributes.debuggers[0].configurationAttributes (cppvsdbg) will be
replaced by this generator.

If there is any other type of options added in the future, you will need to modify the GenerateOptionsSchema function
to have it appear in package.json. It only adds launch and attach.
