# Developer Documentation

## Table of Contents
- [Table of Contents](#table-of-contents)
- [Setup](#setup)
    - [Required Tools](#required-tools)
    - [Setting up the repository](#setting-up-the-repository)
- [Building the Extension](#building-the-extension)
    - [When using F5 Debug](#when-using-f5-debug)
    - [From Inside VS Code](#from-inside-vs-code)
    - [From Command line](#from-command-line)
- [Use of an isolated VS Code environment](#use-of-an-isolated-vs-code-environment)
- [Testing](#testing)
    - [Unit tests](#unit-tests)
    - [Scenario Tests](#scenario-tests)
- [Scripts](#scripts)
    - [`yarn scripts`](#yarn-scripts)
    - [`yarn show`](#yarn-show)
    - [`yarn clean`](#yarn-clean)
    - [`yarn test`](#yarn-test)
    - [`yarn code`](#yarn-code)
    - [`yarn generate-native-strings`](#yarn-generate-native-strings)
    - [`yarn generate-options-schema`](#yarn-generate-options-schema)
    - [`yarn copy-walkthrough-media`](#yarn-copy-walkthrough-media)
    - [`yarn prep`](#yarn-prep)
    - [`yarn lint`](#yarn-lint)
    - [`yarn compile`](#yarn-compile)
    - [`yarn watch`](#yarn-watch)
    - [`yarn verify`](#yarn-verify)
    - [`yarn webpack`](#yarn-webpack)
    - [`yarn install`](#yarn-install)

## Setup

### Required Tools 

* [Node.js](https://nodejs.org/en/download/) v16.*
* Yarn - use `npm install -g yarn` to install

### Setting up the repository

`git clone https://github.com/microsoft/vscode-cpptools.git`

`yarn install`

It's also good practice to run `yarn install` after merging from upstream or switching branches. 

## Building the Extension

### When using F5 Debug 
The `launch.json` entries now specify a `preLaunchTask` that will build the extension before launching using 
the `yarn watch` command, and will wait until the build is ready. The watch command will continue to watch from 
that point.

If the extension is already built, the the watch will be very quick.

### From Inside VS Code
There are two tasks that can be run from inside VS Code to build the extension.

When you select `ctrl-shift-b` - there is a `Compile` task and a `Watch` task. 

During regular development, you probably want to use the `Watch` task as it will 
compile changed files as you save them.



### From Command line
To build the extension from the command line, use the [`yarn compile`](#yarn-compile) command, or 
[`yarn watch`](#yarn-watch) to watch for changes and recompile as needed.

<hr>

## Use of an isolated VS Code environment
The scripts for this repository now support running VS Code and the extension in a 
completely isolated environment (separate install of VS Code, private extensions and 
user folders, etc). 

The scripts that install VS Code place it in a `$ENV:TMP/.vscode-test/<UID>` folder where
`<UID>` is a has calculated from the extension folder (this permits multiple checkouts of 
the source repository and each gets it's own isolated environment).

The [`test scripts`](#yarn-test) will automatically install and use this isolated environment.

You can invoke VS Code from the command line using the [`yarn code`](#yarn-code) script.

If you want to remove the isolate environment use the `yarn code reset` or `yarn test reset` scripts
to delete the folders and remove all of the configuration files. Next time you use the `yarn test` or 
`yarn code` commands, it will reinstall a fresh isolated environment.

The Isolated environment has the theme automatically set to blue so that it is visually distinct from
your normal VS Code environment.

> #### Note  
> When debugging the scenario tests from VS Code, it has to use the same VS Code binary 
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

      tests/                : location of the VS Code mocha tests for the scenario
                            # the tests must be in `*.test.ts` files

  unit/                     : low-level unit tests (not in the VS Code environment)
                            # the tests must be in `*.test.ts` files
```

To create a new scenario, create a folder in the `scenarios` folder, and add a `assets` and `tests` folder
inside of it. 

### Unit tests 
Unit tests can be run with the VS Code Test Explorer (install mocha test explorer to enable it). 
The Test Explorer allows you to debug into the tests as well. 

You can also run the unit tests from the command line (see [`yarn test`](#yarn-test) below)


### Scenario Tests
Scenario tests (which use `@vscode/test-electron`) can be debugged from VS Code, but VS Code requires
that the extension host is the same binary as the debugger, so the isolated environment can't be used.

Selecting the `VS Code Tests` option in the debugger and pressing F5 will prompt for the the scenario to
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
This shows the files in the repository that are not tracked (i.e. not in .git) and are 
ignored by `git` This will not show untracked files that are not ignored (i.e. new files 
that you could add to the repository)

> #### `yarn show new` - shows new files that are not git ignored
This shows the files in the repository that are not tracked and are not
ignored by `git`.


<hr>

### `yarn clean`

> #### `yarn clean` - cleans out the `dist` files out of the repository.
Removes all of the files in the `dist` folder (where all the compiled .js files are)

> #### `yarn clean all` - cleans all the untracked/ignored files out of the repository except for `node_modules`
Removes all of the `untracked` and `.gitignored` in the repository except for files in the `node_modules` folder.
(this is useful to reset the repository to a clean state, but not have to reinstall all of the dependencies)  
Will not touch any files that could be added to the repo (i.e. new .ts files, etc)

> #### `yarn clean reset` - cleans all the untracked/ignored files out of the repository

Removes all of the `untracked` and `.gitignored` in the repository except.
(this is useful to reset the repository to a clean state)  
Will not touch any files that could be added to the repo (i.e. new .ts files, etc)
<hr>

### `yarn test`

> `yarn test` - run just the unit tests

The mocha test runner is invoked for the unit tests. This does not use VS Code in any way.

> `yarn test all` - run all the tests 

The unit tests are run, and then each of the scenario test sets are run in turn.  
This will install the isolated VS Code environment if it is not already installed.

> `yarn test --scenario=<SCENARIONAME>` - run a single set of scenario tests  
> `yarn test <SCENARIONAME>` - run a single set of scenario tests

This will just run the tests for the given scenario. You can pass in the folder name 
(in `test/scenarios` or a full path to a folder with `assets` and `tests`) 

> `yarn test reset` - remove the isolated VS Code environment

This will completely remove the isolated VS Code environment for this repository, 
including cache, extensions, and configuration for the isolated environment.

> `yarn test install` - install the isolated VS Code environment

This installs the isolated VS Code environment if it is not currently installed for this 
repository. This is done automatically when running the tests, but can be run manually.

> `yarn test regen` - update the pick lists in `.vscode/launch.json` for any new scenarios.

This adds new entries in the the pick lists in `.vscode/launch.json` to include any new scenarios
that you have added to the `test/scenarios` folder. It will add scenarios that have `assets` and `tests` folders
(and have been compiled at least once). It does not overwrite or update existing entries.

This saves you the effort of having to manually update the launch.json file.


---
### `yarn code`
> #### `yarn code <folder|workspace|scenario>` - run VS Code

This runs the isolated VS Code environment, with the cpptools extension that is built in this repo

You can treat this essentially like using `code` from the command line. Settings can be configured, and 
extensions can be installed into the isolated environment, and will be persisted across runs.

Use `yarn code reset` to remove the isolated environment and start fresh.

> `yarn code reset` - remove the isolated VS Code environment

This will completely remove the isolated VS Code environment for this repository, 
including cache, extensions, and configuration for the isolated environment.

> `yarn code install` - install the isolated VS Code environment

This installs the isolated VS Code environment if it is not currently installed for this 
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
> #### `yarn generate-options-schema` - generates the options schema

Inserts the options schema into `package.json` from the `tools/OptionsSchema.json` and the `tools/VSSymbolSettings.json` file.

> #### Note
> The use of the `.scripts/common.ts:write()` function ensures that if the contents don't change the file won't be touched

---
### `yarn copy-walkthrough-media`
> #### `yarn copy-walkthrough-media` - copies the walkthrough media

This copies the walkthrough media into the `dist` folder.

> #### Note
> The use of the `.scripts/common.ts:updateFiles()` function ensures that if the contents don't change the files won't be touched

> #### `yarn copy-walkthrough-media watch` - watches for changes and automatically copies the walkthrough media

This will watch for changes to the walkthrough files and automatically copy them across when they change.

---
### `yarn prep`
> #### `yarn prep` - extension preparation

This will call `yarn copy-walkthrough-media`, `yarn generate-native-strings`, `yarn translations-generate` to ensure
that the generated files are up to date.

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

This will also verify that the repository is prepped and tries to prep it if it's not.

---
### `yarn watch`
> #### `yarn watch` - compile the source code and watch for changes

Runs the typescript compiler in watch mode on the source code (`test`,`src`,`ui`) and the output is placed in the `dist` folder.

Any changes to the source files will be automatically compiled when saved.

This will also verify that the repository is prepped and tries to prep it if it's not.

---

### `yarn verify`
> #### `yarn verify [--verbose]` - verifies that the repository is built correctly

Checks for the presence of the compiled files and the prepped files (see [`yarn verify prep`](#yarn-verify))
(no output unless it fails)
> #### `yarn verify prep [--verbose]` - verifies that the repository has been prepped to build

Checks for the presence of the generated loc files and other files that are necessary to build.
(no output unless it fails)

---


### `yarn webpack`
> #### `yarn webpack` - uses webpack to build the extension

This will use webpack to build the extension. This is only necessary when packaging the extension.


---
### `yarn install`
> #### `yarn install` - post `yarn install` steps (runs the `postinstall` script)

Installs the VS Code `*.d.ts` files and then runs `yarn prep`

You should run `yarn install` after merging from upstream or switching branches. 
