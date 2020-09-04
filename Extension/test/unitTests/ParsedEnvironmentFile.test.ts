/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
import { Environment, ParsedEnvironmentFile } from '../../src/Debugger/ParsedEnvironmentFile';
import * as assert from 'assert';

// Because the environment variable is set as an array, the index does not matter.
function assertEnvironmentEqual(env: Environment[], name: string, value: string): void {
    let found: boolean = false;
    for (const e of env) {
        if (e.name === name) {
            assert(e.value === value, `Checking if ${e.value} == ${value}`);
            found = true;
            break;
        }
    }
    assert(found, `${name} was not found in env.`);
}

suite("ParsedEnvironmentFile", () => {
    test("Add single variable", () => {
        const content: string = `MyName=VALUE`;
        const fakeConfig: Environment[] = [];
        const result: ParsedEnvironmentFile = ParsedEnvironmentFile.CreateFromContent(content, "TestEnvFileName", fakeConfig["env"]);

        assert(!result.Warning, `Failed to assert that Warning was empty: ${result.Warning}`);
        assertEnvironmentEqual(result.Env, "MyName", "VALUE");
    });

    test("Handle quoted values", () => {
        const content: string = `MyName="VALUE"`;
        const fakeConfig: Environment[] = [];
        const result: ParsedEnvironmentFile = ParsedEnvironmentFile.CreateFromContent(content, "TestEnvFileName", fakeConfig["env"]);

        assert(!result.Warning, `Failed to assert that Warning was empty: ${result.Warning}`);
        assertEnvironmentEqual(result.Env, "MyName", "VALUE");
    });

    test("Handle BOM", () => {
        const content: string = "\uFEFFMyName=VALUE";
        const fakeConfig: Environment[] = [];
        const result: ParsedEnvironmentFile = ParsedEnvironmentFile.CreateFromContent(content, "TestEnvFileName", fakeConfig["env"]);

        assert(!result.Warning, `Failed to assert that Warning was empty: ${result.Warning}`);
        assertEnvironmentEqual(result.Env, "MyName", "VALUE");
    });

    test("Add multiple variables", () => {
        const content: string = `
MyName1=Value1
MyName2=Value2

`;
        const fakeConfig: Environment[] = [];
        const result: ParsedEnvironmentFile = ParsedEnvironmentFile.CreateFromContent(content, "TestEnvFileName", fakeConfig["env"]);

        assert(!result.Warning, `Failed to assert that Warning was empty: ${result.Warning}`);
        assertEnvironmentEqual(result.Env, "MyName1", "Value1");
        assertEnvironmentEqual(result.Env, "MyName2", "Value2");
    });

    test("Update variable", () => {
        const content: string = `
MyName1=Value1
MyName2=Value2

`;
        const initialEnv: Environment[] = [];
        initialEnv.push({name : "MyName1", value: "Value7"});
        initialEnv.push({name : "ThisShouldNotChange", value : "StillHere"});

        const result: ParsedEnvironmentFile = ParsedEnvironmentFile.CreateFromContent(content, "TestEnvFileName", initialEnv);

        assert(!result.Warning, `Failed to assert that Warning was empty: ${result.Warning}`);
        assertEnvironmentEqual(result.Env, "MyName1", "Value1");
        assertEnvironmentEqual(result.Env, "ThisShouldNotChange", "StillHere");
        assertEnvironmentEqual(result.Env, "MyName2", "Value2");
    });

    test("Handle comments", () => {
        const content: string = `# This is an environment file
MyName1=Value1
# This is a comment in the middle of the file
MyName2=Value2
`;
        const fakeConfig: Environment[] = [];
        const result: ParsedEnvironmentFile = ParsedEnvironmentFile.CreateFromContent(content, "TestEnvFileName", fakeConfig["env"]);

        assert(!result.Warning, `Failed to assert that Warning was empty: ${result.Warning}`);
        assertEnvironmentEqual(result.Env, "MyName1", "Value1");
        assertEnvironmentEqual(result.Env, "MyName2", "Value2");
    });

    test("Handle invalid lines", () => {
        const content: string = `
This_Line_Is_Wrong
MyName1=Value1
MyName2=Value2

`;
        const fakeConfig: Environment[] = [];
        const result: ParsedEnvironmentFile = ParsedEnvironmentFile.CreateFromContent(content, "TestEnvFileName", fakeConfig["env"]);

        assert(result.Warning.startsWith("Ignoring non-parseable lines in envFile TestEnvFileName"), 'Checking if warning exists');
        assertEnvironmentEqual(result.Env, "MyName1", "Value1");
        assertEnvironmentEqual(result.Env, "MyName2", "Value2");
    });
});
