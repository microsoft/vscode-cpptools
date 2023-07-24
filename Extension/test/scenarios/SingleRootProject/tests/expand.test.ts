/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
import * as assert from "assert";
import { describe, test } from "mocha";
import { ExpansionOptions, expandAllStrings } from "../../../../src/expand";

describe('${Variable} Expansion', () => {
    test('Expand all strings', async () => {
        const input: object = {
            in1: "${test2}",
            in2: "${test4}",
            in3: [
                "${test3}",
                {
                    in4: "${test3}"
                }
            ]
        };
        const variables: object = {
            test1: "t1",
            test2: "${dollar}{${test1}}",
            test3: "test${test2}test:${env:envtest}:${dollar}test",
            test4: "${test4}"
        };
        const expansionOptions: ExpansionOptions = {
            vars: {
                workspaceFolder: '{workspaceFolder}',
                workspaceFolderBasename: '{workspaceFolderBasename}',
                ...variables
            },
            recursive: true
        };
        await expandAllStrings(input, expansionOptions);
        assert.deepStrictEqual(input, {
            in1: "${t1}",
            in2: "${test4}",
            in3: [
                "test${t1}test::$test",
                {
                    in4: "test${t1}test::$test"
                }
            ]
        });
    });
});
