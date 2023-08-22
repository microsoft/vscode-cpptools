/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */

import { promises as fs } from 'fs';
import * as glob from 'glob';
import * as os from 'os';
import * as path from 'path';
import {
    Configuration, ConfigurationDirective,
    ConfigurationEntry,
    HostConfigurationDirective, parse,
    ResolvedConfiguration,
    Type as ConfigurationEntryType
} from 'ssh-config';
import { promisify } from 'util';
import * as vscode from 'vscode';
import * as nls from 'vscode-nls';
import { ISshConfigHostInfo, resolveHome } from "../common";
import { isWindows } from '../constants';
import { getSshChannel } from '../logger';

nls.config({ messageFormat: nls.MessageFormat.bundle, bundleFormat: nls.BundleFormat.standalone })();
const localize: nls.LocalizeFunc = nls.loadMessageBundle();

const globAsync: (pattern: string, options?: glob.IOptions | undefined) => Promise<string[]> = promisify(glob);

const userSshConfigurationFile: string = path.resolve(os.homedir(), '.ssh/config');

const ProgramData: string = process.env.ALLUSERSPROFILE || process.env.PROGRAMDATA || 'C:\\ProgramData';
const systemSshConfigurationFile: string = isWindows ? `${ProgramData}\\ssh\\ssh_config` : '/etc/ssh/ssh_config';

// Stores if the SSH config files are parsed successfully.
// Only store root config files' failure status since included files are not modified by our extension.
// path => successful
export const parseFailures: Map<string, boolean> = new Map<string, boolean>();

export function getSshConfigurationFiles(): string[] {
    return [userSshConfigurationFile, systemSshConfigurationFile];
}

// Map: host -> info
export async function getSshConfigHostInfos(): Promise<Map<string, ISshConfigHostInfo>> {
    const hostInfos: Map<string, ISshConfigHostInfo> = new Map<string, ISshConfigHostInfo>();

    for (const configPath of getSshConfigurationFiles()) {
        const config: Configuration = await getSshConfiguration(configPath);
        const hosts: { [host: string]: string } = extractHostNames(config);
        Object.keys(hosts).forEach(name => hostInfos.set(name, { hostName: hosts[name], file: configPath }));
    }

    return hostInfos;
}

function extractHostNames(parsedConfig: Configuration): { [host: string]: string } {
    const hostNames: { [host: string]: string } = Object.create(null);

    extractHosts(parsedConfig).forEach(host => {
        const resolvedConfig: ResolvedConfiguration = parsedConfig.compute(host);
        if (resolvedConfig.HostName) {
            hostNames[host] = resolvedConfig.HostName;
        } else {
            hostNames[host] = host;
        }
    });

    return hostNames;
}

/**
 * Gets parsed SSH configuration from file. Resolves Include directives as well unless specified otherwise.
 * @param configurationPath the location of the config file
 * @param resolveIncludes by default this is set to true
 * @returns
 */
export async function getSshConfiguration(configurationPath: string, resolveIncludes: boolean = true): Promise<Configuration> {
    parseFailures.set(configurationPath, false);
    const src: string = await getSshConfigSource(configurationPath);
    let parsedSrc: Configuration | undefined;
    try {
        parsedSrc = parse(src);
    } catch (err) {
        parseFailures.set(configurationPath, true);
        getSshChannel().appendLine(localize("failed.to.parse.SSH.config", "Failed to parse SSH configuration file {0}: {1}", configurationPath, (err as Error).message));
        return parse('');
    }
    const config: Configuration = caseNormalizeConfigProps(parsedSrc);
    if (resolveIncludes) {
        await resolveConfigIncludes(config, configurationPath);
    }
    return config;
}

async function resolveConfigIncludes(config: Configuration, configPath: string): Promise<void> {
    for (const entry of config) {
        if (isDirective(entry) && entry.param === 'Include') {
            let includePath: string = resolveHome(entry.value);
            if (isWindows && !!includePath.match(/^\/[a-z]:/i)) {
                includePath = includePath.substr(1);
            }

            if (!path.isAbsolute(includePath)) {
                includePath = path.resolve(path.dirname(configPath), includePath);
            }

            const pathsToGetFilesFrom: string[] = await globAsync(includePath);

            for (const filePath of pathsToGetFilesFrom) {
                await getIncludedConfigFile(config, filePath);
            }
        }
    }
}

async function getIncludedConfigFile(config: Configuration, includePath: string): Promise<void> {
    let includedContents: string;
    try {
        includedContents = (await fs.readFile(includePath)).toString();
    } catch (e) {
        getSshChannel().appendLine(localize("failed.to.read.file", "Failed to read file {0}.", includePath));
        return;
    }

    let parsedIncludedContents: Configuration | undefined;
    try {
        parsedIncludedContents = parse(includedContents);
    } catch (err) {
        getSshChannel().appendLine(localize("failed.to.parse.SSH.config", "Failed to parse SSH configuration file {0}: {1}", includePath, (err as Error).message));
        return;
    }
    config.push(...parsedIncludedContents);
}

export async function writeSshConfiguration(configurationPath: string, configuration: Configuration): Promise<void> {
    configurationPath = resolveHome(configurationPath);
    try {
        await vscode.workspace.fs.createDirectory(vscode.Uri.file(path.dirname(configurationPath)));
        await fs.writeFile(configurationPath, configuration.toString());
    } catch (e) {
        getSshChannel().appendLine(localize("failed.to.write.file", "Failed to write to file {0}.", configurationPath));
    }
}

async function getSshConfigSource(configurationPath: string): Promise<string> {
    configurationPath = resolveHome(configurationPath);
    try {
        const buffer: Buffer = await fs.readFile(configurationPath);
        return buffer.toString('utf8');
    } catch (e) {
        parseFailures.set(configurationPath, true);
        if ((e as NodeJS.ErrnoException).code === 'ENOENT') {
            return '';
        }
        getSshChannel().appendLine(localize("failed.to.read.file", "Failed to read file {0}.", configurationPath));
    }

    return '';
}

function isDirective(c: ConfigurationEntry): c is ConfigurationDirective {
    return c.type === ConfigurationEntryType.Directive;
}

function isHostDirective(c: ConfigurationEntry | HostConfigurationDirective): c is HostConfigurationDirective {
    return isDirective(c) && c.param === 'Host' && !!c.value && !!(c as HostConfigurationDirective).config;
}

/**
 * List of props that we care about and should be case-normalized, should match ResolvedConfiguration type
 */
const CASE_NORMALIZED_PROPS: Map<string, string> = new Map([
    ['host', 'Host'],
    ['hostname', 'HostName'],
    ['identityfile', 'IdentityFile'],
    ['user', 'User'],
    ['port', 'Port'],
    ['connecttimeout', 'ConnectTimeout'],
    ['remotecommand', 'RemoteCommand'],
    ['localforward', 'LocalForward']
]);
function caseNormalizeConfigProps(config: Configuration): Configuration {
    const caseNormalizeDirective: (entry: { param: string }) => void =
        (entry: { param: string }) => entry.param = CASE_NORMALIZED_PROPS.get(entry.param.toLowerCase()) || entry.param;

    config.filter(isDirective).forEach(entry => {
        caseNormalizeDirective(entry);

        // Only two levels deep
        if (isHostDirective(entry)) {
            entry.config.filter(isDirective).forEach(caseNormalizeDirective);
        }
    });

    return config;
}

function extractHosts(parsedConfig: Configuration): string[] {
    const hosts: Set<string> = new Set<string>();
    parsedConfig.filter(isHostDirective).forEach(c => {
        getHostsFromHostConfig(c.value).forEach(h => hosts.add(h));
    });

    return Array.from(hosts.keys());
}

function getHostsFromHostConfig(hostValue: string | string[]): string[] {
    const hosts: string[] = Array.isArray(hostValue) ? hostValue : [hostValue];

    return hosts.filter(h => !containsWildcard(h) && !h.match(/^\s*$/) && !h.match(/^!/));
}

function containsWildcard(str: string): boolean {
    return !!str.match(/[?*]/);
}
