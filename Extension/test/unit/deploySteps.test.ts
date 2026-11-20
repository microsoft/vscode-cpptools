/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */

import { deepStrictEqual, strictEqual } from 'assert';
import * as childProcess from 'child_process';
import { EventEmitter } from 'events';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { afterEach, beforeEach, describe, it } from 'mocha';
import * as proxyquire from 'proxyquire';
import * as sinon from 'sinon';

interface HostInfo {
    hostName: string;
    user?: string;
    port?: number | string;
}

interface ProcessResult {
    succeeded: boolean;
    output: string;
    outputError: string;
}

interface TerminalCommandArgs {
    command: string;
}

interface SshCommandsModule {
    scp(files: { fsPath: string; }[], host: HostInfo, targetDir: string, recursive?: boolean, scpPath?: string, jumpHosts?: HostInfo[]): Promise<ProcessResult>;
    rsync(files: { fsPath: string; }[], host: HostInfo, targetDir: string, recursive?: boolean, rsyncPath?: string, jumpHosts?: HostInfo[]): Promise<ProcessResult>;
    ssh(host: HostInfo, command: string, sshPath?: string, jumpHosts?: HostInfo[]): Promise<ProcessResult>;
}

interface DebugConfigurationProviderForTest {
    singleDeployStep(config: Record<string, unknown>, step: Record<string, unknown>): Promise<boolean>;
}

interface ConfigurationProviderModule {
    DebugConfigurationProvider: new (assetProvider: unknown, type: string) => DebugConfigurationProviderForTest;
}

interface CommonModule {
    spawnChildProcess(program: string, args?: string[], continueOn?: string, skipLogging?: boolean): Promise<ProcessResult>;
}

const successfulResult: ProcessResult = { succeeded: true, output: '', outputError: '' };

function getFullHostAddressNoPort(host: HostInfo): string {
    return host.user ? `${host.user}@${host.hostName}` : host.hostName;
}

function getFullHostAddress(host: HostInfo): string {
    const address: string = getFullHostAddressNoPort(host);
    return host.port ? `${address}:${host.port}` : address;
}

function createModuleStub(overrides: Record<string, unknown> = {}): any {
    const fallback: any = new Proxy(function () { return fallback; }, {
        get: (_target, property) => property === 'then' ? undefined : fallback,
        apply: () => fallback,
        construct: () => fallback
    });

    const target: Record<string, unknown> = { '@noCallThru': true, ...overrides };
    return new Proxy(target, {
        get: (stubTarget, property) => property in stubTarget ? stubTarget[property as string] : fallback
    });
}

function createVscodeStub(): any {
    return createModuleStub({
        '@global': true,
        extensions: { getExtension: () => ({ packageJSON: { version: 'test' } }) },
        Uri: { file: (fsPath: string) => ({ fsPath }) }
    });
}

describe('SSH deploy commands', () => {
    let commands: SshCommandsModule;
    let runCommandStub: sinon.SinonStub;

    beforeEach(() => {
        proxyquire.noPreserveCache();
        runCommandStub = sinon.stub().resolves(successfulResult);
        commands = proxyquire('../../src/SSH/commands', {
            '../common': {
                getFullHostAddress,
                getFullHostAddressNoPort,
                '@noCallThru': true
            },
            './commandInteractors': {
                defaultSystemInteractor: {},
                '@noCallThru': true
            },
            './sshCommandRunner': {
                runSshTerminalCommandWithLogin: runCommandStub,
                '@noCallThru': true
            }
        });
    });

    afterEach(() => sinon.restore());

    it('honors a custom SCP path and disabled recursion', async () => {
        const host: HostInfo = { hostName: 'target', user: 'dev', port: 2222 };
        const jumpHosts: HostInfo[] = [{ hostName: 'jump', user: 'proxy', port: 2200 }];

        await commands.scp([{ fsPath: '/tmp/app' }], host, '/srv/app', false, '/opt/scp', jumpHosts);

        strictEqual((runCommandStub.firstCall.args[1] as TerminalCommandArgs).command,
            '"/opt/scp" -J proxy@jump:2200 -P 2222 "/tmp/app" dev@target:/srv/app');
    });

    it('uses the SSH remote shell for rsync jump hosts and ports', async () => {
        const host: HostInfo = { hostName: 'target', user: 'dev', port: 2222 };
        const jumpHosts: HostInfo[] = [{ hostName: 'jump', user: 'proxy', port: 2200 }];

        await commands.rsync([{ fsPath: '/tmp/app' }], host, '/srv/app', false, '/opt/rsync', jumpHosts);

        strictEqual((runCommandStub.firstCall.args[1] as TerminalCommandArgs).command,
            '"/opt/rsync" -lKpvz -e "ssh -J proxy@jump:2200 -p 2222" "/tmp/app" dev@target:/srv/app');
    });

    it('honors a custom SSH path', async () => {
        const host: HostInfo = { hostName: 'target', user: 'dev', port: 2222 };
        const jumpHosts: HostInfo[] = [{ hostName: 'jump', user: 'proxy', port: 2200 }];

        await commands.ssh(host, 'echo ready', '/opt/ssh', jumpHosts);

        strictEqual((runCommandStub.firstCall.args[1] as TerminalCommandArgs).command,
            '"/opt/ssh" -J proxy@jump:2200 -p 2222 dev@target "echo ready"');
    });
});

describe('deploy step option forwarding', () => {
    let provider: DebugConfigurationProviderForTest;
    let scpStub: sinon.SinonStub;
    let rsyncStub: sinon.SinonStub;
    let sshStub: sinon.SinonStub;

    beforeEach(() => {
        proxyquire.noPreserveCache();
        scpStub = sinon.stub().resolves(successfulResult);
        rsyncStub = sinon.stub().resolves(successfulResult);
        sshStub = sinon.stub().resolves(successfulResult);
        const globStub: any = (pattern: string, callback: (error: Error | null, matches: string[]) => void): void => callback(null, [`/resolved/${pattern}`]);
        globStub['@noCallThru'] = true;

        const passthroughStubs: Record<string, unknown> = {
            '../constants': createModuleStub({ isWindows: false }),
            '../expand': createModuleStub(),
            '../LanguageServer/cppBuildTaskProvider': createModuleStub(),
            '../LanguageServer/devcmd': createModuleStub(),
            '../LanguageServer/extension': createModuleStub(),
            '../LanguageServer/settings': createModuleStub(),
            '../logger': createModuleStub(),
            '../platform': createModuleStub(),
            '../telemetry': createModuleStub(),
            './attachQuickPick': createModuleStub(),
            './attachToProcess': createModuleStub(),
            './configurations': createModuleStub(),
            './nativeAttach': createModuleStub(),
            './ParsedEnvironmentFile': createModuleStub(),
            './utils': createModuleStub()
        };

        const moduleUnderTest: ConfigurationProviderModule = proxyquire('../../src/Debugger/configurationProvider', {
            ...passthroughStubs,
            glob: globStub,
            vscode: createVscodeStub(),
            '../common': createModuleStub({
                isString: (value: unknown) => typeof value === 'string',
                isArrayOfString: (value: unknown) => Array.isArray(value) && value.every(item => typeof item === 'string')
            }),
            '../SSH/commands': createModuleStub({
                scp: scpStub,
                rsync: rsyncStub,
                ssh: sshStub
            })
        });
        provider = new moduleUnderTest.DebugConfigurationProvider({}, 'cppdbg');
    });

    afterEach(() => sinon.restore());

    const config: Record<string, unknown> = {
        noDebug: false,
        recursive: true,
        scpPath: '/wrong/scp',
        rsyncPath: '/wrong/rsync',
        sshPath: '/wrong/ssh'
    };
    const host = {
        hostName: 'target',
        user: 'dev',
        port: 2222,
        jumpHosts: [{ hostName: 'jump', user: 'proxy', port: 2200 }]
    };

    it('forwards SCP options from the copy step', async () => {
        const succeeded: boolean = await provider.singleDeployStep(config, {
            type: 'scp',
            files: 'app',
            host,
            targetDir: '/srv/app',
            recursive: false,
            scpPath: '/opt/scp'
        });

        strictEqual(succeeded, true);
        sinon.assert.calledOnceWithExactly(scpStub,
            [{ fsPath: '/resolved/app' }],
            { hostName: 'target', user: 'dev', port: 2222 },
            '/srv/app',
            false,
            '/opt/scp',
            host.jumpHosts,
            undefined);
    });

    it('forwards rsync options from the copy step', async () => {
        const succeeded: boolean = await provider.singleDeployStep(config, {
            type: 'rsync',
            files: 'app',
            host,
            targetDir: '/srv/app',
            recursive: false,
            rsyncPath: '/opt/rsync'
        });

        strictEqual(succeeded, true);
        sinon.assert.calledOnceWithExactly(rsyncStub,
            [{ fsPath: '/resolved/app' }],
            { hostName: 'target', user: 'dev', port: 2222 },
            '/srv/app',
            false,
            '/opt/rsync',
            host.jumpHosts,
            undefined);
    });

    it('forwards the SSH path from the SSH step', async () => {
        const succeeded: boolean = await provider.singleDeployStep(config, {
            type: 'ssh',
            command: 'echo ready',
            host,
            sshPath: '/opt/ssh'
        });

        strictEqual(succeeded, true);
        sinon.assert.calledOnceWithExactly(sshStub,
            { hostName: 'target', user: 'dev', port: 2222 },
            'echo ready',
            '/opt/ssh',
            host.jumpHosts,
            undefined,
            undefined,
            undefined);
    });
});

describe('shell deploy step continueOn', () => {
    let common: CommonModule;
    let fakeProcess: EventEmitter & { stdout: EventEmitter; stderr: EventEmitter; kill: sinon.SinonStub; };
    let spawnStub: sinon.SinonStub;

    beforeEach(() => {
        proxyquire.noPreserveCache();
        fakeProcess = Object.assign(new EventEmitter(), {
            stdout: new EventEmitter(),
            stderr: new EventEmitter(),
            kill: sinon.stub()
        });
        spawnStub = sinon.stub().returns(fakeProcess);
        common = proxyquire('../../src/common', {
            child_process: {
                ...childProcess,
                spawn: spawnStub,
                '@noCallThru': true
            },
            vscode: createVscodeStub(),
            './logger': createModuleStub({
                getOutputChannelLogger: () => createModuleStub()
            }),
            './telemetry': createModuleStub()
        });
    });

    afterEach(() => sinon.restore());

    async function waitForSpawn(): Promise<void> {
        for (let attempt: number = 0; attempt < 10 && !spawnStub.called; attempt++) {
            await new Promise<void>(resolvePromise => setImmediate(resolvePromise));
        }
        strictEqual(spawnStub.called, true, 'child process was not spawned');
    }

    async function isSettled(promise: Promise<unknown>): Promise<boolean> {
        let settled: boolean = false;
        void promise.then(() => settled = true, () => settled = true);
        await new Promise<void>(resolvePromise => setImmediate(resolvePromise));
        return settled;
    }

    it('does not resolve when the pattern is absent', async () => {
        const processPromise: Promise<ProcessResult> = common.spawnChildProcess(process.execPath, [], 'ready', true);
        await waitForSpawn();

        fakeProcess.stdout.emit('data', Buffer.from('working'));

        strictEqual(await isSettled(processPromise), false);
        fakeProcess.emit('close', 0, null);
        strictEqual((await processPromise).succeeded, true);
    });

    it('resolves when the pattern starts at offset zero', async () => {
        const processPromise: Promise<ProcessResult> = common.spawnChildProcess(process.execPath, [], 'ready', true);
        await waitForSpawn();

        fakeProcess.stdout.emit('data', Buffer.from('ready'));

        strictEqual(await isSettled(processPromise), true);
        deepStrictEqual(await processPromise, { succeeded: true, exitCode: undefined, outputError: '', output: 'ready' });
    });
});

describe('deploy step schema', () => {
    function recursiveDefault(document: any, generated: boolean): unknown {
        const deploySteps: any = generated
            ? document.contributes.debuggers[0].configurationAttributes.launch.properties.deploySteps
            : document.definitions.DeploySteps;
        return deploySteps.items.anyOf[0].properties.recursive.default;
    }

    it('uses a boolean recursive default in the source and generated schemas', () => {
        const optionsSchema: any = JSON.parse(readFileSync(resolve(__dirname, '../../../tools/OptionsSchema.json'), 'utf8'));
        const packageJson: any = JSON.parse(readFileSync(resolve(__dirname, '../../../package.json'), 'utf8'));

        strictEqual(recursiveDefault(optionsSchema, false), true);
        strictEqual(recursiveDefault(packageJson, true), true);
    });
});
