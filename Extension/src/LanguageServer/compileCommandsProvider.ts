/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */

/* eslint-disable @typescript-eslint/no-unused-vars */
import { CommentArray, CommentObject, parse } from 'comment-json';
import { readFile } from 'fs/promises';
import * as vscode from 'vscode';
import { CancellationToken, Uri } from 'vscode';
import { SourceFileConfigurationItem, Version, WorkspaceBrowseConfiguration } from 'vscode-cpptools';
import { identifyToolset } from '../ToolsetDetection/detection';
import { IntelliSenseConfiguration } from '../ToolsetDetection/interfaces';
import { extractArgs } from '../Utility/Process/commandLine';
import { deepEqual } from '../Utility/System/equality';
import { is } from '../Utility/System/guards';
import { DefaultClient } from './client';
import { CustomConfigurationProvider1 } from './customProviders';

type CompileCommand = CommentObject & {
    directory: string;
    file: string;
    command?: string;
    arguments?: string[];
    output?: string;
};

export class CompileCommandsConfigurationProvider implements CustomConfigurationProvider1 {
    isReady = true;
    isValid = true;
    version = Version.latest;
    name = "CompileCommandsProvider";
    extensionId = "built-in.compile-commands";

    private intellisenseConfigurations = {} as Record<string, IntelliSenseConfiguration>;
    private oldIntellisenseConfigurations = {} as Record<string, IntelliSenseConfiguration>;
    private updating: Promise<void> | undefined;
    private cancelling = false;

    constructor(private client: DefaultClient, private path: string) {
    }

    update() {
        if (this.updating) {
            if (this.cancelling) {
                // we're already cancelling, (which means there's already another update requested that hasn't started)
                // return that update, because it's the same.
                return this.updating;
            }

            // cancel the current update, and start a new one after that one is done.
            this.cancelling = true;
            this.updating = this.updating.then(() => this.updateAsync());
        }

        // start an update
        return this.updating = this.updateAsync();
    }

    private async updateAsync() {
        this.cancelling = false;
        this.oldIntellisenseConfigurations = this.intellisenseConfigurations;
        this.intellisenseConfigurations = {};

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
            if (this.cancelling) {
                // bail if we're being interrupted.
                this.cancelling = false;
                return;
            }

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
            const isense = await toolset.getIntellisenseConfiguration(args, {baseDirectory: cmd.directory, sourceFile : cmd.file, userIntellisenseConfiguration });
            this.intellisenseConfigurations[cmd.file] = isense;

            if (!deepEqual(isense, this.oldIntellisenseConfigurations[cmd.file])) {
                // did it change? tell the client that we have a custom config for it.
                done.push(this.client.provideCustomConfiguration(vscode.Uri.file(cmd.file), undefined /* ???  */, true /* ??? */, this));
            }
        }
        // wait for the work to complete
        await Promise.all(done);

        // if we made it to the end without being cancelled, then we're we can remove the updating
        if (!this.cancelling) {
            this.updating = undefined;
        }
    }

    async canProvideConfiguration(uri: Uri, token?: CancellationToken | undefined): Promise<boolean> {
        return !!(this.intellisenseConfigurations[uri.fsPath] || this.oldIntellisenseConfigurations[uri.fsPath]);
    }

    async provideConfigurations(uris: Uri[], token?: CancellationToken | undefined): Promise<SourceFileConfigurationItem[]> {
        return uris.map(uri => {
            const intellisense = this.intellisenseConfigurations[uri.fsPath] || this.oldIntellisenseConfigurations[uri.fsPath];
            return {
                uri,
                configuration: {
                    includePath: [],
                    defines: [],
                    intellisense
                } };
        });
    }

    async canProvideBrowseConfiguration(token?: CancellationToken | undefined): Promise<boolean> {
        return false;
    }

    async provideBrowseConfiguration(token?: CancellationToken | undefined): Promise<WorkspaceBrowseConfiguration | null> {
        return null;
    }

    async canProvideBrowseConfigurationsPerFolder(token?: CancellationToken | undefined): Promise<boolean> {
        return false;
    }

    async provideFolderBrowseConfiguration(uri: Uri, token?: CancellationToken | undefined): Promise<WorkspaceBrowseConfiguration | null> {
        return null;
    }

    dispose() {

    }

}
