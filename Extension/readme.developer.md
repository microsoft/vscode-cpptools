# Developer Documentation

## Setup

### Required Tools 

* [Node.js](https://nodejs.org/en/download/) v16.*
* Yarn - use `npm install -g yarn` to install

### Setting up the repository

`git clone https://github.com/microsoft/vscode-cpptools.git`

`yarn install`

## Building the Extension


### From Inside VSCode
There are two tasks that can be run from inside VSCode to build the extension.

When you select `ctrl-shift-b` - there is a `Compile` task and a `Watch` task. 

During regular development, you probably want to use the `Watch` task as it will 
compile changed files as you save them.


### From Command line
To build the extension from the command line, use the [`yarn compile`](#yarn-compile) command, or 
[`yarn watch`](#yarn-watch) to watch for changes and recompile as needed.

<hr>

## Use of an isolated `vscode` environment
The scripts for this repository now support running vscode and the extension in a 
completely isolated environment (separate install of vscode, private extensions and 
user folders, etc). 

The scripts that install `vscode` place it in a `$ENV:TMP/.vscode-test/<UID>` folder where
`<UID>` is a has calculated from the extension folder (this permits multiple checkouts of 
the source repository and each gets it's own isolated environment).

The [`test scripts`](#yarn-test) will automatically install and use this isolated environment.

You can invoke vscode from the command line using the [`yarn code`](#yarn-code) script.

If you want to remove the isolate environment use the `yarn code reset` or `yarn test reset` scripts
to delete the folders and remove all of the configuration files. Next time you use the `yarn test` or 
`yarn code` commands, it will reinstall a fresh isolated environment.

The Isolated environment has the theme automatically set to blue so that it is visually distinct from
your normal vscode environment.

> #### Note  
> When debugging the scenario tests from VSCode, it has to use the same vscode binary 
> as the debugger instance, so the isolated environment can't be used. 

## Testing
The test architecture has been reorganized and the layout refactored a bit. 

``` yaml
test/                       : the test folder for all the tests
  common/:                  : infrastructure/common code for tests
  scenarios:                : contains a folder for each scenario test
    <SCENARIONAME>:         : a folder for a set of scenario tests 
      assets/               : the folder that contains the workspace files for the test 
                            # if the assets folder contains a '*.code-workspace' file,
                            # the test runner will use that for the workspace otherwise
                            # it will use the assets folder itself as the workspace. 

      tests/                : location of the vscode mocha tests for the scenario
                            # the tests must be in `*.test.ts` files

  unit/                     : low-level unit tests (not in the vscode environment)
                            # the tests must be in `*.test.ts` files
```

To create a new scenario, create a folder in the `scenarios` folder, and add a `assets` and `tests` folder
inside of it. 

### Unit tests 
Unit tests can be run with the vscode Test Explorer (install mocha test explorer to enable it). 
The Test Explorer allows you to debug into the tests as well. 

You can also run the unit tests from the command line (see [`yarn test`](#yarn-test) below)


### Scenario Tests
Scenario tests (which use `@vscode/test-electron`) can be debugged from VSCode, but VSCode requires
that the extension host is the same binary as the debugger, so the isolated environment can't be used.

Selecting the `VSCode Tests` option in the debugger and pressing F5 will prompt for the the scenario to
run the tests for under the debugger. 

> #### Note
> There are a few rough cases where the debugging the extension isn't working quite correctly. In
> `MultiRootDeadlockTests` we are getting a deadlock in the `executeCommand` when the debugger is attached.  
>  
> This is being investigated.

## Scripts
The `package.json` file contains a number of scripts intended to be run via `Yarn`.

A number of the scripts that used to use `gulp` have been extracted and put into the
`.scripts/` folder, and are run directly using `tsnode` -- this makes them easier to 
reuse, and doesn't rely on `gulp` and `gulp` plugins.

More of the scripts will be converted out of `gulp` in the future. 

<hr>

### `yarn scripts`
> #### `yarn scripts` - shows the commands available in the `package.json`
This shows the commands available in the `scripts` section of the `package.json` file along with their definition

<hr>


### `yarn show`
> #### `yarn show` - shows the files in the repository that are untracked and .gitignored
This shows the files in the repository that are not tracked (ie, not in .git) and are 
ignored by `git` This will not show untracked files that are not ignored (ie, new files 
that you could add to the repository)

<hr>

### `yarn clean`

> #### `yarn clean` - cleans out the `dist` files out of the repository.
Removes all of the files in the `dist` folder (where all the compiled .js files are)

> #### `yarn clean all` - cleans all the untracked/ignored files out of the repository except for `node_modules`
Removes all of the `untracked` and `.gitignored` in the repository except for files in the `node_modules` folder.
(this is useful to reset the repository to a clean state, but not have to reinstall all of the dependencies)  
Will not touch any files that could be added to the repo (ie, new .ts files, etc)

> #### `yarn clean reset` - cleans all the untracked/ignored files out of the repository

Removes all of the `untracked` and `.gitignored` in the repository except.
(this is useful to reset the repository to a clean state)  
Will not touch any files that could be added to the repo (ie, new .ts files, etc)
<hr>

### `yarn test`

> `yarn test` - run just the unit tests

The mocha test runner is invoked for the unit tests. This does not use vscode in any way.

> `yarn test all` - run all the tests 

The unit tests are run, and then each of the scenario test sets are run in turn.  
This will install the isolated vscode environment if it is not already installed.

> `yarn test --scenario=<SCENARIONAME>` - run a single set of scenario tests

This will just run the tests for the given scenario. You can pass in the folder name 
(in `test/scenarios` or a full path to a folder with `assets` and `tests`) 

> `yarn test reset` - remove the isolated vscode environment

This will completely remove the isolated vscode environement for this repository, 
including cache, extensions, and configuration for the isolated environment.

> `yarn test install` - install the isolated vscode environment

This installs the isolated vscode environment if it is not currently installed for this 
repository. This is done automatically when running the tests, but can be run manually.

> `yarn test regen` - update the pick lists in `.vscode/launch.json` for any new scenarios.

This adds new entries in the the pick lists in `.vscode/launch.json` to include any new scenarios
that you have added to the `test/scenarios` folder. It will add scenarios that have `assets` and `tests` folders
(and have been compiled at least once). It does not overwrite or update existing entries.

This saves you the effort of having to manually update the launch.json file.


---
### `yarn code`
> #### `yarn code <folder|workspace|scenario>` - run vscode

This runs the isolated vscode environment, with the cpptools extension that is built in this repo

You can treat this essentially like using `code` from the command line. Settings can be configured, and 
extensions can be installed into the isolated environment, and will be persisted across runs.

Use `yarn code reset` to remove the isolated environment and start fresh.

> `yarn code reset` - remove the isolated vscode environment

This will completely remove the isolated vscode environement for this repository, 
including cache, extensions, and configuration for the isolated environment.

> `yarn code install` - install the isolated vscode environment

This installs the isolated vscode environment if it is not currently installed for this 
repository. This is done automatically when running the `yarn code`, but can be run manually.

---
### `yarn generate-native-strings`
> #### `yarn generate-native-strings` - generates the native strings 

This used to generate nativeStrings.ts and localized_string_ids.h from ./src/nativeStrings.json
If adding localized strings to the native side, start by adding it to nativeStrings.json and use this to generate the others.

> #### Note
> The use of the `.scripts/common.ts:write()` function ensures that if the contents don't change the file won't be touched

---
### `yarn generate-options-schema`
> #### `yarn generate-options-schema` - generates teh options schema

Inserts the options schema into `package.json` from the `tools/OptionsSchema.json` and the `tools/VSSymbolSettings.json` file.

> #### Note
> The use of the `.scripts/common.ts:write()` function ensures that if the contents don't change the file won't be touched

---
### `yarn copy-walkthrough-media`
> #### `yarn copy-walkthrough-media` - copies the walkthrough media

This copies the walkthru media into the `dist` folder.

> #### Note
> The use of the `.scripts/common.ts:updateFiles()` function ensures that if the contents don't change the files won't be touched

> #### `yarn copy-walkthrough-media watch` - watches for changes and automatically copies the walkthrough media

This will watch for changes to the walkthru files and automatically copy them across when they change.

---
### `yarn prep`
> #### `yarn prep` - extension preperation

This will call `yarn copy-walkthrough-media`, `yarn generate-native-strings`, `yarn translations-generate` to ensure
that the generated files are up to date.

---
### `yarn import-edge-strings`
> #### `yarn import-edge-strings` - TBD

---
### `yarn lint`
> #### `yarn lint` - lint all the source files (tests, ui, src, and .scripts)

This will lint all the source files and report errors.

> #### `yarn lint --fix` - lint all the source files and auto fix anything it can.

---
### `yarn compile`
> #### `yarn compile` - compile the typescript source code

Runs the typescript compiler on the source code (`test`,`src`,`ui`) and the output is placed in the `dist` folder.

This means we don't use webpack for day-to-day use anymore. 

---
### `yarn compile-ui`
> #### `yarn compile-ui` - compile just the `ui/settings.ts` file 

This will compile just the `ui/settings.ts` file and place it in the `dist` folder.

This is only necessary when packaging the extension, as the `ui/settings.ts` file isn't in the webpack'd output

---
### `yarn watch`
> #### `yarn watch` - compile the source code and watch for changes

Runs the typescript compiler in watch mode on the source code (`test`,`src`,`ui`) and the output is placed in the `dist` folder.

Any changes to the source files will be automatically compiled when saved.

---
### `yarn webpack`
> #### `yarn webpack` - uses webpack to build the extension

This will use webpack to build the extension. This is only necessary when packaging the extension.


---
### `yarn webpack-dev`
> #### `yarn webpack-dev` -  [deprecated?]

---
### `yarn translations-export`
> #### `yarn translations-export` - tba

---
### `yarn translations-generate`
> #### `yarn translations-generate` - tba

---
### `yarn translations-import`
> #### `yarn translations-import` - tba

---
### `yarn postinstall`
> #### `yarn postinstall` - post `yarn install` steps

Installs the vscode `d.ts` files and then runs `yarn prep`


