/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */

import { ok, strictEqual } from 'assert';
import { describe, it } from 'mocha';
import { parse } from '../../src/Utility/Eventing/eventParser';

const tests = [
    'someEvent[a == 100]',
    'someEvent[a == 100 && b == 200]',
    'someEvent[a == 100 && b == 200 && c == 300]',
    'someEvent[/text-here/g]',
    'someEvent[/over.here/g && a == 100]',
    'someEvent[a === 100 && /text-here/g]',
    'someEvent/something[name !== "bob"]',
    'someEvent/something[name !== "bob"]/somethingElse[happy]',
    'someEvent/somethingElse[!sad && /hello.world/g]',
    'someEvent/somethingElse[!sad && /(hello).world/g]'
];

describe('Event Handler/Parser', () => {
    it('parses events, successful filter matches.', async () => {
        const parsed = tests.map(each => parse(each, undefined)[2]);

        console.log(`Generated filter ${tests.length} functions :`);

        const eventData = { a: 100, b: 200, c: 300 };
        const someEventText = ['there is text-here', 'and some over here too'];

        const somethingData = { name: 'contoso' };
        const somethingText = [] as string[];

        const somethingElseData = { happy: true, sad: false, color: 'red', value: 123 };
        const somethingElseText = ['hello world'];

        for (const filters of parsed) {
            const captures = [] as string[];
            for (const [name, filter] of filters) {

                if (filter === true) {
                    continue;
                }

                switch (name) {
                    case 'someEvent':
                        ok(filter(eventData, someEventText, captures), `filter '${filter.toString()}' should return true`);
                        continue;

                    case 'something':
                        ok(filter(somethingData, somethingText, captures), `filter '${filter.toString()}' should return true`);
                        continue;

                    case 'somethingElse':
                        ok(filter(somethingElseData, somethingElseText, captures), `filter '${filter.toString()}' should return true`);

                        // on the one with 'sad', check to see we get back some filter capture data
                        if (filter.toString().includes('sad')) {
                            strictEqual(captures[0], 'hello world', `capture[0] from filter '${filter.toString()}' should be \'hello world\'`);
                        }
                        continue;
                }
            }
        }
    });

    it('parses events, fails filter matches.', async () => {
        const parsed = tests.map(each => parse(each, undefined)[2]);

        console.log(`Generated filter ${tests.length} functions :`);

        const eventData = { a: 101, b: 200, c: 300 };
        const someEvent = ['there is not text', 'and some not here too'];

        const something = [] as string[];
        const somethingData = { name: 'bob' };

        const somethingElse = ['helloworld'];
        const somethingElseData = { happy: false, sad: false, color: 'red', value: 123 };

        for (const filters of parsed) {
            const captures = [] as string[];
            for (const [name, filter] of filters) {
                if (filter === true) {
                    continue;
                }
                switch (name) {
                    case 'someEvent':
                        ok(!filter(eventData, someEvent, captures), `filter '${filter.toString()}' should return false`);
                        continue;

                    case 'something':
                        ok(!filter(somethingData, something, captures), `filter '${filter.toString()}' should return false`);
                        continue;

                    case 'somethingElse':
                        ok(!filter(somethingElseData, somethingElse, captures), `filter '${filter.toString()}' should return false`);
                        strictEqual(captures.length, 0, `capture[0] from filter '${filter.toString()}' should be empty`);
                        continue;
                }

            }
        }

    });
});
