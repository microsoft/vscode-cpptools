import * as vscode from 'vscode';
import * as lsp from 'vscode-languageserver-protocol';
import * as protocolConverter from 'vscode-languageclient/lib/common/protocolConverter';
import * as codeConverter from 'vscode-languageclient/lib/common/codeConverter';
import { CapabilityRouter } from '../core/capabilityRouter';

export const toCode = protocolConverter.createConverter(undefined, false, false);
export const toProtocol = codeConverter.createConverter();
export const textPosition = (document: vscode.TextDocument, position: vscode.Position) => ({ textDocument: { uri: document.uri.toString() }, position: { line: position.line, character: position.character } });

export function registerLanguageProviders(selector: vscode.DocumentSelector, router: CapabilityRouter,
    capabilities: lsp.ServerCapabilities, root: vscode.Uri, refresh: vscode.Event<void>): vscode.Disposable {
    const disposables: vscode.Disposable[] = [];
    const request = <T>(method: string, params: unknown, token?: vscode.CancellationToken) => router.request<T>(method, params, token);
    const config = () => vscode.workspace.getConfiguration('hornet-cpp', root);
    const uri = (document: vscode.TextDocument) => ({ textDocument: { uri: document.uri.toString() } });

    if (capabilities.completionProvider) {
        disposables.push(vscode.languages.registerCompletionItemProvider(selector, {
            async provideCompletionItems(document, position, token, context) {
                const result = await request<lsp.CompletionItem[] | lsp.CompletionList>('textDocument/completion', {
                    ...textPosition(document, position), context: { triggerKind: context.triggerKind + 1, triggerCharacter: context.triggerCharacter }
                }, token);
                return toCode.asCompletionResult(result);
            },
            async resolveCompletionItem(item, token) {
                if (!capabilities.completionProvider?.resolveProvider) { return item; }
                const result = await request<lsp.CompletionItem>('completionItem/resolve', await toProtocol.asCompletionItem(item), token);
                return result ? toCode.asCompletionItem(result) : item;
            }
        }, ...(capabilities.completionProvider.triggerCharacters ?? ['.', '>'])));
    }
    if (capabilities.hoverProvider) {
        disposables.push(vscode.languages.registerHoverProvider(selector, {
            async provideHover(d, p, t) { return toCode.asHover(await request<lsp.Hover>('textDocument/hover', textPosition(d, p), t)); }
        }));
    }
    if (capabilities.signatureHelpProvider) {
        disposables.push(vscode.languages.registerSignatureHelpProvider(selector, {
            async provideSignatureHelp(d, p, t) { return toCode.asSignatureHelp(await request<lsp.SignatureHelp>('textDocument/signatureHelp', textPosition(d, p), t)); }
        }, ...(capabilities.signatureHelpProvider.triggerCharacters ?? ['(', ','])));
    }
    const definition = async (method: string, d: vscode.TextDocument, p: vscode.Position, t: vscode.CancellationToken) =>
        toCode.asDefinitionResult(await request<lsp.Definition | lsp.DefinitionLink[]>(method, textPosition(d, p), t));
    if (capabilities.definitionProvider) { disposables.push(vscode.languages.registerDefinitionProvider(selector, { provideDefinition: (d, p, t) => definition('textDocument/definition', d, p, t) })); }
    if (capabilities.declarationProvider) { disposables.push(vscode.languages.registerDeclarationProvider(selector, { provideDeclaration: (d, p, t) => definition('textDocument/declaration', d, p, t) })); }
    if (capabilities.typeDefinitionProvider) { disposables.push(vscode.languages.registerTypeDefinitionProvider(selector, { provideTypeDefinition: (d, p, t) => definition('textDocument/typeDefinition', d, p, t) })); }
    if (capabilities.implementationProvider) { disposables.push(vscode.languages.registerImplementationProvider(selector, { provideImplementation: (d, p, t) => definition('textDocument/implementation', d, p, t) })); }
    if (capabilities.referencesProvider) {
        disposables.push(vscode.languages.registerReferenceProvider(selector, {
            async provideReferences(d, p, context, t) { return toCode.asReferences(await request<lsp.Location[]>('textDocument/references', { ...textPosition(d, p), context }, t)); }
        }));
    }
    if (capabilities.renameProvider) {
        disposables.push(vscode.languages.registerRenameProvider(selector, {
            async prepareRename(d, p, t) {
                if (typeof capabilities.renameProvider !== 'object' || !capabilities.renameProvider.prepareProvider) {
                    return d.getWordRangeAtPosition(p);
                }
                const result = await request<lsp.Range | { range: lsp.Range; placeholder: string } | { defaultBehavior: boolean }>('textDocument/prepareRename', textPosition(d, p), t);
                if (!result) { throw new Error('Rename is unavailable here. Hybrid requires a compile command for this file.'); }
                if ('range' in result) { return { range: toCode.asRange(result.range), placeholder: result.placeholder }; }
                if ('defaultBehavior' in result) { return d.getWordRangeAtPosition(p); }
                return toCode.asRange(result);
            },
            async provideRenameEdits(d, p, newName, t) { return toCode.asWorkspaceEdit(await request<lsp.WorkspaceEdit>('textDocument/rename', { ...textPosition(d, p), newName }, t)); }
        }));
    }
    if (capabilities.documentSymbolProvider) {
        disposables.push(vscode.languages.registerDocumentSymbolProvider(selector, {
            async provideDocumentSymbols(d, t) {
                const result = await request<lsp.DocumentSymbol[] | lsp.SymbolInformation[]>('textDocument/documentSymbol', uri(d), t);
                if (!result?.length) { return []; }
                return 'location' in result[0] ? toCode.asSymbolInformations(result as lsp.SymbolInformation[]) : toCode.asDocumentSymbols(result as lsp.DocumentSymbol[]);
            }
        }));
    }
    if (capabilities.workspaceSymbolProvider) {
        disposables.push(vscode.languages.registerWorkspaceSymbolProvider({
            async provideWorkspaceSymbols(query, token) { return toCode.asSymbolInformations(await request<lsp.SymbolInformation[]>('workspace/symbol', { query }, token)); }
        }));
    }
    if (capabilities.foldingRangeProvider) {
        disposables.push(vscode.languages.registerFoldingRangeProvider(selector, {
            async provideFoldingRanges(d, _context, t) { return toCode.asFoldingRanges(await request<lsp.FoldingRange[]>('textDocument/foldingRange', uri(d), t)); }
        }));
    }
    if (capabilities.documentFormattingProvider) {
        disposables.push(vscode.languages.registerDocumentFormattingEditProvider(selector, {
            async provideDocumentFormattingEdits(d, options, t) { return toCode.asTextEdits(await request<lsp.TextEdit[]>('textDocument/formatting', { ...uri(d), options }, t)); }
        }));
    }
    if (capabilities.documentRangeFormattingProvider) {
        disposables.push(vscode.languages.registerDocumentRangeFormattingEditProvider(selector, {
            async provideDocumentRangeFormattingEdits(d, range, options, t) { return toCode.asTextEdits(await request<lsp.TextEdit[]>('textDocument/rangeFormatting', { ...uri(d), range: toProtocol.asRange(range), options }, t)); }
        }));
    }
    if (capabilities.codeActionProvider) {
        const originalActions = new WeakMap<vscode.CodeAction, { action: lsp.CodeAction; document: vscode.Uri }>();
        const wrapCommand = (command: vscode.Command, document: vscode.Uri): vscode.Command => ({
            title: command.title, command: 'hornet-cpp.executeServerCommand', arguments: [root, document, command]
        });
        disposables.push(vscode.languages.registerCodeActionsProvider(selector, {
            async provideCodeActions(d, range, context, t) {
                const result = await request<(lsp.Command | lsp.CodeAction)[]>('textDocument/codeAction', { ...uri(d), range: toProtocol.asRange(range), context: {
                    diagnostics: await toProtocol.asDiagnostics([...context.diagnostics]), only: context.only ? [context.only.value] : undefined
                } }, t);
                const converted = await toCode.asCodeActionResult(result ?? []);
                return converted?.map((action, index) => {
                    if (action instanceof vscode.CodeAction) { originalActions.set(action, { action: result![index] as lsp.CodeAction, document: d.uri }); }
                    const command = action instanceof vscode.CodeAction ? action.command : action;
                    if (command) {
                        const wrapped = wrapCommand(command, d.uri);
                        if (action instanceof vscode.CodeAction) { action.command = wrapped; } else { return wrapped; }
                    }
                    return action;
                });
            },
            async resolveCodeAction(action, token) {
                const original = originalActions.get(action);
                if (!original || typeof capabilities.codeActionProvider !== 'object' || !capabilities.codeActionProvider.resolveProvider) { return action; }
                const result = await request<lsp.CodeAction>('codeAction/resolve', original.action, token);
                const resolved = result ? await toCode.asCodeAction(result) : action;
                if (resolved.command) { resolved.command = wrapCommand(resolved.command, original.document); }
                return resolved;
            }
        }));
    }
    if (capabilities.inlayHintProvider) {
        disposables.push(vscode.languages.registerInlayHintsProvider(selector, {
            onDidChangeInlayHints: refresh,
            async provideInlayHints(d, range, t) {
                if (!config().get('clangd.enableInlayHints', true)) { return []; }
                return toCode.asInlayHints(await request<lsp.InlayHint[]>('textDocument/inlayHint', { ...uri(d), range: toProtocol.asRange(range) }, t));
            }
        }));
    }
    if (capabilities.semanticTokensProvider && 'legend' in capabilities.semanticTokensProvider) {
        const legend = capabilities.semanticTokensProvider.legend;
        disposables.push(vscode.languages.registerDocumentSemanticTokensProvider(selector, {
            onDidChangeSemanticTokens: refresh,
            async provideDocumentSemanticTokens(d, t) {
                if (!config().get('syntaxColor.enable', true)) { return new vscode.SemanticTokens(new Uint32Array()); }
                const result = await request<lsp.SemanticTokens>('textDocument/semanticTokens/full', uri(d), t);
                return result ? new vscode.SemanticTokens(new Uint32Array(result.data), result.resultId) : null;
            }
        }, new vscode.SemanticTokensLegend(legend.tokenTypes, legend.tokenModifiers)));
    }
    const callItems = new WeakMap<vscode.CallHierarchyItem, lsp.CallHierarchyItem>();
    const callItem = (item: lsp.CallHierarchyItem) => {
        const converted = new vscode.CallHierarchyItem(item.kind - 1, item.name, item.detail ?? '', vscode.Uri.parse(item.uri), toCode.asRange(item.range), toCode.asRange(item.selectionRange));
        callItems.set(converted, item);
        return converted;
    };
    if (capabilities.callHierarchyProvider) {
        disposables.push(vscode.languages.registerCallHierarchyProvider(selector, {
            async prepareCallHierarchy(d, p, t) { return (await request<lsp.CallHierarchyItem[]>('textDocument/prepareCallHierarchy', textPosition(d, p), t))?.map(callItem); },
            async provideCallHierarchyIncomingCalls(item, t) {
                return (await request<lsp.CallHierarchyIncomingCall[]>('callHierarchy/incomingCalls', { item: callItems.get(item) }, t))?.map(call => new vscode.CallHierarchyIncomingCall(callItem(call.from), call.fromRanges.map(range => toCode.asRange(range))));
            },
            async provideCallHierarchyOutgoingCalls(item, t) {
                return (await request<lsp.CallHierarchyOutgoingCall[]>('callHierarchy/outgoingCalls', { item: callItems.get(item) }, t))?.map(call => new vscode.CallHierarchyOutgoingCall(callItem(call.to), call.fromRanges.map(range => toCode.asRange(range))));
            }
        }));
    }
    const typeItems = new WeakMap<vscode.TypeHierarchyItem, lsp.TypeHierarchyItem>();
    const typeItem = (item: lsp.TypeHierarchyItem) => {
        const converted = new vscode.TypeHierarchyItem(item.kind - 1, item.name, item.detail ?? '', vscode.Uri.parse(item.uri), toCode.asRange(item.range), toCode.asRange(item.selectionRange));
        typeItems.set(converted, item);
        return converted;
    };
    if (capabilities.typeHierarchyProvider) {
        disposables.push(vscode.languages.registerTypeHierarchyProvider(selector, {
            async prepareTypeHierarchy(d, p, t) { return (await request<lsp.TypeHierarchyItem[]>('textDocument/prepareTypeHierarchy', textPosition(d, p), t))?.map(typeItem); },
            async provideTypeHierarchySupertypes(item, t) { return (await request<lsp.TypeHierarchyItem[]>('typeHierarchy/supertypes', { item: typeItems.get(item) }, t))?.map(typeItem); },
            async provideTypeHierarchySubtypes(item, t) { return (await request<lsp.TypeHierarchyItem[]>('typeHierarchy/subtypes', { item: typeItems.get(item) }, t))?.map(typeItem); }
        }));
    }
    return vscode.Disposable.from(...disposables);
}
