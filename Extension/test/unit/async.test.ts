/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */

import { describe, it } from 'mocha';
import { ok, strict, strictEqual } from 'node:assert';
import { Factory } from '../../src/Utility/Async/factory';
import { sleep } from '../../src/Utility/Async/sleep';

import { AnotherOne, AnotherThree, Something, SomethingElse } from './examples/someclass';

describe('AsyncConstructor', () => {
    it('Create an instance of an async class', async () => {
        const something = await new Something(100);
        ok(something.hasBeenInitialized, 'The class should have been initialized');
    });

    it('even works when there is no async init method in the class', async () => {
        // the SomethingElse doesn't actually have an init() method, but it should still work.
        const somethingElse = await new SomethingElse();
        ok(somethingElse.works, 'The class should have been initialized');
    });

    it('init can be a promise that is created by the constructor instead of a method', async () => {
        // this one doesn't have an init method, but does have an init field that is a promise.
        const anotherOne = await new AnotherOne();
        ok(anotherOne.works, 'The class should have been initialized');
    });

    it('Child class?', async () => {
        // this one doesn't have an init method, but does have an init field that is a promise.
        const three = await new AnotherThree();
        ok(three.works, 'The class should have been initialized');
    });

    it('if the constructor throws it should still throw', async () => {
        try {
            await new Something(-1);
            strict(false, 'should have thrown during constructor');
        } catch (e) {
            strictEqual((e as Error).message, 'constructor throws on -1', 'The class should have thrown');
        }
    });

    it('if the init throws, it should still throw', async () => {
        try {
            await new Something(-2);
            strict(false, 'should have thrown during init');
        } catch (e) {
            strictEqual((e as Error).message, 'init throws on -2', 'The class should have thrown');
        }
    });
});

describe('AsyncFactory', () => {
    it('Factory that creates a number', async () => {
        const f = Factory(() => 1);
        const result = await new f();
        strictEqual(result, 1, 'The factory should have returned 1');
    });

    it('Factory that creates a function with an async initializer', async () => {
        // a factory is a 'newable' class that can be created with the 'new' keyword, that returns a promise.
        const f = Factory(() => {
            const value = (() => 100) as any;

            value.init = async () => {
                await sleep(1);
                value.value = 200;
            };

            return value as () => number;
        });
        const fn = await new f();
        const result = fn();
        strictEqual(result, 100, 'The factory should have returned 100');
        strictEqual((fn as any).value, 200, 'The factory should have a member "value" that is 200 (shows init working)');
    });
});
