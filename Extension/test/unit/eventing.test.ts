/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */

import { ok, strictEqual } from 'assert';
import { beforeEach, describe, it } from 'mocha';
import { Async } from '../../src/Utility/Async/constructor';
import { sleep } from '../../src/Utility/Async/sleep';
import { Descriptors } from '../../src/Utility/Eventing/descriptor';
import { notify, notifyNow, reset, subscribe } from '../../src/Utility/Eventing/dispatcher';
import { Emitter } from '../../src/Utility/Eventing/emitter';
import { Cancelled, Continue } from '../../src/Utility/Eventing/interfaces';
import { is } from '../../src/Utility/System/guards';

export class SomeBase extends Emitter {

}

class Something extends SomeBase {
    constructor() {
        super();
        this.descriptors.add('server', 'mysrv');
    }

    // emitter declarations
    readonly initialize = this.newEvent('initialize');
    readonly bump = this.newEvent('bump');

    async init() {
        console.debug('before initialize');
        // tell them we are initializing
        if (is.cancelled(await this.initialize())) {
            // a handler has cancelled this event.  we should stop
            console.debug('cancelled?');
            this.wasCancelled = true;
            return;
        }
        this.initWasSuccessful = true;
        console.debug('after initialize');
    }
    wasCancelled: boolean = false;
    initWasSuccessful: boolean = false;
    initHandlerRan: boolean = false;

    // event handler for the init event for this instance only
    async 'this initialize'() {
        this.initHandlerRan = true;
        console.debug('init handler that is bound to the instance');

        return Cancelled;
    }
}

// make an async constructor for the Something class

const AsyncSomething = Async(Something);

describe('Event Emitters', () => {

    beforeEach(() => {
        reset();
        // uncomment the following line to show debug messages in the console.
        // void on('debug', async (event: EventData) => { console.debug(event.text); });
    });

    it('try self-bound handlers', async () => {
        const something = new Something();

        // subscribe the object to its own events
        subscribe(something);

        // do something that will trigger the event
        await something.init();

        ok(something.initHandlerRan, 'The init handler should have cancelled the event');
    });

    it('try object handlers', async () => {
        const something = new Something();

        let count = 0;

        const subscriber = {
            'something/initialize': () => {
                console.debug('in here !');
                count++;
                return Continue;
            }
        };

        subscribe(subscriber, { bindAll: true });

        await something.init();
        strictEqual(count, 1, 'The init handler should have increased count by 1');

        // create another, that wasn't existing before the subscription
        const something2 = new Something();
        await something2.init();
        strictEqual(count, 2, 'The init handler should have increased count by 1 again');

    });

    it('ensure that `this` modifiers work correctly', async () => {
        let countThisInit = 0;
        let countAnyInit = 0;

        const s1 = new Something();
        const s2 = new Something();

        const subscriber = {
            // should only get called for events on the object it is bound to
            'this initialize': () => {
                console.debug('`this init` called');
                countThisInit++;
            },

            // should get called for all events named 'init'
            'initialize': () => {
                console.debug('`init` called');
                countAnyInit++;
            }
        };

        // subscribe the handlers to events
        subscribe(subscriber, { bindAll: true, eventSource: s1 });

        await s1.init();
        await s2.init();

        strictEqual(countThisInit, 1, 'The `this` init handler should only get called on one of the instances');
        strictEqual(countAnyInit, 2, 'The non-`this` init handler should get called for all instances');

    });

    it('show that `on` automatically assumes `this`', async () => {
        let countThisInit = 0;

        const s1 = new Something();
        const s2 = new Something();

        // subscribe the handlers to events
        s1.on('initialize', () => {
            console.debug('`this init` called');
            countThisInit++;
        });

        await s1.init();
        await s2.init();

        strictEqual(countThisInit, 1, 'The `this` init handler should only get called on one of the instances');
    });

    it('ensure that cancellation works correctly', async () => {
        const s1 = new Something();
        let count = 0;
        const subscriber = {
            // should only get called for events on the object it is bound to
            'this initialize': () => {
                console.debug('`this init` called, cancelling');
                return Cancelled;
            },
            'this bump': () => {
                console.debug(`bump called: ${++count}`);
            }
        };

        // subscribe the handlers to events
        subscribe(subscriber, { bindAll: true, eventSource: s1 });
        await s1.init();
        await s1.bump();

        s1.removeAllListeners();
        await s1.bump();
        strictEqual(count, 1, 'The bump handler should have been called once');

        strictEqual(s1.wasCancelled, true, 'The init event should have been cancelled');
    });

    it('Use wildcard for event name', async () => {
        const something = new Something();

        let triggered = false;

        subscribe({
            '*/server[/mysrv/g]': () => {
                triggered = true;
            }
        }, { bindAll: true });

        await something.init();
        ok(triggered, 'The init handler should have been triggered event');
    });

    it('Use eventing framework with async constructors', async () => {
        let worked = false;
        const subscriber = {
            'something/initialize': () => {
                console.debug('responding to initialize event on something!');
                worked = true;
                return Continue;
            }
        };

        // subscribe to events before the object is created
        subscribe(subscriber, { bindAll: true });

        // create the object asynchronously, which will trigger the event during init()
        const something = await new AsyncSomething();
        ok(something.initWasSuccessful, 'The init should have been called automatically');

        ok(worked, 'worked should be true, because the event should have been triggered by the async constructor');
    });

    it('Notifiers don\'t return stuff', async () => {
        let count = 0;
        subscribe({
            'note': () => {
                count++;
            }
        }, { bindAll: true });

        notifyNow('note', Descriptors.none, 'hi there');
        notifyNow('note', Descriptors.none, 'hi there');
        notifyNow('note', Descriptors.none, 'hi there');
        strictEqual(count, 3, 'count should be 3 -- notify now won\'t have to go async for any of this so far.');

        notify('note', Descriptors.none, 'hi there');
        notify('note', Descriptors.none, 'hi there');
        notify('note', Descriptors.none, 'hi there');
        notify('note', Descriptors.none, 'hi there');
        notify('note', Descriptors.none, 'hi there');
        notify('note', Descriptors.none, 'hi there');

        console.log(count);
        await sleep(1); // allow the async notifiers to catch up.
        strictEqual(count, 9, 'count should be 9');

    });

    it('works with source code handlers', async () => {
        await subscribe({
            'note': 'console.log(\'hi there\');'
        }, { bindAll: true, folder: 'C:/work/2022/getting-started/STMicroelectronics/B-L4S5I-IOT01A' });

        notifyNow('note', Descriptors.none, 'note');
        notifyNow('note', Descriptors.none, 'note');
        notifyNow('note', Descriptors.none, 'note');

    });

});
