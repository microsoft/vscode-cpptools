/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */

import { describe, it } from 'mocha';
import { ok, strictEqual } from 'node:assert';
import { Async } from '../../src/Utility/Async/constructor';
import { is } from '../../src/Utility/System/guards';
import { hierarchy, typeOf } from '../../src/Utility/System/info';
import { verbose } from '../../src/Utility/Text/streams';
import { AnotherThree } from './examples/someclass';

class Foo {

}

class Bar extends Foo {

}

class Baz extends Async(class Baz {

})
{

}

class Buzz extends Async(class Buzz extends Baz.class {

})
{

}

function foo() {

}

describe('Type Information', () => {
    it('identify class of Async() type ', () => {
        console.log(hierarchy(AnotherThree).join('::'));
    });

    it('is not failing subtest', () => {
        ok(true, 'looks ok');
    });

    it('Show the names of what typeOf returns', async () => {
        verbose(`Foo: '${typeOf(Foo)}'`);
        verbose(`new Foo(): '${typeOf(new Foo())}'`);
        verbose(`Bar: '${typeOf(Bar)}'`);
        verbose(`new Bar(): '${typeOf(new Bar())}'`);
        verbose(`Baz: '${typeOf(Baz)}'`);
        verbose(`new Baz(): '${typeOf(new Baz())}'`);
        verbose(`await new Baz(): '${typeOf(await new Baz())}'`);
        verbose(`Buzz: '${typeOf(Buzz)}'`);
        verbose(`new Buzz(): '${typeOf(new Buzz())}'`);
        verbose(`await new Buzz(): '${typeOf(await new Buzz())}'`);
        verbose(`Date: '${typeOf(Date)}'`);
        verbose(`new Date(): '${typeOf(new Date())}'`);
        verbose(`foo: '${typeOf(foo)}'`);
        verbose(`function(): '${typeOf(function () { })}'`);
        verbose(`()=>{}: '${typeOf(() => { })}'`);
        verbose(`true: '${typeOf(true)}'`);
        verbose(`false: '${typeOf(false)}'`);
        verbose(`1: '${typeOf(1)}'`);
        verbose(`'': '${typeOf('')}'`);
        verbose(`[]: '${typeOf([])}'`);
        verbose(`{}: '${typeOf({})}'`);
        verbose(`null: '${typeOf(null)}'`);
        verbose(`undefined: '${typeOf(undefined)}'`);
        verbose(`NaN: '${typeOf(NaN)}'`);
    });

    it('can get the typeof as a string', async () => {
        strictEqual(typeOf(Foo), 'class Foo', 'Should return class Foo');
        strictEqual(typeOf(new Foo()), 'Foo', 'Should return Foo');
        strictEqual(typeOf(Bar), 'class Bar', 'Should return class Bar');
        strictEqual(typeOf(new Bar()), 'Bar', 'Should return Bar');
        strictEqual(typeOf(Baz), 'class Baz', 'Should return class Baz');
        strictEqual(typeOf(Buzz), 'class Buzz', 'Should return class Buzz');
        strictEqual(typeOf(await new Baz()), 'Baz', 'Should return Baz');
        strictEqual(typeOf(new Baz()), 'Promise<Baz>', 'Should return that it is a Promise to a Baz');
        strictEqual(typeOf(Date), 'class Date', 'Should return class Date');
        strictEqual(typeOf(new Date()), 'Date', 'Should return Date');
        strictEqual(typeOf(foo), 'function', 'Should return function');
        strictEqual(typeOf(function () { }), 'function', 'Should return function');
        strictEqual(typeOf(() => { }), 'function', 'Should return function');
        strictEqual(typeOf(true), 'boolean', 'Should return boolean');
        strictEqual(typeOf(false), 'boolean', 'Should return boolean');
        strictEqual(typeOf(1), 'number', 'Should return number');
        strictEqual(typeOf(''), 'string', 'Should return string');
        strictEqual(typeOf([]), 'Array', 'Should return Array');
        strictEqual(typeOf({}), 'Object', 'Should return Object');
        strictEqual(typeOf(null), 'null', 'Should return null');
        strictEqual(typeOf(undefined), 'undefined', 'Should return undefined');
        strictEqual(typeOf(NaN), 'NaN', 'Should return NaN');
    });

    it('knows what a constructor is', () => {
        ok(is.Constructor(Foo), 'Foo is a constructor');
        ok(is.Constructor(Bar), 'Bar is a constructor');
        ok(is.Constructor(Baz), 'Baz is a constructor');
        ok(is.Constructor(Buzz), 'Buzz is a constructor');
        ok(is.Constructor(Date), 'Built in type is a constructor');
        ok(is.Constructor(Boolean), 'Built in type is a constructor');
        ok(!is.Constructor(foo), 'foo is not a constructor');
        ok(!is.Constructor(function () { }), 'not a constructor');
        ok(!is.Constructor(() => { }), 'arrow function not a constructor');

        ok(!is.asyncConstructor(Foo), 'Foo is an async constructor');
        ok(!is.asyncConstructor(Bar), 'Bar is an async constructor');
        ok(is.asyncConstructor(Baz), 'Baz is an async constructor');
        ok(is.asyncConstructor(Buzz), 'Buzz is an async constructor');
        ok(!is.asyncConstructor(foo), 'foo is not an async constructor');
        ok(!is.asyncConstructor(foo), 'foo is not an async constructor');
        ok(!is.asyncConstructor(function () { }), 'not an async constructor');
        ok(!is.asyncConstructor(() => { }), 'arrow function not an async constructor');
    });

});
