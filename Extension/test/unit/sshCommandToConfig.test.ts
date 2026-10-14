/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */

import { deepStrictEqual, strictEqual } from 'assert';
import { describe, it } from 'mocha';
import { splitArgs, sshCommandToConfig } from '../../src/SSH/sshCommandToConfig';

// eslint-disable-next-line import/no-unassigned-import
require('source-map-support/register');

describe('splitArgs', () => {
    // [description, input, expected tokens]
    const cases: [string, string, string[]][] = [
        ['empty string', '', []],
        ['whitespace only', '   \t  ', []],
        ['simple words', 'ssh user@host', ['ssh', 'user@host']],
        ['collapses runs of whitespace', 'ssh   \t user@host', ['ssh', 'user@host']],
        ['trims leading/trailing whitespace', '  ssh user@host  ', ['ssh', 'user@host']],

        // Windows paths: backslashes must stay literal (the original bug).
        ['bare Windows path', 'ssh -i C:\\Users\\me\\key user@host', ['ssh', '-i', 'C:\\Users\\me\\key', 'user@host']],
        ['double-quoted Windows path with spaces', 'ssh -i "C:\\Program Files\\me\\key" user@host', ['ssh', '-i', 'C:\\Program Files\\me\\key', 'user@host']],
        ['single-quoted Windows path with spaces', "ssh -i 'C:\\Program Files\\me\\key' user@host", ['ssh', '-i', 'C:\\Program Files\\me\\key', 'user@host']],
        ['single-quoted Windows path without spaces', "ssh -i 'C:\\Users\\me\\key' user@host", ['ssh', '-i', 'C:\\Users\\me\\key', 'user@host']],

        // Quote handling.
        ['strips double quotes', '"a b" c', ['a b', 'c']],
        ['strips single quotes', "'a b' c", ['a b', 'c']],
        ['quotes joined to adjacent text', 'a"b c"d', ['ab cd']],
        ['single quotes inside double quotes are literal', '"it\'s here"', ["it's here"]],
        ['double quotes inside single quotes are literal', "'say \"hi\"'", ['say "hi"']],
        ['empty double-quoted token is preserved', 'a "" b', ['a', '', 'b']],
        ['empty single-quoted token is preserved', "a '' b", ['a', '', 'b']],

        // Forward-slash (POSIX-style) paths are unaffected.
        ['forward-slash path', 'ssh -i /home/me/.ssh/id_rsa user@host', ['ssh', '-i', '/home/me/.ssh/id_rsa', 'user@host']],

        // An unquoted backslash escapes a following whitespace character (POSIX behavior), so a
        // Unix path with an escaped space stays a single argument.
        ['backslash escapes a space', 'ssh -i /home/me/my\\ key user@host', ['ssh', '-i', '/home/me/my key', 'user@host']],
        ['backslash escapes multiple spaces', 'ssh -i /home/me/key\\ with\\ spaces user@host', ['ssh', '-i', '/home/me/key with spaces', 'user@host']],
        ['backslash escapes a tab', 'a\\\tb', ['a\tb']],
        ['trailing backslash is literal', 'foo\\', ['foo\\']],
        ['backslash before a letter stays literal (Windows path)', 'C:\\Users\\me', ['C:\\Users\\me']],
        ['UNC path keeps doubled backslashes', '\\\\server\\share', ['\\\\server\\share']],
        // A backslash that ends a quoted segment is literal and must not escape the following
        // separator (only an unquoted backslash directly before whitespace escapes).
        ['quoted path ending in backslash is not joined to the next arg', '"C:\\Program Files\\" next', ['C:\\Program Files\\', 'next']],

        // Lenient handling of an unterminated quote: runs to end of string.
        ['unterminated double quote runs to end', 'ssh -i "C:\\Users\\me', ['ssh', '-i', 'C:\\Users\\me']],
        ['unterminated single quote runs to end', "ssh -i 'C:\\Users\\me", ['ssh', '-i', 'C:\\Users\\me']]
    ];

    for (const [description, input, expected] of cases) {
        it(`${description}: ${JSON.stringify(input)}`, () => {
            deepStrictEqual(splitArgs(input), expected);
        });
    }
});

describe('sshCommandToConfig', () => {
    it('preserves a bare Windows identity-file path', () => {
        const config = sshCommandToConfig('ssh -i C:\\Users\\me\\.ssh\\id_rsa user@host');
        strictEqual(config.IdentityFile, 'C:\\Users\\me\\.ssh\\id_rsa');
        strictEqual(config.HostName, 'host');
        strictEqual(config.User, 'user');
    });

    it('preserves a single-quoted Windows identity-file path with spaces', () => {
        const config = sshCommandToConfig("ssh -i 'C:\\Program Files\\me\\key' user@host");
        strictEqual(config.IdentityFile, 'C:\\Program Files\\me\\key');
    });

    it('preserves a double-quoted Windows identity-file path with spaces', () => {
        const config = sshCommandToConfig('ssh -i "C:\\Program Files\\me\\key" user@host');
        strictEqual(config.IdentityFile, 'C:\\Program Files\\me\\key');
    });

    it('preserves a Unix identity-file path with a backslash-escaped space', () => {
        const config = sshCommandToConfig('ssh -i /home/me/my\\ key user@host');
        strictEqual(config.IdentityFile, '/home/me/my key');
        strictEqual(config.HostName, 'host');
        strictEqual(config.User, 'user');
    });

    it('parses host, user, and port from the connection string', () => {
        const config = sshCommandToConfig('ssh -p 2222 user@host');
        strictEqual(config.HostName, 'host');
        strictEqual(config.User, 'user');
        strictEqual(config.Port, '2222');
    });
});
