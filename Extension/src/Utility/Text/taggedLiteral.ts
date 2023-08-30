/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */

/* eslint-disable @typescript-eslint/no-non-null-assertion */

import { safeEval } from '../Sandbox/sandbox';
import { is } from '../System/guards';
import { Primitive } from '../System/types';
import { isIdentifierPart, isIdentifierStart } from './characterCodes';

/** simple dynamic tagged literal implementation */
export function taggedLiteral(templateString: string, templateVars: Record<string, any>): string {
    return safeEval(`\`${templateString.replace('\\', '\\\\').replace(/`/, '\`')}\`;`, templateVars) as string;
}

function parseTaggedLiteral(templateString: string) {
    // must parse the inside of JavaScript tagged literal format
    // and ensure that escape sequences like \n \t \r \$ are handled correctly
    const result = {
        template: new Array<string>(),
        expressions: new Array<string>(),
        state: 'text' as 'text' | 'escape' | 'dollar' | 'substitution' | 'error' | 'ok',
        message: ''
    };

    let template = '';
    let expression = '';

    for (const char of templateString) {
        switch (result.state) {
            case 'text':
                switch (char) {
                    case '\\':
                        result.state = 'escape';
                        continue;
                    case '$':
                        result.state = 'dollar';
                        continue;
                }
                template += char;
                continue;

            case 'escape':
                template = `${template}\\${char}`;
                result.state = 'text';
                continue;

            case 'dollar':
                if (char === '{') {
                    result.state = 'substitution';
                    result.template.push(template);
                    template = '';
                    continue;
                }
                template = `${template}$${char}`;
                result.state = 'text';
                continue;

            case 'substitution':
                switch (char) {
                    case '}':
                        result.expressions.push(expression);
                        expression = '';
                        result.state = 'text';
                        continue;

                    // ...case ' ':
                    case '\t':
                    case '\r':
                    case '\n':
                        continue; // ignore whitespace

                    case ':':
                    case '.':
                        expression += ':';
                        continue;
                }
                if (expression) {
                    if (isIdentifierPart(char.codePointAt(0)!) || char === '-' || char === '/' || char === ';' || char === ' ') {
                        expression += char;
                        continue;
                    }
                    // error, fall through
                } else if (isIdentifierStart(char.codePointAt(0)!) || char === '-' || char === '/' || char === ';' || char === ' ') {
                    expression += char;
                    continue;
                }

                // not a valid character for an expression
                result.state = 'error';
                result.message = `Unexpected character '${char}' in expression ${expression}`;
                return result;
        }
    }

    switch (result.state) {
        case 'escape':
            result.state = 'error';
            result.message = 'Unexpected end of string (trailing backslash)';
            return result;
        case 'substitution':
            result.state = 'error';
            result.message = 'Unexpected end of string parsing expression ${ ';
            return result;
        case 'dollar':
            template += '$';
            break;
    }
    result.state = 'ok';
    result.template.push(template);
    return result;
}

function split(expression: string) {
    return (expression.match(/(.*?):(.*)/) || ['', '', expression]).slice(1);
}

async function resolveValue(expression: string, context: Record<string, any>, customResolver: CustomResolver = async (_prefix: string, _expression: string) => ''): Promise<string> {
    if (!expression) {
        return '';
    }

    const [prefix, suffix] = split(expression);

    function joinIfArray(value: any, separator = '\u0007') {
        return Array.isArray(value) ? value.join(separator) : value.toString();
    }

    if (prefix) {
        const variable = context[prefix];
        if (variable !== undefined && variable !== null) { // did we get back an actual value
            // it's a child of a variable
            return joinIfArray(suffix.includes(':') ? // is the suffix another expression?
                resolveValue(suffix, variable) : // Yeah, resolve it
                variable[suffix] ?? await customResolver(prefix, suffix) ?? ''); // No, return the member of the variable, or dynamic, or empty string
        }

        // no variable by that name, so return the dynamic value, or an empty string
        return joinIfArray(await customResolver(prefix, suffix) ?? '');
    }

    // look up the value in the variables, or ask the dynamic function to resolve it, failing that, an empty string
    return joinIfArray(context[suffix] ?? await customResolver(prefix, suffix) ?? '');
}

// eslint-disable-next-line @typescript-eslint/naming-convention
class as {
    /** returns the value as a number (NOT NaN) or undefined */
    static number(value: any): number | undefined {
        if (isNaN(value)) {
            return undefined;
        }
        value = parseFloat(value);
        return isNaN(value) ? undefined : value;
    }

    /** returns the value as an integer number (NOT NaN) or undefined */
    static integer(value: any): number | undefined {
        value = as.number(value);
        return value === undefined ? undefined : Math.floor(value);
    }

    /** returns the value as a number (NOT NaN) or undefined */
    static float(value: any): number | undefined {
        return as.number(value); // all numbers can be floats
    }

    /** returns the value as a boolean or undefined */
    static boolean(value: any): boolean | undefined {
        switch (value) {
            case true:
            case 'true':
                return true;
            case false:
            case 'false':
                return false;
        }
        return undefined;
    }

    static primitive(value: any): Primitive | undefined {
        switch (typeof value) {
            case 'string':
                return as.number(value) ?? as.boolean(value) ?? value;

            case 'number':
                return isNaN(value) ? undefined : value;

            case 'boolean':
                return value;

            default:
                return undefined;
        }
    }

    static string(value: any): string | undefined {
        switch (typeof value) {
            case 'object':
                return undefined;

            case 'string':
                return value;

            case 'number':
            case 'boolean':
                return isFinite(value as any) ? value.toString() : undefined;

            default:
                return undefined;
        }
    }

    static js(value: any): Primitive | undefined {
        return JSON.stringify(as.primitive(value));
    }
}

export type CustomResolver = (prefix: string, expression: string) => Promise<string>;

export async function render(templateStrings: string[], context: Record<string, any>, customResolver?: CustomResolver, ensureValuesAreValidJS?: boolean): Promise<string[]>;
export async function render(templateString: string, context: Record<string, any>, customResolver?: CustomResolver, ensureValuesAreValidJS?: boolean): Promise<string>;
export async function render(templateString: string | string[], context: Record<string, any>, customResolver: CustomResolver = async (_prefix: string, _expression: string) => '', asJs = false): Promise<string | string[]> {
    if (Array.isArray(templateString)) {
        return Promise.all(templateString.map(each => render(each, context, customResolver, asJs)));
    }

    // quick exit if it's not a templated string
    if (!templateString.includes('${')) {
        return templateString;
    }

    const { template, expressions, state, message } = parseTaggedLiteral(templateString);
    const stabilize = asJs ? as.js : (x: string) => as.string(x) ?? '';

    if (state === 'error') {
        console.error(`Error parsing tagged literal: ${message}`);
        return message;
    }

    let result = '';
    for (let index = 0; index < template.length; ++index) {
        const each = template[index];
        result = `${result}${stabilize(await resolveValue(expressions[index - 1], context, customResolver))}${each}`;
    }

    // if the result isn't the same as the original, but still has template strings, resolve any additional ones we can.
    return result !== templateString && result.includes('${') ? render(result, context, customResolver, asJs) : result;
}

export async function evaluateExpression(expression: string, context: Record<string, any>, customResolver: CustomResolver = async (_prefix: string, _expression: string) => ''): Promise<Primitive | undefined> {
    const result = expression.match(/\!|==|!=|>=|<=|>|<|\?|\|\||&&/) ? safeEval(await render(expression, context, customResolver, true)) as Primitive : await render(expression, context, customResolver);
    return result === '' || result === 'undefined' || result === 'null' || result === null ? undefined : result;
}

export async function recursiveRender<T extends Record<string, any>>(obj: T, context: Record<string, any>, customResolver = async (_prefix: string, _expression: string) => ''): Promise<T> {
    const result = (is.array(obj) ? [] : {}) as Record<string, any>;
    for (const [key, value] of Object.entries(obj)) {
        const newKey = is.string(key) && key.includes('${') ? await render(key, context, customResolver) : key;

        if (is.string(value)) {
            result[newKey] = await evaluateExpression(value, context, customResolver);
        } else if (typeof value === 'object') {
            result[newKey] = await recursiveRender(value, context, customResolver);
        } else {
            result[newKey] = value;
        }
    }
    return result as T;
}
