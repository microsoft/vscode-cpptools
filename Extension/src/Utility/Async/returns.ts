/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */

/** constant functions that return constant values (useful for 'catch') */
export const returns = {
    /** returns undefined */
    undefined: () => undefined,

    /** returns an empty array */
    none: () => [],

    /** returns null */
    null: () => null,

    /** returns false */
    false: () => false,

    /** returns true */
    true: () => true,

    /** returns zero */
    zero: () => 0,

    /** returns an empty string */
    empty: () => ''
};

export const logAndReturn = {
    /** returns undefined */
    undefined: (e: any) => {
        if (e) {
            console.log(e);
        }
        return undefined;
    },

    /** returns an empty array */
    none: (e: any) => {
        if (e) {
            console.log(e);
        }
        return [];
    },

    /** returns null */
    null: (e: any) => {
        if (e) {
            console.log(e);
        }
        return null;
    },

    /** returns false */
    false: (e: any) => {
        if (e) {
            console.log(e);
        }
        return false;
    },

    /** returns true */
    true: (e: any) => {
        if (e) {
            console.log(e);
        }
        return true;
    },

    /** returns zero */
    zero: (e: any) => {
        if (e) {
            console.log(e);
        }
        return 0;
    },

    /** returns an empty string */
    empty: (e: any) => {
        if (e) {
            console.log(e);
        }
        return '';
    }
};

