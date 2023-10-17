/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */

/* eslint-disable @typescript-eslint/no-unused-vars */
import { CommentArray, CommentObject, parse } from 'comment-json';
import { readFile } from 'fs/promises';
import { dirname } from 'path';

import { CancellationToken, Uri } from 'vscode';
import { SourceFileConfiguration, SourceFileConfigurationItem, Version, WorkspaceBrowseConfiguration } from 'vscode-cpptools';
import { CancellationTokenSource } from 'vscode-languageclient';
import { identifyToolset } from '../../ToolsetDetection/detection';
import { IntelliSenseConfiguration } from '../../ToolsetDetection/interfaces';
import { PriorityQueue } from '../../Utility/Async/priorityQueue';
import { returns } from '../../Utility/Async/returns';
import { filepath } from '../../Utility/Filesystem/filepath';
import { extractArgs } from '../../Utility/Process/commandLine';
import { is } from '../../Utility/System/guards';
import { getOrAdd } from '../../Utility/System/map';
import { elapsed } from '../../Utility/System/performance';
import { addNormalizedPath } from '../../Utility/System/set';
import { log } from '../../logger';
import { DefaultClient } from '../client';
import { Configuration } from '../configurations';
import { ConfigurationAdapter } from './configurationAdapter';
import { ExtendedBrowseInformation, IntellisenseConfigurationAdapter } from './interfaces';

type CompileCommand = CommentObject & {
    directory: string;
    file: string;
    command?: string;
    arguments?: string[];
    output?: string;
};

// create a static cancelled token
const cts = new CancellationTokenSource();
cts.cancel();
const cancelled = cts.token;

export class CompileCommandsConfigurationAdapter extends ConfigurationAdapter implements IntellisenseConfigurationAdapter {
    private intellisenseConfigurations = new PriorityQueue<IntelliSenseConfiguration>();

    private sourceFiles: Uri[] = [];

    isReady = true;
    isValid = true;

    get version() { return Version.latest; }
    get name() { return "CompileCommandsProvider"; }
    get extensionId() { return "built-in.compile-commands"; }

    private parsing: Promise<void> | undefined;

    private constructor(client: DefaultClient, private path: string, configuration: Configuration, private token?: CancellationToken) {
        super(client, configuration);
        log('CREATING CompileCommandsConfiguration');
    }

    async getSourceFiles(): Promise<Uri[]> {
        await this.parsing;
        return [...this.sourceFiles];
    }

    async getHeaderFiles(): Promise<Uri[]> {
        return [];
    }

    // we store a static map of instances that are tied to the filename+timestamp
    static instances = new Map<string, CompileCommandsConfigurationAdapter>();

    static async getProvider(client: DefaultClient, path: string, configuration: Configuration, token: CancellationToken): Promise<IntellisenseConfigurationAdapter | undefined> {
        const [jsonfile, stats] = await filepath.stats(path);
        if (stats) {
            const key = jsonfile + stats.mtime;
            const result = getOrAdd(this.instances, key, () => new CompileCommandsConfigurationAdapter(client, jsonfile, configuration, token));

            // delete old instances that have the same path
            for (const [k, v] of this.instances) {
                if (v.path === jsonfile && k !== key) {
                    v.token = cancelled;
                    this.instances.delete(k);
                }
            }

            // start it updating...
            void result.update();

            // return the instance
            return result;
        }
        return undefined;
    }

    update() {
        return this.parsing ?? (this.parsing = this.updateAsync());
    }

    private async updateAsync() {
        // reload the file
        const content = await readFile(this.path, 'utf8');
        const data = parse(content);
        if (!is.array(data)) {
            this.isValid = false;
            return;
        }

        const userIntellisenseConfiguration = this.client.configuration?.CurrentConfiguration?.intellisense;

        console.log(`${elapsed()} =>> Begin parsing compile_commands.json...`);

        this.intellisenseConfigurations.once('item', (key, value) => {
            // if we don't have a toolset selected in the configuration, let's
            // steal the one from the first file we find.
            if (!this.compiler) {
                this.compiler = value.compilerPath;
                if (!this.compilerArgs) {
                    this.compilerArgs = value.compilerArgs;
                }
            }
            this.initialized.resolve();
        });

        this.intellisenseConfigurations.on('item', (key, value) => {
            // propogate the event
            this.emit('configuration', key, value);
        });

        this.intellisenseConfigurations.on('empty', () => {
            this.emit('done');
            this.intellisenseConfigurations.removeAllListeners();
        });

        for (const cmd of data as CommentArray<CompileCommand>) {
            if (this.token?.isCancellationRequested) {
                break;
            }

            // we need to make sure that all files are passed thru Uri because the Uri class can modify things like the
            // drive letter on Windows (it lowercases it) -- so we normalize the path first.
            const uri = Uri.file(cmd.file);
            cmd.file = uri.fsPath;

            const args = is.array(cmd.arguments) ? cmd.arguments : is.string(cmd.command) ? extractArgs(cmd.command) : [];
            if (!args) {
                continue;
            }

            // grab the compiler from the arguments
            const tool = args.shift();
            if (!tool) {
                continue;
            }
            // we have a tool and some args,
            this.sourceFiles.push(uri);

            // add the source directory to the browse path
            addNormalizedPath(this.browseInfo.browsePaths, dirname(cmd.file));

            // start it processing
            void this.intellisenseConfigurations.enqueue(cmd.file, async () => {
                const toolset = await identifyToolset(tool);
                if (!toolset) {
                    throw new Error("Unable to identify toolset");
                }

                const isense = await toolset.getIntellisenseConfiguration(args, {baseDirectory: cmd.directory, sourceFile : cmd.file, userIntellisenseConfiguration });

                if ((isense.parserArgument?.length || 0) < 10) {
                    console.log("ouch");
                }

                // update the browse paths with info from the intellisense
                this.mergeBrowseInfo(isense);

                return isense;
            });
        }

        console.log(`${elapsed()} =>> Completed parsing compile_commands.json...`);
    }

    async canProvideConfiguration(uri: Uri, token?: CancellationToken | undefined): Promise<boolean> {
        await this.parsing;

        if (this.token?.isCancellationRequested || token?.isCancellationRequested) {
            return false;
        }

        return this.intellisenseConfigurations.has(uri.fsPath);
    }

    async provideConfigurations(uris: Uri[], token?: CancellationToken | undefined): Promise<SourceFileConfigurationItem[]> {
        await this.parsing;

        if (this.token?.isCancellationRequested || token?.isCancellationRequested) {
            return [];
        }

        // if they pass in a zero length array, assume they mean 'all that are ready'
        if (uris.length === 0) {
            uris = this.intellisenseConfigurations.completedKeys.map(each => Uri.file(each));
        }

        const result = [] as SourceFileConfigurationItem[];
        for (const uri of uris) {
            const intellisense = await this.intellisenseConfigurations.get(uri.fsPath).catch(returns.undefined);
            if (intellisense) {
                // trim stuff not needed.
                //* delete intellisense.path;
                delete intellisense.macro;
                result.push({
                    uri,
                    configuration: {
                        includePath: [],
                        defines: [],
                        intellisense,
                        enableNewIntellisense: true
                    } as SourceFileConfiguration
                });
            }
        }
        return result;
    }

    async canProvideBrowseConfiguration(token?: CancellationToken | undefined): Promise<boolean> {
        await this.parsing;

        if (this.token?.isCancellationRequested || token?.isCancellationRequested) {
            return false;
        }

        return true;
    }

    async provideBrowseConfiguration(token?: CancellationToken | undefined): Promise<WorkspaceBrowseConfiguration | null> {
        await this.parsing;

        if (this.token?.isCancellationRequested || token?.isCancellationRequested) {
            return null;
        }

        return { browsePath: [...this.browseInfo.browsePaths] };
    }

    async canProvideBrowseConfigurationsPerFolder(token?: CancellationToken | undefined): Promise<boolean> {
        // todo: support multi-root workspaces
        return false;
    }

    async provideFolderBrowseConfiguration(uri: Uri, token?: CancellationToken | undefined): Promise<WorkspaceBrowseConfiguration | null> {
        // todo: support multi-root workspaces
        return null;
    }

    dispose() {
        this.token = cancelled;
        CompileCommandsConfigurationAdapter.instances.delete(this.path);
    }

    override async getExtendedBrowseInformation(token: CancellationToken): Promise<ExtendedBrowseInformation> {
        await this.parsing;
        return super.getExtendedBrowseInformation(token);
    }
}

