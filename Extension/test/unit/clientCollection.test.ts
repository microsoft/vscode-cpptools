/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */

import { it } from 'mocha';
import { strictEqual } from 'node:assert';
import * as sinon from 'sinon';
import proxyquire = require('proxyquire');

it('replays visible C++ editors to the replacement default client after recreation', async () => {
    class StubClient {
        public readonly RootFolder = undefined;
        public readonly TrackedDocuments = new Map<string, never>();
        public readonly deactivate = sinon.spy();
        public readonly dispose = sinon.spy();
        public readonly onDidChangeVisibleTextEditors = sinon.stub().resolves();
    }

    const cppEditor = { document: { languageId: 'cpp' } };
    const textEditor = { document: { languageId: 'plaintext' } };
    const visibleEditors = [cppEditor, textEditor];
    const createdClients: StubClient[] = [];
    const subscription = { dispose: sinon.spy() };
    const { ClientCollection }: typeof import('../../src/LanguageServer/clientCollection') = proxyquire.noCallThru()(
        '../../src/LanguageServer/clientCollection', {
            vscode: {
                window: { visibleTextEditors: visibleEditors },
                workspace: { onDidChangeWorkspaceFolders: () => subscription }
            },
            '../common': { isCpp: (document: { languageId: string }) => document.languageId === 'cpp' },
            '../telemetry': {},
            '../Utility/Async/returns': { logAndReturn: { undefined: (error: unknown) => { throw error; } } },
            './client': {
                createClient: () => {
                    const client = new StubClient();
                    createdClients.push(client);
                    return client;
                },
                DefaultClient: { stopLanguageClient: () => Promise.resolve() }
            },
            './customProviders': { getCustomConfigProviders: () => [] },
            './timeTelemetryCollector': { TimeTelemetryCollector: class { } }
        });
    const collection = new ClientCollection();
    try {
        const oldClient = collection.getDefaultClient();
        await collection.recreateClients();
        strictEqual(createdClients.length, 2, 'The default client should be replaced once');
        strictEqual(collection.getDefaultClient(), createdClients[1], 'The replacement should become the default client');
        sinon.assert.calledOnce(createdClients[0].dispose);
        sinon.assert.notCalled(createdClients[0].onDidChangeVisibleTextEditors);
        sinon.assert.calledOnceWithExactly(createdClients[1].onDidChangeVisibleTextEditors, [cppEditor]);
        strictEqual(visibleEditors.length, 2, 'Recreation should not change editor visibility');
        strictEqual(oldClient, createdClients[0], 'Only the isolated original client should be disposed');
    } finally {
        await collection.dispose();
    }
    sinon.assert.calledOnce(subscription.dispose);
});
