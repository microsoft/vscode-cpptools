/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */

declare module 'ssh-config' {
    export type LeafConfigurationEntry = ConfigurationDirective | ConfigurationComment;
    export type ConfigurationEntry = HostConfigurationDirective | LeafConfigurationEntry;

    export const enum Type {
        Directive = 1,
        Comment = 2,
    }

    export interface Configuration extends Array<ConfigurationEntry> {
        compute(host: string): ResolvedConfiguration;

        /**
         * Appends a map of parameters to values. If "Host" is included
         * as one of the keys, all subsequent keys will be nested under
         * that host entry.
         */
        append(options: { [key: string]: string }): void;

        /**
         * Prepends a map of parameters to values. If "Host" is included
         * as one of the keys, all subsequent keys will be nested under
         * that host entry.
         */
        prepend(options: { [key: string]: string }, beforeFirstSection: boolean): void;

        /**
         * Removes section by Host or other criteria.
         */
        remove(options: { [key: string]: string }): void;

        /**
         * Prints the properly formatted configuration.
         */
        toString(): string;
    }

    /**
     * Should match CASE_NORMALIZED_PROPS to be normalized to this casing
     */
    export interface ResolvedConfiguration {
        Host: string;
        HostName: string;
        IdentityFile?: string[];
        User?: string;
        Port?: string;
        ConnectTimeout?: string;
        RemoteCommand?: string;
        LocalForward?: string[];
        AddressFamily?: string;
    }

    export interface BaseConfigurationDirective {
        type: Type.Directive;
        param: string;
        value: string | string[];
    }

    export interface ConfigurationDirective extends BaseConfigurationDirective {
        value: string;
    }

    export interface HostConfigurationDirective extends BaseConfigurationDirective {
        param: 'Host';
        config: LeafConfigurationEntry[];
    }

    export interface ConfigurationComment {
        type: Type.Comment;
        content: string;
    }

    export function parse(raw: string): Configuration;

    export function stringify(directive: readonly HostConfigurationDirective[]): string;
}
