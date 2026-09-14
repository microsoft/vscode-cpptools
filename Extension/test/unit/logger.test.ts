/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */

import * as assert from 'assert';
import { afterEach, beforeEach, describe, it } from 'mocha';
import * as sinon from 'sinon';
import type * as vscode from 'vscode';
import type { LocalizeStringParams } from '../../src/LanguageServer/localization';
import proxyquire = require('proxyquire');

type LoggerModule = typeof import('../../src/logger');

function createLogger(eol: string = '\n') {
    const chunks: string[] = [];
    let disposed = false;
    const write = (text: string): void => {
        assert.ok(!disposed, 'Output must be written before channel disposal');
        chunks.push(text);
    };
    const append = sinon.spy(write);
    const appendLine = sinon.spy((text: string): void => write(text + '\n'));
    const show = sinon.spy();
    const dispose = sinon.spy(() => { disposed = true; });
    const channel: vscode.OutputChannel = {
        name: 'C/C++', append, appendLine, show, dispose,
        hide: sinon.spy(), clear: sinon.spy(), replace: sinon.spy()
    };
    const createOutputChannel = sinon.stub().returns(channel);
    const getLoggingLevel = sinon.stub().returns(7);
    const sendInstrumentation = sinon.spy();
    const load = proxyquire.noCallThru();
    const localization = load('../../src/LanguageServer/localization', {
        '../common': {},
        '../nativeStrings': { lookupString: (_id: number, args: string[]): string => `Translated: ${args.join(' ')}` }
    }) as typeof import('../../src/LanguageServer/localization');
    const getLocalizedString = sinon.spy(localization.getLocalizedString);
    const logger = load('../../src/logger', {
        os: { EOL: eol },
        vscode: { window: { createOutputChannel } },
        './common': { getLoggingLevel },
        './instrumentation': { sendInstrumentation },
        './LanguageServer/extension': { CppSourceStr: 'C/C++' },
        './LanguageServer/localization': { getLocalizedString }
    }) as LoggerModule;
    return { logger, chunks, append, appendLine, show, dispose, createOutputChannel, getLoggingLevel, getLocalizedString, sendInstrumentation };
}

function message(text: string, indentSpaces: number = 0): LocalizeStringParams {
    return { text, indentSpaces, stringId: 0, stringArgs: [] };
}

function loadDeactivation(logger: LoggerModule, deactivate: () => Promise<void>): () => Promise<void> {
    const main = proxyquire.noCallThru()('../../src/main', {
        vscode: {},
        'vscode-tas-client': {},
        './Debugger/extension': { dispose: (): void => { } },
        './LanguageServer/extension': { deactivate },
        './common': {},
        './telemetry': { deactivate: async (): Promise<void> => { } },
        './LanguageServer/cppBuildTaskProvider': {},
        './LanguageServer/localization': {},
        './LanguageServer/persistentState': {},
        './LanguageServer/settings': {},
        './Utility/Async/returns': { returns: { undefined: (): void => { } } },
        './cppTools1': { CppTools1: class { } },
        './id': {},
        './instrumentation': {},
        './logger': logger,
        './platform': {}
    }) as typeof import('../../src/main');
    return main.deactivate;
}

describe('Native debug log output', () => {
    let clock: sinon.SinonFakeTimers;
    let fixture: ReturnType<typeof createLogger>;

    beforeEach(() => {
        clock = sinon.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
        fixture = createLogger();
    });

    afterEach(() => {
        try {
            fixture.logger.disposeOutputChannels();
        } finally {
            clock.restore();
        }
    });

    for (const eol of ['\n', '\r\n']) {
        it(`preserves localization and appendLine LF when os.EOL is ${JSON.stringify(eol)}`, () => {
            fixture = createLogger(eol);
            const params = [
                message('first\r\nsecond', 2),
                message(''),
                message('already terminated\n'),
                message('  trailing \t\0😀'),
                { text: 'fallback', stringId: 1, stringArgs: ['é', '路径'], indentSpaces: 4 }
            ];
            params.forEach(param => fixture.logger.logLocalized(param));
            params[0].text = 'changed after notification';

            assert.strictEqual(fixture.getLocalizedString.callCount, params.length);
            assert.deepStrictEqual(fixture.chunks, ['loggingLevel: 7\n']);
            clock.tick(49);
            assert.strictEqual(fixture.append.callCount, 0);
            clock.tick(1);
            assert.deepStrictEqual(fixture.chunks, [
                'loggingLevel: 7\n',
                '  first\r\nsecond\n\nalready terminated\n\n  trailing \t\0😀\n    Translated: é 路径\n'
            ]);
            assert.strictEqual(fixture.append.callCount, 1);
            assert.strictEqual(fixture.appendLine.callCount, 1);
            assert.strictEqual(fixture.createOutputChannel.callCount, 1);
            assert.strictEqual(fixture.show.callCount, 0);
        });
    }

    it('keeps native and ordinary diagnostics in order without delaying ordinary writes', () => {
        fixture = createLogger('\r\n');
        const subscriber = sinon.spy();
        fixture.logger.subscribeToAllLoggers(subscriber);
        fixture.logger.logLocalized(message('native first'));
        fixture.logger.log('ordinary');
        fixture.logger.logLocalized(message('native second'));
        fixture.logger.getOutputChannelLogger().appendLineAtLevel(7, 'extension');
        fixture.logger.logLocalized(message('native third'));
        fixture.logger.getOutputChannel().append('direct');

        assert.strictEqual(fixture.chunks.join(''),
            'loggingLevel: 7\nnative first\nordinary\nnative second\nextension\r\nnative third\ndirect');
        assert.ok(subscriber.calledOnceWithExactly('extension\r\n'));
        assert.strictEqual(fixture.sendInstrumentation.callCount, 1);
        assert.strictEqual(clock.countTimers(), 0);
        clock.tick(100);
        assert.strictEqual(fixture.chunks.length, 7);
    });

    it('does not introduce logging-level filtering or show the Output panel', () => {
        fixture.getLoggingLevel.returns(0);
        fixture.logger.logLocalized(message('native diagnostic'));
        clock.tick(50);

        assert.deepStrictEqual(fixture.chunks, ['native diagnostic\n']);
        assert.strictEqual(fixture.show.callCount, 0);
        fixture.logger.getOutputChannelLogger().appendLineAtLevel(1, 'filtered extension diagnostic');
        assert.deepStrictEqual(fixture.chunks, ['native diagnostic\n']);
    });

    it('flushes before an explicit request to show the channel', () => {
        fixture.logger.logLocalized(message('pending'));
        fixture.logger.showOutputChannel();

        assert.deepStrictEqual(fixture.chunks, ['loggingLevel: 7\n', 'pending\n']);
        assert.strictEqual(fixture.show.callCount, 1);
        assert.strictEqual(clock.countTimers(), 0);
    });

    it('flushes once before disposing the channel and cancels its timer', () => {
        fixture.logger.logLocalized(message('last diagnostic'));
        fixture.logger.disposeOutputChannels();
        fixture.logger.disposeOutputChannels();

        assert.deepStrictEqual(fixture.chunks, ['loggingLevel: 7\n', 'last diagnostic\n']);
        assert.ok(fixture.append.calledBefore(fixture.dispose));
        assert.strictEqual(clock.countTimers(), 0);
        clock.tick(1000);
        assert.strictEqual(fixture.append.callCount, 1);
    });

    it('does not create a channel when disposing an unused logger', () => {
        fixture.logger.disposeOutputChannels();
        assert.strictEqual(fixture.createOutputChannel.callCount, 0);
        assert.strictEqual(clock.countTimers(), 0);
    });

    it('continues flushing during delayed shutdown and flushes the final diagnostics before disposal', async () => {
        let completeShutdown: () => void = () => { throw new Error('Shutdown promise was not initialized'); };
        const shutdown = new Promise<void>(resolve => { completeShutdown = resolve; });
        const deactivate = loadDeactivation(fixture.logger, () => shutdown);
        fixture.logger.logLocalized(message('before shutdown'));
        const deactivation = deactivate();
        fixture.logger.logLocalized(message('during shutdown'));
        clock.tick(50);

        assert.strictEqual(fixture.dispose.callCount, 0);
        assert.strictEqual(fixture.chunks.join(''), 'loggingLevel: 7\nbefore shutdown\nduring shutdown\n');
        fixture.logger.logLocalized(message('last diagnostic'));
        completeShutdown();
        await deactivation;

        assert.strictEqual(fixture.chunks.join(''), 'loggingLevel: 7\nbefore shutdown\nduring shutdown\nlast diagnostic\n');
        assert.ok(fixture.append.calledBefore(fixture.dispose));
        assert.strictEqual(fixture.dispose.callCount, 1);
        assert.strictEqual(clock.countTimers(), 0);
    });

    it('flushes and disposes Output even if language-server shutdown rejects', async () => {
        const failure = new Error('Language-server shutdown failed');
        const deactivate = loadDeactivation(fixture.logger, async () => {
            fixture.logger.logLocalized(message('shutdown diagnostic'));
            throw failure;
        });
        fixture.logger.logLocalized(message('pending'));
        await assert.rejects(deactivate(), failure);

        assert.strictEqual(fixture.chunks.join(''), 'loggingLevel: 7\npending\nshutdown diagnostic\n');
        assert.ok(fixture.append.calledBefore(fixture.dispose));
        assert.strictEqual(fixture.dispose.callCount, 1);
        assert.strictEqual(clock.countTimers(), 0);
    });

    it('coalesces a notification burst into substantially fewer channel appends', () => {
        const messages: string[] = [];
        for (let index = 0; index < 10000; ++index) {
            const text = `/workspace/directory/file-${index}.cpp`;
            messages.push(text + '\n');
            fixture.logger.logLocalized(message(text));
        }
        fixture.logger.disposeOutputChannels();

        assert.strictEqual(fixture.chunks.join(''), 'loggingLevel: 7\n' + messages.join(''));
        assert.ok(fixture.append.callCount < messages.length / 100);
        assert.strictEqual(fixture.appendLine.callCount, 1);
        assert.strictEqual(clock.countTimers(), 0);
    });
});
