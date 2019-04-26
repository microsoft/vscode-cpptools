/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Environment, ParsedEnvironmentFile } from '../../src/Debugger/ParsedEnvironmentFile'
import * as assert from 'assert';

// Because the environment variable is set as an array, the index does not matter.
function AssertEnvironmentEqual(env: Environment[], name: string, value: string) {
    let found: boolean = false;
    for (let e of env)
    {
        if (e.name == name)
        {
            assert(e.value == value, `Checking if ${e.value} == ${value}`);
            found = true;
            break;
        }
    }
    assert(found, `${name} was not found in env.`)
}

suite("ParsedEnvironmentFile", () => {
    test("Add single variable", () => {
        const content = `MyName=VALUE`;
        const fakeConfig : Environment[] = [];
        const result = ParsedEnvironmentFile.CreateFromContent(content, "TestEnvFileName", fakeConfig["env"]);

        assert(result.Warning == null, `Failed to assert that Warning was empty: ${result.Warning}`);
        AssertEnvironmentEqual(result.Env, "MyName", "VALUE");
    });

    test("Handle quoted values", () => {
        const content = `MyName="VALUE"`;
        const fakeConfig : Environment[] = [];
        const result = ParsedEnvironmentFile.CreateFromContent(content, "TestEnvFileName", fakeConfig["env"]);

        assert(result.Warning == null, `Failed to assert that Warning was empty: ${result.Warning}`);
        AssertEnvironmentEqual(result.Env, "MyName", "VALUE");
    });

    test("Handle BOM", () => {
        const content = "\uFEFFMyName=VALUE";
        const fakeConfig : Environment[] = [];
        const result = ParsedEnvironmentFile.CreateFromContent(content, "TestEnvFileName", fakeConfig["env"]);

        assert(result.Warning == null, `Failed to assert that Warning was empty: ${result.Warning}`);
        AssertEnvironmentEqual(result.Env, "MyName", "VALUE");
    });

    test("Add multiple variables", () => {
        const content = `
MyName1=Value1
MyName2=Value2

`;
        const fakeConfig : Environment[] = [];
        const result = ParsedEnvironmentFile.CreateFromContent(content, "TestEnvFileName", fakeConfig["env"]);

        assert(result.Warning == null, `Failed to assert that Warning was empty: ${result.Warning}`);
        AssertEnvironmentEqual(result.Env, "MyName1", "Value1");
        AssertEnvironmentEqual(result.Env, "MyName2", "Value2");
    });

    test("Update variable", () => {
        const content = `
MyName1=Value1
MyName2=Value2

`;
        const initialEnv : Environment[] = [];
        initialEnv.push({name : "MyName1", value: "Value7"});
        initialEnv.push({name : "ThisShouldNotChange", value : "StillHere"});
        
        const result = ParsedEnvironmentFile.CreateFromContent(content, "TestEnvFileName", initialEnv);

        assert(result.Warning == null, `Failed to assert that Warning was empty: ${result.Warning}`);
        AssertEnvironmentEqual(result.Env, "MyName1", "Value1");
        AssertEnvironmentEqual(result.Env, "ThisShouldNotChange", "StillHere");
        AssertEnvironmentEqual(result.Env, "MyName2", "Value2");
    });

    test("Handle comments", () => {
        const content = `# This is an environment file    
MyName1=Value1
# This is a comment in the middle of the file
MyName2=Value2
`;
        const fakeConfig : Environment[] = [];
        const result = ParsedEnvironmentFile.CreateFromContent(content, "TestEnvFileName", fakeConfig["env"]);

        assert(result.Warning == null, `Failed to assert that Warning was empty: ${result.Warning}`);
        AssertEnvironmentEqual(result.Env, "MyName1", "Value1");
        AssertEnvironmentEqual(result.Env, "MyName2", "Value2");
    });
    
    test("Handle invalid lines", () => {
        const content = `
This_Line_Is_Wrong
MyName1=Value1
MyName2=Value2

`;
        const fakeConfig : Environment[] = [];
        const result = ParsedEnvironmentFile.CreateFromContent(content, "TestEnvFileName", fakeConfig["env"]);

        assert(result.Warning.startsWith("Ignoring non-parseable lines in envFile TestEnvFileName"), 'Checking if warning exists');
        AssertEnvironmentEqual(result.Env, "MyName1", "Value1");
        AssertEnvironmentEqual(result.Env, "MyName2", "Value2");
    });
});