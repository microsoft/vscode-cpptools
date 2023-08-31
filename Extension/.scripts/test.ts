/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */

import { runTests } from '@vscode/test-electron';
import { spawnSync } from 'child_process';
import { CommentArray, CommentObject } from 'comment-json';
import { readdir } from 'fs/promises';
import { resolve } from 'path';
import { env } from 'process';
import { returns } from '../src/Utility/Async/returns';
import { filepath } from '../src/Utility/Filesystem/filepath';
import { is } from '../src/Utility/System/guards';
import { verbose } from '../src/Utility/Text/streams';
import { getTestInfo } from '../test/common/selectTests';
import { $args, $root, $scenario, assertAnyFile, assertAnyFolder, brightGreen, checkBinaries, cmdSwitch, cyan, error, gray, green, readJson, red, writeJson } from './common';
import { install, isolated, options } from './vscode';

export { install, reset } from './vscode';

const sowrite = process.stdout.write.bind(process.stdout) as (...args: unknown[]) => boolean;
const sewrite = process.stderr.write.bind(process.stderr) as (...args: unknown[]) => boolean;

const filters = [
    /^\[(.*)\].*/,
    /^Unexpected token A/,
    /Cannot register 'cmake.cmakePath'/,
    /\[DEP0005\] DeprecationWarning/,
    /--trace-deprecation/,
    /Iconv-lite warning/,
    /^Extension '/,
    /^Found existing install/
];

// remove unwanted messages from stdio
function filterStdio() {
    process.stdout.write = function (...args: unknown[]) {
        if (typeof args[0] === 'string') {
            const text = args[0];

            if (filters.some(each => text.match(each))) {
                return true;
            }
        }
        if (args[0] instanceof Buffer) {
            const text = args[0].toString();
            if (filters.some(each => text.match(each))) {
                return true;
            }
        }
        return sowrite(...args);
    };

    process.stderr.write = function (...args: unknown[]) {
        if (typeof args[0] === 'string') {
            const text = args[0];

            if (filters.some(each => text.match(each))) {
                return true;
            }
        }
        if (args[0] instanceof Buffer) {
            const text = args[0].toString();
            if (filters.some(each => text.match(each))) {
                return true;
            }
        }
        return sewrite(...args);
    };
}

filterStdio();

async function unitTests() {
    await assertAnyFolder('dist/test/unit', `The folder '${$root}/dist/test/unit is missing. You should run ${brightGreen("yarn compile")}\n\n`);
    const mocha = await assertAnyFile(["node_modules/.bin/mocha.cmd", "node_modules/.bin/mocha"], `Can't find the mocha testrunner. You might need to run ${brightGreen("yarn install")}\n\n`);
    const result = spawnSync(mocha, [`${$root}/dist/test/unit/**/*.test.js`, '--timeout', '30000'], { stdio:'inherit'});
    verbose(`\n${green("NOTE:")} If you want to run a scenario test (end-to-end) use ${cmdSwitch('scenario=<NAME>')} \n\n`);
    return result.status;
}

async function scenarioTests(assets: string, name: string, workspace: string) {
    if (await checkBinaries()) {
        process.exit(1);
    }
    return runTests({
        ...options,
        extensionDevelopmentPath: $root,
        extensionTestsPath: resolve($root, 'dist/test/common/selectTests'),
        launchArgs: workspace ? [...options.launchArgs, workspace] : options.launchArgs,
        extensionTestsEnv: {
            SCENARIO: assets
        }
    });
}

export async function main() {
    await assertAnyFolder('dist/test/', `The folder '${$root}/dist/test is missing. You should run ${brightGreen("yarn compile")}\n\n`);
    const arg = $args.find(each => !each.startsWith("--"));
    const specifiedScenario = $scenario || env.SCENARIO || await getScenarioFolder(arg);
    const testInfo = await getTestInfo(specifiedScenario);

    if (!testInfo) {
        if (arg) {
            return error(`Could not find scenario ${arg}`);
        }
        // lets just run the unit tests
        process.exit(await unitTests());
    }

    // at this point, we're going to run some vscode tests
    if (!await filepath.isFolder(isolated)) {
        await install();
    }
    process.exit(await scenarioTests(testInfo.assets, testInfo.name, testInfo.workspace));
}

export async function all() {
    if (await checkBinaries()) {
        process.exit(1);
    }
    const finished: string[] = [];

    if (await unitTests() !== 0) {
        console.log(`${cyan("  UNIT TESTS: ")}${red("failed")}`);
        process.exit(1);
    }
    finished.push(`${cyan("  UNIT TESTS: ")}${green("success")}`);

    // at this point, we're going to run some vscode tests
    if (!await filepath.isFolder(isolated)) {
        await install();
    }
    try {
        const scenarios = await getScenarioNames();
        for (const each of scenarios) {
            if (await filepath.isFolder(`${$root}/test/scenarios/${each}/tests`)) {
                const ti = await getTestInfo(each);

                if (ti) {
                    console.log(`\n\nRunning scenario ${each}`);
                    const result = await scenarioTests(ti.assets, ti.name, ti.workspace);
                    if (result) {
                        console.log(finished.join('\n'));
                        console.log(`  ${cyan(`${ti.name} Tests:`)}${red("failed")}`);
                        process.exit(result);
                    }
                    finished.push(`  ${cyan(`${ti.name} Tests:`)}${green("success")}`);
                }
            }
        }
    } catch (e) {
        error(e);
    } finally {
        console.log(finished.join('\n'));
    }
}

interface Input {
    id: string;
    type: string;
    description: string;
    options: CommentArray<{label: string; value: string}>;
}

export async function getScenarioNames() {
    return (await readdir(`${$root}/test/scenarios`).catch(returns.none)).filter(each => each !== 'Debugger');
}

export async function getScenarioFolder(scenarioName: string) {
    return scenarioName ? resolve(`${$root}/test/scenarios/${(await getScenarioNames()).find(each => each.toLowerCase() === scenarioName.toLowerCase())}`) : undefined;
}

export async function list() {
    console.log(`\n${cyan("Scenarios: ")}\n`);
    const names = await getScenarioNames();
    const max = names.reduce((max, each) => Math.max(max, each), 0);
    for (const each of names) {
        console.log(`  ${green(each.padEnd(max))}: ${gray(await getScenarioFolder(each))}`);
    }
}

export async function regen() {
    // update the .vscode/launch.json file with the scenarios
    const scenarios = await getScenarioNames();
    const launch = await readJson(`${$root}/.vscode/launch.json`) as CommentObject;
    if (!is.object(launch)) {
        return error(`The file ${$root}/.vscode/launch.json is not valid json`);
    }
    if (!is.array(launch.inputs)) {
        return error(`The file ${$root}/.vscode/launch.json is missing the 'inputs' array`);
    }

    const inputs = launch.inputs as unknown as CommentArray<Input>;
    const pickScenario = inputs.find(each => each.id === 'pickScenario');
    if (!pickScenario) {
        return error(`The file ${$root}/.vscode/launch.json is missing the 'pickScenario' input`);
    }
    const pickWorkspace = inputs.find(each => each.id === 'pickWorkspace');
    if (!pickWorkspace) {
        return error(`The file ${$root}/.vscode/launch.json is missing the 'pickWorkspace' input`);
    }

    for (const scenarioFolder of scenarios) {

        const prefix = $root.replace(/\\/g, '/');

        if (await filepath.isFolder(`${$root}/test/scenarios/${scenarioFolder}/tests`)) {
            const testInfo = await getTestInfo(scenarioFolder);
            if (testInfo) {
                const label = `${scenarioFolder}   `;
                const value = testInfo.workspace.replace(/\\/g, '/').replace(prefix, '${workspaceFolder}');

                const scenario = pickScenario.options.find(s => s.label === label);
                if (!scenario) {
                    console.log(`Adding scenario ${green(scenarioFolder)} to pickScenario`);
                    pickScenario.options.push({ label, value });
                } else {
                    verbose(`Skipping scenario ${scenarioFolder} because it already exists`);
                }

                const wrkspace = pickWorkspace.options.find(s => s.label === label);
                if (!wrkspace) {
                    console.log(`Adding workspace ${green(scenarioFolder)} to pickWorkspace`);
                    pickWorkspace.options.push({ label, value });
                } else {
                    verbose(`Skipping workspace ${scenarioFolder} because it already exists`);
                }
            } else {
                verbose(`Skipping scenario ${scenarioFolder} because it doesn't look like there are any tests. (maybe try and run ${brightGreen("yarn compile")})`);
            }
        }
    }
    await writeJson(`${$root}/.vscode/launch.json`, launch);
}
