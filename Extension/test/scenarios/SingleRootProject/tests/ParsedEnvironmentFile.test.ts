/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
import * as assert from 'assert';
import { Environment, ParsedEnvironmentFile } from '../../../../src/Debugger/ParsedEnvironmentFile';

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
        const result: ParsedEnvironmentFile = ParsedEnvironmentFile.CreateFromContent(content, "TestEnvFileName", []);

        assert(!result.Warning, `Failed to assert that Warning was empty: ${result.Warning}`);
        assertEnvironmentEqual(result.Env, "MyName", "VALUE");
    });

    test("Handle quoted values", () => {
        const content: string = `MyName="VALUE"`;
        const result: ParsedEnvironmentFile = ParsedEnvironmentFile.CreateFromContent(content, "TestEnvFileName", []);

        assert(!result.Warning, `Failed to assert that Warning was empty: ${result.Warning}`);
        assertEnvironmentEqual(result.Env, "MyName", "VALUE");
    });

    test("Handle BOM", () => {
        const content: string = "\uFEFFMyName=VALUE";
        const result: ParsedEnvironmentFile = ParsedEnvironmentFile.CreateFromContent(content, "TestEnvFileName", []);

        assert(!result.Warning, `Failed to assert that Warning was empty: ${result.Warning}`);
        assertEnvironmentEqual(result.Env, "MyName", "VALUE");
    });

    test("Add multiple variables", () => {
        const content: string = `
MyName1=Value1
MyName2=Value2

`;
        const result: ParsedEnvironmentFile = ParsedEnvironmentFile.CreateFromContent(content, "TestEnvFileName", []);

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
        initialEnv.push({ name: "MyName1", value: "Value7" });
        initialEnv.push({ name: "ThisShouldNotChange", value: "StillHere" });

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
        const result: ParsedEnvironmentFile = ParsedEnvironmentFile.CreateFromContent(content, "TestEnvFileName", []);

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
        const result: ParsedEnvironmentFile = ParsedEnvironmentFile.CreateFromContent(content, "TestEnvFileName", []);

        assert(result.Warning && result.Warning.startsWith("Ignoring non-parsable lines in envFile TestEnvFileName"), 'Checking if warning exists');
        assertEnvironmentEqual(result.Env, "MyName1", "Value1");
        assertEnvironmentEqual(result.Env, "MyName2", "Value2");
    });

    test("Resolve a reference to a variable defined earlier in the file", () => {
        const content: string = `USER=admin
EMAIL=\${USER}@example.org`;
        const result: ParsedEnvironmentFile = ParsedEnvironmentFile.CreateFromContent(content, "TestEnvFileName", []);

        assert(!result.Warning, `Failed to assert that Warning was empty: ${result.Warning}`);
        assertEnvironmentEqual(result.Env, "USER", "admin");
        assertEnvironmentEqual(result.Env, "EMAIL", "admin@example.org");
    });

    test("Resolve a reference from the initial environment", () => {
        const initialEnv: Environment[] = [{ name: "USER", value: "admin" }];
        const content: string = `EMAIL=\${USER}@example.org`;
        const result: ParsedEnvironmentFile = ParsedEnvironmentFile.CreateFromContent(content, "TestEnvFileName", initialEnv);

        assert(!result.Warning, `Failed to assert that Warning was empty: ${result.Warning}`);
        assertEnvironmentEqual(result.Env, "EMAIL", "admin@example.org");
    });

    test("Leave an unknown reference untouched", () => {
        const content: string = `EMAIL=\${UNKNOWN_USER}@example.org`;
        const result: ParsedEnvironmentFile = ParsedEnvironmentFile.CreateFromContent(content, "TestEnvFileName", []);

        assert(!result.Warning, `Failed to assert that Warning was empty: ${result.Warning}`);
        assertEnvironmentEqual(result.Env, "EMAIL", "${UNKNOWN_USER}@example.org");
    });

    test("Resolve a reference from the process environment", () => {
        const name: string = "CPPTOOLS_ENVFILE_INTERPOLATION_TEST";
        const previous: string | undefined = process.env[name];
        process.env[name] = "from-process";
        try {
            const content: string = `EMAIL=\${${name}}@example.org`;
            const result: ParsedEnvironmentFile = ParsedEnvironmentFile.CreateFromContent(content, "TestEnvFileName", []);

            assert(!result.Warning, `Failed to assert that Warning was empty: ${result.Warning}`);
            assertEnvironmentEqual(result.Env, "EMAIL", "from-process@example.org");
        } finally {
            if (previous === undefined) {
                delete process.env[name];
            } else {
                process.env[name] = previous;
            }
        }
    });

    test("Protect a reference inside a single-quoted value from the launch expansion", () => {
        const content: string = `USER=admin\nEMAIL='\${USER}@example.org'`;
        const result: ParsedEnvironmentFile = ParsedEnvironmentFile.CreateFromContent(content, "TestEnvFileName", []);

        assert(!result.Warning, `Failed to assert that Warning was empty: ${result.Warning}`);
        // ${dollar} is the one form expandAllStrings leaves alone, and it collapses to a plain $
        // when that expansion finishes (expand.ts), so the debuggee still receives the literal.
        assertEnvironmentEqual(result.Env, "EMAIL", "${dollar}{USER}@example.org");
    });

    test("Protect an escaped reference the same way, without the backslash", () => {
        const content: string = `USER=admin\nEMAIL=\\\${USER}@example.org`;
        const result: ParsedEnvironmentFile = ParsedEnvironmentFile.CreateFromContent(content, "TestEnvFileName", []);

        assert(!result.Warning, `Failed to assert that Warning was empty: ${result.Warning}`);
        assertEnvironmentEqual(result.Env, "EMAIL", "${dollar}{USER}@example.org");
    });

    test("Protect a launch reference inside a single-quoted value", () => {
        // ${env:...} and ${command:...} are matched on anything up to the closing brace, so a
        // dotenv-style name filter would let them through and the launch expansion would
        // substitute (or run) them even though the value is single-quoted.
        const content: string = `HOME_DIR='\${env:HOME}'\nCMD='\${command:workbench.action.files.newUntitledFile}'`;
        const result: ParsedEnvironmentFile = ParsedEnvironmentFile.CreateFromContent(content, "TestEnvFileName", []);

        assert(!result.Warning, `Failed to assert that Warning was empty: ${result.Warning}`);
        assertEnvironmentEqual(result.Env, "HOME_DIR", "${dollar}{env:HOME}");
        assertEnvironmentEqual(result.Env, "CMD", "${dollar}{command:workbench.action.files.newUntitledFile}");
    });

    test("Protect an escaped launch reference, without the backslash", () => {
        const content: string = `HOME_DIR=\\\${env:HOME}`;
        const result: ParsedEnvironmentFile = ParsedEnvironmentFile.CreateFromContent(content, "TestEnvFileName", []);

        assert(!result.Warning, `Failed to assert that Warning was empty: ${result.Warning}`);
        assertEnvironmentEqual(result.Env, "HOME_DIR", "${dollar}{env:HOME}");
    });

    test("Leave an unescaped launch reference bare for the expansion", () => {
        const content: string = `HOME_DIR=\${env:HOME}`;
        const result: ParsedEnvironmentFile = ParsedEnvironmentFile.CreateFromContent(content, "TestEnvFileName", []);

        assert(!result.Warning, `Failed to assert that Warning was empty: ${result.Warning}`);
        assertEnvironmentEqual(result.Env, "HOME_DIR", "${env:HOME}");
    });

    test("Leave a resolved reference bare, so the expansion can still see it", () => {
        const content: string = `USER=admin\nEMAIL=\${USER}@example.org`;
        const result: ParsedEnvironmentFile = ParsedEnvironmentFile.CreateFromContent(content, "TestEnvFileName", []);

        assert(!result.Warning, `Failed to assert that Warning was empty: ${result.Warning}`);
        assertEnvironmentEqual(result.Env, "EMAIL", "admin@example.org");
    });

    test("Keep the separator before a reference in a Windows path", () => {
        // The backslash in front of ${ here separates path segments, it does not escape the
        // reference. Dropping it turned C:\Users\Alice\project into C:\Users${env:USERNAME}.
        const content: string = `USER_DIR=C:\\Users\\\${env:USERNAME}\\project`;
        const result: ParsedEnvironmentFile = ParsedEnvironmentFile.CreateFromContent(content, "TestEnvFileName", []);

        assert(!result.Warning, `Failed to assert that Warning was empty: ${result.Warning}`);
        assertEnvironmentEqual(result.Env, "USER_DIR", "C:\\Users\\${env:USERNAME}\\project");
    });

    test("Match an initial environment name regardless of case on Windows", () => {
        // Path and PATH are the same variable on Windows, and the launch configuration may use
        // either spelling. Elsewhere the reference stays bare for the launch expansion.
        const content: string = `COPY=\${PATH}`;
        const result: ParsedEnvironmentFile = ParsedEnvironmentFile.CreateFromContent(
            content, "TestEnvFileName", [{ name: "Path", value: "C:\\override" }]);

        const expected: string = process.platform === "win32" ? "C:\\override" : "${PATH}";
        assert(!result.Warning, `Failed to assert that Warning was empty: ${result.Warning}`);
        assertEnvironmentEqual(result.Env, "COPY", expected);
    });
});
