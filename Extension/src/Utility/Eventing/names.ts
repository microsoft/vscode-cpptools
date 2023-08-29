/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */

/* eslint-disable @typescript-eslint/naming-convention */

export class requests {
    static readonly select = 'select';
    static readonly get = 'get';
}

// [noun]-[verb]
export class events {
    static readonly writing = 'writing';
    static readonly reading = 'reading';
}

// output channel notifications
export class channels {
    static readonly debug = 'debug';
    static readonly verbose = 'verbose';
    static readonly info = 'info';
    static readonly warning = 'warning';
    static readonly error = 'error';
    static readonly internal = 'internal';
}

/** Notifications */
// [state]
// [pastTenseVerb]-[noun]
export class notifications {
    static readonly ready = 'ready';
    static readonly exited = 'exited';
    static readonly started = 'started';
    static readonly stopped = 'stopped';
    static readonly connected = 'connected';
    static readonly disconnected = 'disconnected';

    static readonly read = 'read'; // past-tense, so it's not confused with the reading verb
    static readonly wrote = 'wrote'; // past-tense, so it's not confused with the writing verb
    static readonly message = 'message';
}

/** Queries expect a value in return */
export class queries {
    static readonly selectBinary = 'select-binary';
}
