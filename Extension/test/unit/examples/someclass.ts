/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */

import { Async } from '../../../src/Utility/Async/constructor';
import { sleep } from '../../../src/Utility/Async/sleep';

export const Something = Async(class Something {
    hasBeenInitialized: boolean = false;
    constructor(public num: number) {
        if (num === -1) {
            throw new Error('constructor throws on -1');
        }
    }

    async init(_num: number): Promise<Something> {
        if (this.num === -2) {
            throw new Error('init throws on -2');
        }
        // ensure that this is delayed by 100ms
        await sleep(100);

        this.hasBeenInitialized = true;
        return this;
    }

    comment() {
        console.debug(`Has this been initialized: ${this.hasBeenInitialized}`);
    }
});

export const SomethingElse = Async(class SomethingElse {
    works = true;
});

export const AnotherOne = Async(class AnotherOne {
    init: Promise<void>;
    works = false;
    constructor() {
        this.init = sleep(1).then(() => { this.works = true; });
    }
});

export const AnotherTwo = Async(class AnotherTwo {
    async init() {
        await sleep(1);
        this.works = true;
    }
    works = false;
});

export const AnotherThree = Async(class AnotherThree extends AnotherTwo.class {
    override async init() {
        console.log(`before calling super.init, works == ${this.works}`);
        await super.init();
        console.log(`after calling super.init, works == ${this.works}`);
    }
});
