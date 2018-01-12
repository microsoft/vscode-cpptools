/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

'use strict';

const gulp = require('gulp');
const env = require('gulp-env')
const tslint = require('gulp-tslint');
const mocha = require('gulp-mocha');

gulp.task('allTests', () => {
    gulp.start('unitTests');
    gulp.start('integrationTests');
});

gulp.task('unitTests', () => {
    gulp.src('./out/test/unitTests', {read: false}).pipe(
        mocha({
            ui: "tdd"
        })
    ).once('error', err => {
        process.exit(1);
    })
    .once('end', () => {
        process.exit();
    })
});

gulp.task('integrationTests', () => {
    env.set({
            CODE_TESTS_PATH: "./out/test/integrationTests",
            CODE_TESTS_WORKSPACE: "./test/integrationTests/testAssets/SimpleCppProject"
        }
    );
    gulp.src('./test/runVsCodeTestsWithAbsolutePaths.js', {read: false}).pipe(
        mocha({
            ui: "tdd",
            delay: true
        })
    ).once('error', err => {
        process.exit(1);
    })
    .once('end', () => {
        process.exit();
    })
});

/// Misc Tasks
const allTypeScript = [
    'src/**/*.ts',
    '!**/*.d.ts',
    '!**/typings**'
];

const lintReporter = (output, file, options) => {
    //emits: src/helloWorld.c:5:3: warning: implicit declaration of function ‘prinft’
    var relativeBase = file.base.substring(file.cwd.length + 1).replace('\\', '/');
    output.forEach(e => {
        var message = relativeBase + e.name + ':' + (e.startPosition.line + 1) + ':' + (e.startPosition.character + 1) + ': ' + e.failure;
        console.log('[tslint] ' + message);
    });
};

gulp.task('tslint', () => {
    gulp.src(allTypeScript)
        .pipe(tslint({
            program: require('tslint').Linter.createProgram("./tsconfig.json"),
            configuration: "./tslint.json"
        }))
        .pipe(tslint.report(lintReporter, {
            summarizeFailureOutput: false,
            emitError: false
        }))
});