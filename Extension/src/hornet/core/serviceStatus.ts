import { IndexStatus, ParseMode } from '../engines/languageEngine';

export const availableModes = [ParseMode.Compiler, ParseMode.Hybrid] as const;
export type ServiceState = 'starting' | 'ready' | 'needsSetup' | 'stopped';

export function resolveMode(configured: string): { mode: ParseMode; notice?: string } {
    if (availableModes.some(mode => mode === configured)) { return { mode: configured as ParseMode }; }
    return { mode: ParseMode.Compiler, notice: `Saved mode "${configured}" is unavailable. Using Compiler for this session.` };
}

export function serviceStatus(state: ServiceState, mode?: ParseMode, index?: IndexStatus): { text: string; command: string } {
    if (state === 'needsSetup') { return { text: '$(warning) Hornet: Retry clangd', command: 'hornet-cpp.autoSetupClangd' }; }
    if (state === 'stopped') { return { text: '$(warning) Hornet: Stopped', command: 'hornet-cpp.restartLanguageServices' }; }
    if (index?.state === 'building') {
        const stage = { discovering: 'Discovering sources', starting: 'Starting index', parsing: 'Parsing source', indexing: 'Indexing', finalizing: 'Finalizing index' };
        const count = index.completed !== undefined && index.total !== undefined ? ` ${index.completed}/${index.total}` : '';
        const percent = index.percentage === undefined ? '' : ` ${index.percentage}%`;
        const elapsed = index.elapsedSeconds ? ` · ${index.elapsedSeconds}s` : '';
        return { text: `$(sync~spin) Hornet: ${stage[index.phase ?? 'indexing']}${percent}${count}${elapsed}`, command: 'hornet-cpp.openLogs' };
    }
    if (state === 'starting') { return { text: '$(sync~spin) Hornet: Starting', command: 'hornet-cpp.switchMode' }; }
    if (index?.state === 'failed') { return { text: '$(warning) Hornet: Index failed', command: 'hornet-cpp.buildProjectIndex' }; }
    if (index?.state === 'ready') { return { text: '$(database) Hornet: Index ready', command: 'hornet-cpp.buildProjectIndex' }; }
    return { text: `$(symbol-namespace) Hornet: ${mode === ParseMode.Hybrid ? 'Hybrid' : 'Compiler'}`, command: 'hornet-cpp.switchMode' };
}
