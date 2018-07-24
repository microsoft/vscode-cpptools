import * as assert from "assert";
import {  resolveVariables } from "../../src/common";

suite("Common Utility validation", () => {
    suite("resolveVariables", () => {
        const success = "success";
        const home = process.env.HOME;

        test("raw input", () => {
            const input = "test";
            assert.equal(resolveVariables(input, {}), input);
        });

        test("raw input with tilde", () => {
            const input = "~/test";
            assert.equal(resolveVariables(input, {}), `${home}/test`)
        });

        test("env input with tilde", () => {
            const input = "${path}/test";
            const actual = resolveVariables(input, {
                path: home
            }); 
            assert.equal(actual, `${home}/test`)
        });

        test("solo env input resulting in array", () => {
            const input = "${test}";
            const actual = resolveVariables(input, {
                test: ["foo", "bar"]
            }); 
            assert.equal(actual, "foo;bar")
        });

        test("mixed raw and env input resulting in array", () => {
            const input = "baz${test}";
            const actual = resolveVariables(input, {
                test: ["foo", "bar"]
            }); 
            assert.equal(actual, input)
        });

        test("solo env input not in env config finds process env", () => {
            const processKey = `cpptoolstests_${Date.now()}`;
            const input = "foo${" + processKey + "}";
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
            shouldSuccessfullyLookupInEnv("${test}", "test");
        });

        test("env input mixed with plain text", () => {
            const input = "${test}bar";
            const env = {
                test: "foo"
            };
            const result = resolveVariables(input, env);
            assert.equal(result, "foobar");
        });

        test("env input with two variables", () => {
            const input = "f${a}${b}r";
            const env = {
                a: "oo",
                b: "ba"
            };
            const result = resolveVariables(input, env);
            assert.equal(result, "foobar");
        });

        test("env input not in env", () => {
            const input = "${test}";
            assert.equal(resolveVariables(input, {}), input);
        });

        test("env input with 1 level of nested variables anchored at end", () => {
            const input = "${foo${test}}";

            const env = {
                "foobar": success,
                "test": "bar"
            };
            assert.equal(resolveVariables(input, env), success);
        });

        test("env input with 1 level of nested variables anchored in the middle", () => {
            const input = "${f${test}r}";

            const env = {
                "foobar": success,
                "test": "ooba"
            };
            assert.equal(resolveVariables(input, env), success);
        });

        test("env input with 1 level of nested variable anchored at front", () => {
            const input = "${${test}bar}";

            const env = {
                "foobar": success,
                "test": "foo"
            };
            assert.equal(resolveVariables(input, env), success);
        });

        test("env input with 3 levels of nested variables", () => {
            const input = "${foo${a${b${c}}}}";
            const env = {
                "foobar": success,
                "a1": "bar",
                "b2": "1",
                "c": "2"
            };
            assert.equal(resolveVariables(input, env), success);
        });

        test("env input contains env", () => {
            shouldSuccessfullyLookupInEnv("${envRoot}", "envRoot");
        });

        test("env input contains config", () => {
            shouldSuccessfullyLookupInEnv("${configRoot}", "configRoot");
        });

        test("env input contains workspaceFolder", () => {
            shouldSuccessfullyLookupInEnv("${workspaceFolderRoot}", "workspaceFolderRoot");
        });

        test("input contains env.", () => {
            shouldSuccessfullyLookupInEnv("${env.Root}", "Root");
        });

        test("input contains env:", () => {
            shouldSuccessfullyLookupInEnv("${env:Root}", "Root");
        });


        const shouldSuccessfullyLookupInEnv = (input: string, expectedResolvedKey: string) => {
            const env = {};
            env[expectedResolvedKey] = success;
            const result = resolveVariables(input, env);
            assert.equal(result, success);
        }
    });
});