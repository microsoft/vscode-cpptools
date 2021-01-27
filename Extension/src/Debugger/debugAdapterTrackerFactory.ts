import * as vscode from 'vscode';
import { CppDbgDebugAdapterTracker } from './debugAdapterTracker';

export class CppDbgDebugAdapterTrackerFactory implements vscode.DebugAdapterTrackerFactory {

    activeTracker: CppDbgDebugAdapterTracker | undefined;

    createDebugAdapterTracker(session: vscode.DebugSession): vscode.ProviderResult<vscode.DebugAdapterTracker> {
        this.activeTracker = new CppDbgDebugAdapterTracker(session);
        return this.activeTracker;
    }

    getActiveDebugAdapterTracker(): CppDbgDebugAdapterTracker | undefined
    {
        return this.activeTracker;
    }
}