import * as assert from "assert";
import * as vscode from "vscode";
import { resolveVariables } from "../../src/common";

suite("Common Utility validation", () => {
    suite("resolveVariables", () => {
        test("raw input", () => {
            const input = "test";
            assert.equal(resolveVariables(input, {}), input);
        });

        test("env input", () => {
            shouldSuccessfullyLookupInEnv("${test}", "test");
        });

        test("env input not in env", () => {
            const input = "${test}";
            assert.equal(resolveVariables(input, {}), input);
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
            const success = "success";
            const env = {};
            env[expectedResolvedKey] = success;
            const result = resolveVariables(input, env);
            assert.equal(result, success);
        }
    });
});