/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */

import { deepEqual, throws } from 'assert';
import { describe } from 'mocha';
import { extractArgs } from '../../src/Utility/Process/commandLine';
import { is } from '../../src/Utility/System/guards';
import { isWindows } from '../../src/constants';
import { when } from '../common/internal';

// eslint-disable-next-line import/no-unassigned-import
require('source-map-support/register');

function marker() {
    try {
        throw new Error('Test Marker');
    } catch (E) {
        if (is.error(E)) {
            return E.stack?.split('\n').filter(each => each.includes('.ts') && each.includes('<anonymous>')).join('\n');
        }
    }
}

const fails: [ string | undefined, string, string?][] = [
    /** command substitution not supported */
    [undefined, "explicit ``", marker()],
    [undefined, "$(echo hello)", marker()],
    [undefined, "$( (echo hello) )", marker()],
    [undefined, "$((echo hello);(echo there))", marker()],
    [undefined, "`echo one two`", marker()],
    [undefined, "$(echo ')')", marker()],
    [undefined, "$(echo hello; echo)", marker()],
    [undefined, "a$(echo b)c", marker()],
    ["pepperoni", "${var%$(echo oni)}", marker()],
    [undefined, "\"$(echo hello there)\"", marker()],
    [undefined, "\"$(echo \"hello there\")\"", marker()],
    ["1", "$(( $(echo 3)+$var ))", marker()],
    [undefined, "\"$(echo \"*\")\"", marker()],
    [ undefined, "\"a\n\n$(echo)b\"", marker()],
    /* Things that should fail */
    [ undefined, "new\nline", marker()],
    [ undefined, "pipe|symbol", marker()],
    [ undefined, "&ampersand", marker()],
    [ undefined, "semi;colon", marker()],
    [ undefined, "<greater", marker()],
    [ undefined, "less>", marker()],
    [ undefined, "(open-paren", marker()],
    [ undefined, "close-paren)", marker()],
    [ undefined, "{open-brace", marker()],
    [ undefined, "close-brace}", marker()],
    [ undefined, "$(ls)", marker()],
    [ undefined, "${50+20))", marker()],
    [ undefined, "${%%noparam]", marker()],
    [ undefined, "${missing-brace", marker()],
    [ undefined, "$(for i in)", marker()],
    [ undefined, "$((2+))", marker()],
    [ undefined, "`", marker()],
    [ undefined, "$((010+4+))", marker()],
    /* Test for CVE-2014-7817. We test 3 combinations of command
       substitution inside an arithmetic expression to make sure that
       no commands are executed and an error is returned.  */
    [ undefined, "$((`echo 1`))", marker() ],
    [ undefined, "$((1+`echo 1`))", marker() ],
    [ undefined, "$((1+$((`echo 1`))))", marker() ],

    [ undefined, "`\\", marker() ], /* BZ 18042  */
    [ undefined, "${", marker() ], /* BZ 18043  */
    [ undefined, "L${a:", marker()], /* BZ 18043#c4  */
    [ undefined, "${1/0]", marker() ] /* BZ 18100 */
];

const success: [string | undefined, string, string[], string?][] = [
    /* Simple word and field splitting */
    [ undefined, "one", [ "one" ], marker() ],
    [ undefined, "one two", [ "one", "two" ], marker() ],
    [ undefined, "one two three", [ "one", "two", "three" ], marker() ],
    [ undefined, " \tfoo\t\tbar ", [ "foo", "bar" ], marker() ],
    [ undefined, "red , white blue", [ "red", ",", "white", "blue" ], marker() ],
    [ undefined, "one two three", [ "one", "two", "three" ], marker() ],
    [ undefined, "one \"two three\"", [ "one", "two three" ], marker() ],
    [ undefined, "one \"two three\"", [ "one", "two three" ], marker() ],
    [ "two three", "one \"$var\"", [ "one", "two three" ], marker() ],
    [ "two three", "one $var", [ "one", "two", "three" ], marker() ],
    [ "two three", "one \"$var\"", [ "one", "two three" ], marker() ],

    /* Simple parameter expansion */
    [ "foo", "${var}", [ "foo" ], marker()],
    [ "foo", "$var", [ "foo" ], marker()],
    [ "foo", "\\\"$var\\\"", [ "\"foo\"" ], marker()],
    [ "foo", "%$var%", [ "%foo%" ], marker()],
    [ "foo", "-$var-", [ "-foo-" ], marker()],

    /* Simple quote removal */
    [ undefined, "\"quoted\"", [ "quoted" ], marker()],
    [ "foo", "\"$var\"\"$var\"", [ "foofoo" ], marker()],
    [ undefined, "'singly-quoted'", [ "singly-quoted" ], marker()],
    [ undefined, "contin\\\nuation", [ "continuation" ], marker()],
    [ undefined, "explicit ''", [ "explicit", "" ], marker()],
    [ undefined, "explicit \"\"", [ "explicit", "" ], marker()],

    /* Simple arithmetic expansion */
    [ undefined, "$((1 + 1))", [ "2" ], marker() ],
    [ undefined, "$((2-3))", [ "-1" ], marker() ],
    [ undefined, "$((-1))", [ "-1" ], marker() ],
    // [ undefined, "$[50+20]", [ "70" ], marker() ],
    [ undefined, "$(((2+3)*(4+5)))", [ "45" ], marker() ],
    [ undefined, "$((010))", [ "8" ], marker() ],
    [ undefined, "$((0x10))", [ "16" ], marker() ],
    [ undefined, "$((010+0x10))", [ "24" ], marker() ],
    [ undefined, "$((-010+0x10))", [ "8" ], marker() ],
    [ undefined, "$((-0x10+010))", [ "-8" ], marker() ],

    /* Advanced parameter expansion */
    [ undefined, "${var:-bar}", [ "bar" ], marker() ],
    [ undefined, "${var-bar}", [ "bar" ], marker() ],
    [ "", "${var:-bar}", [ "bar" ], marker() ],
    [ "foo", "${var:-bar}", [ "foo" ], marker() ],
    [ "", "${var-bar}", [ '' ], marker() ],
    [ undefined, "${var:=bar}", [ "bar" ], marker() ],
    [ undefined, "${var=bar}", [ "bar" ], marker() ],
    [ "", "${var:=bar}", [ "bar" ], marker() ],
    [ "foo", "${var:=bar}", [ "foo" ], marker() ],
    [ "", "${var=bar}", [ '' ], marker() ],
    [ "foo", "${var:?bar}", [ "foo" ], marker() ],
    [ undefined, "${var:+bar}", [ '' ], marker() ],
    [ undefined, "${var+bar}", [ '' ], marker() ],
    [ "", "${var:+bar}", [ '' ], marker() ],
    [ "foo", "${var:+bar}", [ "bar" ], marker() ],
    [ "", "${var+bar}", [ "bar" ], marker() ],
    [ "12345", "${#var}", [ "5" ], marker() ],
    [ undefined, "${var:-']'}", [ "]" ], marker() ],
    [ undefined, "${var-}", [ '' ], marker() ],

    [ "pizza", "${var#${var}}", [ '' ], marker()],

    [ "6pack", "${var#$((6))}", [ "pack" ], marker()],
    [ "b*witched", "${var##b*}", [ '' ], marker()],
    [ "b*witched", "${var##\"b*\"}", [ "witched" ], marker()],
    [ "banana", "${var%na*}", [ "bana" ], marker()],
    [ "banana", "${var%%na*}", [ "ba" ], marker()],
    [ "borabora-island", "${var#*bora}", [ "bora-island" ], marker()],
    [ "borabora-island", "${var##*bora}", [ "-island" ], marker()],
    [ "coconut", "${var##\\*co}", [ "coconut" ], marker()],
    [ "100%", "${var%0%}", [ "10" ], marker()],

    /* Nested constructs */
    [ "one two", "$var", [ "one", "two" ], marker()],
    [ "one two three", "$var", [ "one", "two", "three" ], marker()],
    [ " \tfoo\t\tbar ", "$var", [ "foo", "bar" ], marker()],
    [ "  red  , white blue", "$var", [ "red", ',', "white", "blue" ], marker()],
    [ "  red  , white blue", "\"$var\"", [ "  red  , white blue" ], marker()],

    [ undefined, "${var=one two} \"$var\"", [ "one", "two", "one two" ], marker()],

    [ "foo", "*$var*", [ "*foo*" ], marker()],

    /* Other things that should succeed */
    [ undefined, "\\*\"|&;<>\"\\(\\)\\[\\]", [ "*|&;<>()[]" ], marker()],
    [ undefined, "$var", [ '' ], marker()],
    [ undefined, "\"\\n\"", [ "\\n" ], marker()],
    [ undefined, "", [ '' ], marker()],

    [ undefined, "$var", [ '' ], marker()],
    [ undefined, "$9", ['' ], marker()],

    [ undefined, '', [ '' ], marker()]
];
let stop = false;
describe('Command Lines', () => {
    for (const [variable, cmdline, expected, err ] of success) {
        if (stop) {
            break;
        }
        when(!isWindows).it(`[Posix] should parse ${JSON.stringify(cmdline)}`, () => {
            if (stop) {
                return;
            }

            if (variable !== undefined) {
                process.env.var = variable;
            } else {
                delete process.env.var;
            }
            stop = true;

            const result = extractArgs(cmdline);
            deepEqual(result, expected, `expected «${expected.join(',')}» got «${result.join(',')}» at ${err}`);
            stop = false;
        });
    }

    for (const [variable, cmdline, err ] of fails) {
        if (stop) {
            break;
        }
        when(!isWindows).it(`[Posix] should not parse ${JSON.stringify(cmdline)}`, () => {
            if (stop) {
                return;
            }

            if (variable !== undefined) {
                process.env['var'] = variable;
            } else {
                delete process.env.var;
            }
            stop = true;

            let v: any = [];
            throws(() => { v = extractArgs(cmdline);}, `expected error at ${err} - got «${v}»`);
            stop = false;
        });
    }
});
