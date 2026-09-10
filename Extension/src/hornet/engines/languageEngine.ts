import type { CancellationToken } from 'vscode';
import type { ServerCapabilities } from 'vscode-languageserver-protocol';

export enum ParseMode {
    Flyweight = 'flyweight',
    Tag = 'tag',
    Compiler = 'compiler',
    Hybrid = 'hybrid'
}

export interface IndexStatus {
    state: 'idle' | 'building' | 'ready' | 'failed';
    message: string;
    percentage?: number;
    phase?: 'discovering' | 'starting' | 'parsing' | 'indexing' | 'finalizing';
    completed?: number;
    total?: number;
    elapsedSeconds?: number;
}

/** Protocol values, rather than backend classes, cross the frontend boundary. */
export interface LanguageEngine {
    readonly mode: ParseMode;
    initialize(): Promise<void>;
    shutdown(): Promise<void>;
    restart(): Promise<void>;
    buildIndex?(): Promise<void>;
    getCapabilities(): ServerCapabilities;
    request<T>(method: string, params: unknown, token?: CancellationToken): Promise<T | null>;
    notify(method: string, params: unknown): Promise<void>;
}

export const capabilityForMethod: Record<string, keyof ServerCapabilities> = {
    'textDocument/completion': 'completionProvider', 'completionItem/resolve': 'completionProvider',
    'textDocument/hover': 'hoverProvider', 'textDocument/signatureHelp': 'signatureHelpProvider',
    'textDocument/definition': 'definitionProvider', 'textDocument/declaration': 'declarationProvider',
    'textDocument/typeDefinition': 'typeDefinitionProvider', 'textDocument/implementation': 'implementationProvider',
    'textDocument/references': 'referencesProvider', 'textDocument/prepareRename': 'renameProvider',
    'textDocument/rename': 'renameProvider', 'textDocument/codeAction': 'codeActionProvider',
    'codeAction/resolve': 'codeActionProvider', 'workspace/executeCommand': 'executeCommandProvider',
    'textDocument/documentSymbol': 'documentSymbolProvider', 'workspace/symbol': 'workspaceSymbolProvider',
    'textDocument/foldingRange': 'foldingRangeProvider', 'textDocument/formatting': 'documentFormattingProvider',
    'textDocument/rangeFormatting': 'documentRangeFormattingProvider',
    'textDocument/semanticTokens/full': 'semanticTokensProvider',
    'textDocument/inlayHint': 'inlayHintProvider', 'inlayHint/resolve': 'inlayHintProvider',
    'textDocument/prepareCallHierarchy': 'callHierarchyProvider',
    'callHierarchy/incomingCalls': 'callHierarchyProvider', 'callHierarchy/outgoingCalls': 'callHierarchyProvider',
    'textDocument/prepareTypeHierarchy': 'typeHierarchyProvider',
    'typeHierarchy/supertypes': 'typeHierarchyProvider', 'typeHierarchy/subtypes': 'typeHierarchyProvider'
};
