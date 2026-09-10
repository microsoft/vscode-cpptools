import type { CancellationToken } from 'vscode';
import { ModeManager } from './modeManager';
import { capabilityForMethod } from '../engines/languageEngine';

export class CapabilityRouter {
    constructor(private readonly modes: ModeManager, private readonly owns: (uri: string) => boolean = () => true) {}
    async request<T>(method: string, params: unknown, token?: CancellationToken): Promise<T | null> {
        if (token?.isCancellationRequested) { return null; }
        const input = params as { textDocument?: { uri: string }; item?: { uri: string } };
        const uri = input?.textDocument?.uri ?? input?.item?.uri;
        // Hierarchy items returned by this workspace's server may point into dependency headers.
        const hierarchyItem = method === 'callHierarchy/incomingCalls' || method === 'callHierarchy/outgoingCalls';
        if (uri && !this.owns(uri) && !hierarchyItem) { return null; }
        const engine = this.modes.getActiveEngine();
        const capability = capabilityForMethod[method];
        if (!engine || (capability && !engine.getCapabilities()[capability])) { return null; }
        try {
            const result = await engine.request<T>(method, params, token);
            return token?.isCancellationRequested || engine !== this.modes.getActiveEngine() ? null : result;
        } catch (error) {
            if (token?.isCancellationRequested || engine !== this.modes.getActiveEngine()) { return null; }
            throw error;
        }
    }
    async notify(method: string, params: unknown): Promise<void> {
        await this.modes.getActiveEngine()?.notify(method, params);
    }
}
