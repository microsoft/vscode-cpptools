# How to Contribute Changes

## Contribution Steps

* [Build and debug the extension](Documentation/Building%20the%20Extension.md).
* File an [issue](https://github.com/Microsoft/vscode-cpptools/issues) and a [pull request](https://github.com/Microsoft/vscode-cpptools/pulls) with the change and we will review it.
* If the change affects functionality, add a line describing the change to [**CHANGELOG.md**](Extension/CHANGELOG.md).
* Try and add a test in [**test/extension.test.ts**](Extension/test/scenarios/SingleRootProject/tests/extension.test.ts).
* Run tests via opening the [**Extension**](https://github.com/Microsoft/vscode-cpptools/tree/main/Extension) folder in Visual Studio Code, selecting the "Launch Tests" configuration in the Debug pane, and choosing "Start Debugging".

## About the Code

* Execution starts in the `activate` method in [**main.ts**](Extension/src/main.ts).
  * `processRuntimeDependencies` handles the downloading and installation of the OS-dependent files. Downloading code exists in [**packageManager.ts**](Extension/src/packageManager.ts).
  * `downloadCpptoolsJsonPkg` handles the **cpptools.json**, which can be used to enable changes to occur mid-update, such as turning the `intelliSenseEngine` to `"Default"` for a certain percentage of users.
* The debugger code is in the [**Debugger**](https://github.com/Microsoft/vscode-cpptools/tree/main/Extension/src/Debugger) folder.
* [**LanguageServer/client.ts**](Extension/src/LanguageServer/client.ts) handles various language server functionality.
* [**LanguageServer/configurations.ts**](Extension/src/LanguageServer/configurations.ts) handles functionality related to **c_cpp_properties.json**.
* [**telemetry.ts**](Extension/src/telemetry.ts): Telemetry data gets sent to either `logLanguageServerEvent` or `logDebuggerEvent`.
* The Tag Parser (symbol database) doesn't automatically expand macros, so the [**cpp.hint**](Extension/cpp.hint) file contains definitions of macros that should be expanded in order for symbols to be parsed correctly.

## String Localization

* VS Code's built-in [l10n](https://code.visualstudio.com/api/references/vscode-api#l10n) support is used to localize strings in TypeScript code. The English string itself is the key, so no separate setup or import is required beyond `vscode`:
```typescript
import * as vscode from 'vscode';
```
* For each user-facing string, wrap the string in a call to `vscode.l10n.t`:
```typescript
const readmeMessage: string = vscode.l10n.t("Please refer to {0} for troubleshooting information. Issues can be created at {1}", readmePath, "https://github.com/Microsoft/vscode-cpptools/issues");
```
* The first parameter is the string to localize, and it must be a string literal. Tokens such as {0} and {1} are supported in the localizable string, with replacement values passed as additional parameters (these may be strings, numbers, or booleans).
* When a translator needs a hint about how to translate a string, use the object form, which takes a required `comment` and an optional `args` array:
```typescript
const message: string = vscode.l10n.t({ message: "Add '{0}'", args: [code], comment: ["{0} is C++ code to add, such as '#include <string>'"] });
```
* At build time, [@vscode/l10n-dev](https://github.com/microsoft/vscode-l10n) scans the source for these calls and produces `./l10n/bundle.l10n.json` (and per-language `./l10n/bundle.l10n.<language>.json` files). The `"l10n": "./l10n"` field in [**package.json**](Extension/package.json) tells VS Code where to load them. VS Code loads the bundle for the active display language, so the strings are not read synchronously at extension startup.


## Contributor License Agreement

This project welcomes contributions and suggestions. Most contributions require you to
agree to a Contributor License Agreement (CLA) declaring that you have the right to,
and actually do, grant us the rights to use your contribution. For details, visit
https://cla.microsoft.com.

When you submit a pull request, a CLA-bot will automatically determine whether you need
to provide a CLA and decorate the PR appropriately (e.g., label, comment). Simply follow the
instructions provided by the bot. You will only need to do this once across all repositories using our CLA.

This project has adopted the [Microsoft Open Source Code of Conduct](https://opensource.microsoft.com/codeofconduct/).
For more information see the [Code of Conduct FAQ](https://opensource.microsoft.com/codeofconduct/faq/)
or contact [opencode@microsoft.com](mailto:opencode@microsoft.com) with any additional questions or comments.

### Adding/Updating package.json dependencies

We maintain a public Azure Artifacts feed that we point the package manager to in .npmrc files. If you want to add a dependency or update a version in package.json, you may need to contact us so we can add it to our feed. Please ping our team in a PR or new issue if you experience this issue.

For local development, you can delete the .npmrc file and the matching `yarn.lock` file while you wait for us to update the feed. However, these changes will need to be reverted in your branch before we will accept a PR.