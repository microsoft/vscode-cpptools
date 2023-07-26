/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */

import { fail, notStrictEqual, ok, strictEqual } from 'assert';
import { describe, it } from 'mocha';
import { Descriptors } from '../../src/Utility/Eventing/descriptor';
import { notifyNow } from '../../src/Utility/Eventing/dispatcher';
import { EventData } from '../../src/Utility/Eventing/interfaces';
import { Command, Program } from '../../src/Utility/Process/program';
import { isWindows } from '../../src/constants';

describe('Program Automation', () => {
    if (isWindows) {
        it('can run a program without output [cmd.exe /c rem]', async () => {

            const echo = await new Program('c:/windows/system32/cmd.exe', '/c', 'rem');
            const p = await echo();

            await p.exitCode;

            strictEqual(p.all().join(), '', 'should not have any text output');

        });

        it('can run a command without output [cmd.exe /c rem]', async () => {
            console.log("before cmd");
            const echo = await new Command('c:/windows/system32/cmd.exe', '/c', 'rem');
            const p = await echo();
            console.log("before iter");
            for await (const line of p.stdio) {
                console.log(line);
                fail('should not have any text output');
            }
            console.log('hmm that worked');
            ok(true, 'should not have any text output');

        });

        it('can run a program [cmd.exe /c echo hello]', async () => {

            const echo = await new Program('c:/windows/system32/cmd.exe', '/c', 'echo');
            const p = await echo('hello');

            await p.exitCode;

            strictEqual(p.all()[0], 'hello', 'echo should echo the text we sent it');

            const echo2 = await new Program(echo, 'with', 'some', 'text');
            const p2 = await echo2('there');
            await p2.exitCode;

            strictEqual(p2.all()[0], 'with some text there', 'echo should echo the text we sent it');
        });

        it('supports events on the console stream', async () => {

            let count = 0;

            const echo = await new Program('c:/windows/system32/cmd.exe', '/c', 'echo', {
                on: {
                    'this stdio/read': async (event: EventData<undefined>) => {
                        if (event.text === 'sample-text') {
                            count++;
                        }
                        notStrictEqual(event.text, 'should-not-see', 'should not have seen this text');
                    }
                }
            });

            const p = await echo('sample-text');

            // send an arbitrary console event, this should not show up with 'this' set in the handler above.
            notifyNow('read', new Descriptors(undefined, { console: '' }), 'should-not-see');

            await p.exitCode;

            strictEqual(count, 1, 'should have seen the text we tried to echo');
        });
    }
    it('runs a node command, filter the output', async () => {

        // create a command that runs node from this process
        const node = await new Command(process.execPath);

        // run the command with the --version argument
        const out = (await node('--version')).stdio.filter(/v(\d+\.\d+\.\d+)/g);

        // verify that we got what we expect
        strictEqual(out.length, 1, 'should have found the version number');
        strictEqual(out[0], process.versions.node, 'should have found the version number');

        console.log(out);

    });
});
