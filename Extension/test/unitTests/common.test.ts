/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
import * as assert from "assert";
import * as os from "os";
import { envDelimiter, resolveVariables, escapeForSquiggles, normalizeArg } from "../../src/common";

suite("Common Utility validation", () => {
    suite("resolveVariables", () => {
        const success: string = "success";
        const home: string = os.homedir();

        test("raw input", () => {
            const input: string = "test";
            inputAndEnvironment(input, {})
                .shouldResolveTo(input);
        });

        test("raw input with tilde", () => {
            inputAndEnvironment("~/test", {})
                .shouldResolveTo(`${home}/test`);
        });

        test("env input with tilde", () => {
            inputAndEnvironment("${path}/test", {
                path: home
            })
                .shouldResolveTo(`${home}/test`);
        });

        test("solo env input resulting in array", () => {
            inputAndEnvironment("${test}", {
                test: ["foo", "bar"]
            })
                .shouldResolveTo(`foo${envDelimiter}bar`);
        });

        test("solo env input with empty array env value", () => {
            resolveVariablesWithInput("${empty}")
                .withEnvironment({
                    empty: []
                })
                .shouldResolveTo("");
        });

        test("mixed raw and env input resulting in array", () => {
            const input: string = "baz${test}";
            resolveVariablesWithInput(input)
                .withEnvironment({
                    test: ["foo", "bar"]
                })
                .shouldResolveTo(input);
        });

        test("solo env input not in env config finds process env", () => {
            const processKey: string = `cpptoolstests_${Date.now()}`;
            const input: string = "foo${" + processKey + "}";
            let actual: string;
            try {
                process.env[processKey] = "bar";
                actual = resolveVariables(input, {});
            } finally {
                delete process.env[processKey];
            }
            assert.equal(actual, "foobar");
        });

        test("env input", () => {
            resolveVariablesWithInput("${test}")
                .withEnvironment({
                    "test": success
                })
                .shouldResolveTo(success);
        });

        test("env input mixed with plain text", () => {
            resolveVariablesWithInput("${test}bar")
                .withEnvironment({
                    "test": "foo"
                })
                .shouldResolveTo("foobar");
        });

        test("env input with two variables", () => {
            resolveVariablesWithInput("f${a}${b}r")
                .withEnvironment({
                    a: "oo",
                    b: "ba"
                })
                .shouldResolveTo("foobar");
        });

        test("env input not in env", () => {
            const input: string = "${test}";
            resolveVariablesWithInput(input)
                .withEnvironment({})
                .shouldResolveTo(input);
        });

        test("env with macro inside environment definition", () => {
            resolveVariablesWithInput("${arm6.include}")
                .withEnvironment({
                    "envRoot": "apps/tool/buildenv",
                    "arm6.include": "${envRoot}/arm6/include"
                })
                .shouldResolveTo("apps/tool/buildenv/arm6/include");
        });

        test("env nested with half open variable", () => {
            resolveVariablesWithInput("${arm6.include}")
                .withEnvironment({
                    "envRoot": "apps/tool/buildenv",
                    "arm6.include": "${envRoot/arm6/include"
                })
                .shouldResolveTo("${envRoot/arm6/include");
        });

        test("env nested with half closed variable", () => {
            resolveVariablesWithInput("${arm6.include}")
                .withEnvironment({
                    "envRoot": "apps/tool/buildenv",
                    "arm6.include": "envRoot}/arm6/include"
                })
                .shouldResolveTo("envRoot}/arm6/include");
        });

        test("env nested with a cycle", () => {
            resolveVariablesWithInput("${a}")
                .withEnvironment({
                    "a": "${b}",
                    "b": "${c}",
                    "c": "${a}"
                })
                .shouldResolveTo("${a}");
        });

        test("env input with 1 level of nested variables anchored at end", () => {
            resolveVariablesWithInput("${foo${test}}")
                .withEnvironment({
                    "foobar": success,
                    "test": "bar"
                })
                .shouldResolveTo("${foo${test}}");
        });

        test("env input with 1 level of nested variables anchored in the middle", () => {
            resolveVariablesWithInput("${f${test}r}")
                .withEnvironment({
                    "foobar": success,
                    "test": "ooba"
                })
                .shouldResolveTo("${f${test}r}");
        });

        test("env input with 1 level of nested variable anchored at front", () => {
            resolveVariablesWithInput("${${test}bar}")
                .withEnvironment({
                    "foobar": success,
                    "test": "foo"
                })
                .shouldResolveTo("${${test}bar}");
        });

        test("env input with 3 levels of nested variables", () => {
            resolveVariablesWithInput("${foo${a${b${c}}}}")
                .withEnvironment({
                    "foobar": success,
                    "a1": "bar",
                    "b2": "1",
                    "c": "2"
                })
                .shouldResolveTo("${foo${a${b${c}}}}");
        });

        test("env input contains env", () => {
            resolveVariablesWithInput("${envRoot}")
                .shouldLookupSymbol("envRoot");
        });

        test("env input contains config", () => {
            resolveVariablesWithInput("${configRoot}")
                .shouldLookupSymbol("configRoot");
        });

        test("env input contains workspaceFolder", () => {
            resolveVariablesWithInput("${workspaceFolderRoot}")
                .shouldLookupSymbol("workspaceFolderRoot");
        });

        test("input contains env.", () => {
            resolveVariablesWithInput("${env.Root}")
                .shouldLookupSymbol("Root");
        });

        test("input contains env:", () => {
            resolveVariablesWithInput("${env:Root}")
                .shouldLookupSymbol("Root");
        });

        test("escapeForSquiggles:", () => {
            const testEscapeForSquigglesScenario: any = (input: string, expectedOutput: string) => {
                const result: string = escapeForSquiggles(input);
                if (result !== expectedOutput) {
                    throw new Error(`escapeForSquiggles failure: for \"${input}\", \"${result}\" !== \"${expectedOutput}\"`);
                }
            };

            testEscapeForSquigglesScenario("\\", "\\\\"); // single backslash
            testEscapeForSquigglesScenario("\\\"", "\\\""); // escaped quote
            testEscapeForSquigglesScenario("\\\t", "\\\\\t"); // escaped non-quote
            testEscapeForSquigglesScenario("\\\\\"", "\\\\\\\\\""); // escaped backslash, unescaped quote
            testEscapeForSquigglesScenario("\\\\\t", "\\\\\\\\\t"); // escaped backslash, unescaped non-quote
            testEscapeForSquigglesScenario("\\t", "\\\\t"); // escaped non-quote
            testEscapeForSquigglesScenario("\\\\\\t", "\\\\\\\\\\\\t"); // escaped backslash, unescaped non-quote
            testEscapeForSquigglesScenario("\"\"", "\"\""); // empty quoted string
            testEscapeForSquigglesScenario("\"\\\\\"", "\"\\\\\\\\\""); // quoted string containing escaped backslash
        });

        test("normalizeArgs:", () => {
            const testNormalizeArgsScenario: any = (input: string, expectedOutput: string) => {
                const result: string = normalizeArg(input);
                if (result !== expectedOutput) {
                    throw new Error(`normalizeArgs failure: for \"${input}\", \"${result}\" !== \"${expectedOutput}\"`);
                }
            };
            /*
            this is how the args from tasks.json will be sent to the chilprocess.spawn:
            "args":[
                "-DTEST1=TEST1 TEST1",          // "-DTEST1=TEST1 TEST1"
                "-DTEST2=\"TEST2 TEST2\"",      // -DTEST2="TEST2 TEST2"
                "-DTEST3=\\\"TEST3 TEST3\\\"",  // "-DTEST3=\"TEST3 TEST3\""
                "-DTEST4=TEST4\\ TEST4",        // "-DTEST4=TEST4 TEST4"
                "-DTEST5='TEST5 TEST5'",        // -DTEST5='TEST5 TEST5'
                "-DTEST6=TEST6\\ TEST6 Test6",  // "-DTEST6=TEST6 TEST6 Test6"
            ]
            */
            testNormalizeArgsScenario("-DTEST1=TEST1 TEST1", "\"-DTEST1=TEST1 TEST1\"");
            testNormalizeArgsScenario("-DTEST2=\"TEST2 TEST2\"", "-DTEST2=\"TEST2 TEST2\"");
            testNormalizeArgsScenario("-DTEST3=\\\"TEST3 TEST3\\\"", "\"-DTEST3=\\\"TEST3 TEST3\\\"\"");
            if (process.platform.includes("win")) {
                testNormalizeArgsScenario("-DTEST4=TEST4\\ TEST4", "\"-DTEST4=TEST4 TEST4\"");
                testNormalizeArgsScenario("-DTEST5=\'TEST5 TEST5\'", "-DTEST5=\'TEST5 TEST5\'");
            } else {
                testNormalizeArgsScenario("-DTEST4=TEST4\\ TEST4", "-DTEST4=TEST4\\ TEST4");
                testNormalizeArgsScenario("-DTEST5='TEST5 TEST5'", "-DTEST5='TEST5 TEST5'");
            }
            testNormalizeArgsScenario("-DTEST6=TEST6\\ TEST6 Test6", "\"-DTEST6=TEST6 TEST6 Test6\"");
        });

        interface ResolveTestFlowEnvironment {
            withEnvironment(additionalEnvironment: {[key: string]: string | string[]}): ResolveTestFlowAssert;
            shouldLookupSymbol(key: string): void;
        }
        interface ResolveTestFlowAssert {
            shouldResolveTo(x: string): void;
        }

        function resolveVariablesWithInput(input: string): ResolveTestFlowEnvironment {
            return {
                withEnvironment: (additionalEnvironment: {[key: string]: string | string[]}) => inputAndEnvironment(input, additionalEnvironment),
                shouldLookupSymbol: (symbol: string) => {
                    const environment: {[key: string]: string | string[]} = {};
                    environment[symbol] = success;
                    return inputAndEnvironment(input, environment)
                        .shouldResolveTo(success);
                }
            };
        }

        function inputAndEnvironment(input: string, additionalEnvironment: {[key: string]: string | string[]}): ResolveTestFlowAssert {
            return {
                shouldResolveTo: (expected: string) => {
                    const actual: string = resolveVariables(input, additionalEnvironment);
                    const msg: string = `Expected ${expected}. Got ${actual} with input ${input} and environment ${JSON.stringify(additionalEnvironment)}.`;
                    assert.equal(actual, expected, msg);
                }
            };
        }
    });
});
