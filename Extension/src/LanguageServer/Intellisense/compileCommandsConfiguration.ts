/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */

/* eslint-disable @typescript-eslint/no-unused-vars */
import { CommentArray, CommentObject, parse } from 'comment-json';
import { readFile } from 'fs/promises';
import { dirname } from 'path';

import { CancellationToken, Uri } from 'vscode';
import { SourceFileConfigurationItem, Version, WorkspaceBrowseConfiguration } from 'vscode-cpptools';
import { CancellationTokenSource } from 'vscode-languageclient';
import { identifyToolset } from '../../ToolsetDetection/detection';
import { IntelliSenseConfiguration } from '../../ToolsetDetection/interfaces';
import { filepath } from '../../Utility/Filesystem/filepath';
import { extractArgs } from '../../Utility/Process/commandLine';
import { is } from '../../Utility/System/guards';
import { getOrAdd } from '../../Utility/System/map';
import { DefaultClient } from '../client';
import { Configuration } from '../configurations';
import { IntellisenseConfiguration } from './intellisenseConfiguration';
import { ExtendedBrowseInformation, IntellisenseConfigurationProvider } from './interfaces';

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

export class CompileCommandsConfiguration extends IntellisenseConfiguration implements IntellisenseConfigurationProvider {
    private intellisenseConfigurations = new Map<string, IntelliSenseConfiguration>();
    private browsePaths = new Set<string>();
    private systemPaths = new Set<string>();
    private userFrameworks = new Set<string>();
    private systemFrameworks = new Set<string>();

    isReady = true;
    isValid = true;

    get version() { return Version.latest; }
    get name() { return "CompileCommandsProvider"; }
    get extensionId() { return "built-in.compile-commands"; }

    private updating: Promise<void> | undefined;

    private constructor(client: DefaultClient, private path: string, configuration: Configuration, private token?: CancellationToken) {
        super(client, configuration);
    }

    async getSourceFiles(): Promise<Uri[]> {
        await this.updating;
        return [...this.intellisenseConfigurations.keys()].map(key => Uri.file(key));
    }

    async getHeaderFiles(): Promise<Uri[]> {
        return [];
    }

    // we store a static map of instances that are tied to the filename+timestamp
    static instances = new Map<string, CompileCommandsConfiguration>();

    static async getProvider(client: DefaultClient, path: string, configuration: Configuration, token: CancellationToken): Promise<IntellisenseConfigurationProvider | undefined> {
        const [jsonfile, stats] = await filepath.stats(path);
        if (stats) {
            const key = jsonfile + stats.mtime;
            const result = getOrAdd(this.instances, key, () => new CompileCommandsConfiguration(client, jsonfile, configuration, token));

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
        return this.updating ?? (this.updating = this.updateAsync());
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

        const done = [] as Promise<void>[];

        for (const cmd of data as CommentArray<CompileCommand>) {
            if (this.token?.isCancellationRequested) {
                break;
            }

            // we need to make sure that all files are passed thru Uri because the Uri class can modify things like the
            // drive letter on Windows (it lowercases it) -- so we normalize the path first.
            const uri = Uri.file(cmd.file);
            cmd.file = uri.fsPath;

            const args = is.array(cmd.arguments) ? cmd.arguments : is.string(cmd.command) ? extractArgs(cmd.command) : undefined;
            if (!args) {
                continue;
            }

            // grab the compiler from the arguments
            const tool = args.shift();
            if (!tool) {
                continue;
            }

            // get the toolset
            const toolset = await identifyToolset(tool);
            if (!toolset) {
                continue;
            }

            // get the intellisense configuration
            done.push(toolset.getIntellisenseConfiguration(args, {baseDirectory: cmd.directory, sourceFile : cmd.file, userIntellisenseConfiguration }).then(isense => {
                this.intellisenseConfigurations.set(cmd.file, isense);
                this.browsePaths.add(dirname(cmd.file));
                this.mergeBrowseInfo({ browsePaths: this.browsePaths, systemPaths: this.systemPaths, userFrameworks: this.userFrameworks, systemFrameworks: this.systemFrameworks }, isense);

                // if the configuration has changed since the last time we saw it, store it and tell the client that we have a custom config for it.
                //if (! deepEqual(isense, CompileCommandsConfigurationProvider.intellisenseConfigurations[cmd.file])) {
                // this.intellisenseConfigurations[cmd.file] = isense;
                // return this.client.sendNewIntellisenseConfigurationForFile(uri);
                //}
            }));
        }
        // wait for the work to complete
        await Promise.all(done);
    }

    async canProvideConfiguration(uri: Uri, token?: CancellationToken | undefined): Promise<boolean> {
        await this.updating;

        if (this.token?.isCancellationRequested || token?.isCancellationRequested) {
            return false;
        }

        return !!this.intellisenseConfigurations.get(uri.fsPath);
    }

    async provideConfigurations(uris: Uri[], token?: CancellationToken | undefined): Promise<SourceFileConfigurationItem[]> {
        await this.updating;

        if (this.token?.isCancellationRequested || token?.isCancellationRequested) {
            return [];
        }

        return uris.map(uri => ({
            uri,
            configuration: {
                includePath: [],
                defines: [],
                intellisense: this.intellisenseConfigurations.get(uri.fsPath),
                enableNewIntellisense: true
            }
        }));
    }

    async canProvideBrowseConfiguration(token?: CancellationToken | undefined): Promise<boolean> {
        await this.updating;

        if (this.token?.isCancellationRequested || token?.isCancellationRequested) {
            return false;
        }

        return true;
    }

    async provideBrowseConfiguration(token?: CancellationToken | undefined): Promise<WorkspaceBrowseConfiguration | null> {
        await this.updating;

        if (this.token?.isCancellationRequested || token?.isCancellationRequested) {
            return null;
        }

        return { browsePath: [...this.browsePaths] };
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
        CompileCommandsConfiguration.instances.delete(this.path);
    }

    async getExtendedBrowseInformation(token: CancellationToken): Promise<ExtendedBrowseInformation> {
        await this.updating;

        return {
            browsePath: [...this.browsePaths],
            systemPath: [...this.systemPaths],
            userFrameworks: [...this.userFrameworks],
            systemFrameworks: [...this.systemFrameworks]
        };
    }
}

