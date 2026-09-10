import type { CompileCommand } from '../compdb/compileCommandsParser';

export enum HornetApiVersion { v1 = 1 }
export interface HornetCppApi {
    importCompilationDatabase(path: string, workspaceUri?: string): Promise<void>;
    importCompilationDatabases(paths: string[], workspaceUri?: string): Promise<void>;
    refreshIndex(workspaceUri?: string): Promise<void>;
    getCompileCommand(file: string): Promise<CompileCommand | undefined>;
}
export interface HornetCppExports { getApi(version: HornetApiVersion): HornetCppApi; }
