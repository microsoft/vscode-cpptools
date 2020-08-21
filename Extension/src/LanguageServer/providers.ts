import * as vscode from 'vscode';
import * as clientRef from './client';

let abortRequestId: number = 0;

export class FoldingRangeProvider implements vscode.FoldingRangeProvider {
    private client: clientRef.DefaultClient;
    constructor(client: clientRef.DefaultClient) {
        this.client = client;
    }
    provideFoldingRanges(document: vscode.TextDocument, context: vscode.FoldingContext,
        token: vscode.CancellationToken): Promise<vscode.FoldingRange[]> {
        const id: number = ++abortRequestId;
        const params: clientRef.GetFoldingRangesParams = {
            id: id,
            uri: document.uri.toString()
        };
        return new Promise<vscode.FoldingRange[]>((resolve, reject) => {
            this.client.notifyWhenReady(() => {
                this.client.languageClient.sendRequest(clientRef.GetFoldingRangesRequest, params)
                    .then((ranges) => {
                        if (ranges.canceled) {
                            reject();
                        } else {
                            const result: vscode.FoldingRange[] = [];
                            ranges.ranges.forEach((r) => {
                                const foldingRange: vscode.FoldingRange = {
                                    start: r.range.start.line,
                                    end: r.range.end.line
                                };
                                switch (r.kind) {
                                    case clientRef.FoldingRangeKind.Comment:
                                        foldingRange.kind = vscode.FoldingRangeKind.Comment;
                                        break;
                                    case clientRef.FoldingRangeKind.Imports:
                                        foldingRange.kind = vscode.FoldingRangeKind.Imports;
                                        break;
                                    case clientRef.FoldingRangeKind.Region:
                                        foldingRange.kind = vscode.FoldingRangeKind.Region;
                                        break;
                                    default:
                                        break;
                                }
                                result.push(foldingRange);
                            });
                            resolve(result);
                        }
                    });
                token.onCancellationRequested(e => this.client.abortRequest(id));
            });
        });
    }
}

export class SemanticTokensProvider implements vscode.DocumentSemanticTokensProvider {
    private client: clientRef.DefaultClient;
    public onDidChangeSemanticTokensEvent = new vscode.EventEmitter<void>();
    public onDidChangeSemanticTokens?: vscode.Event<void>;
    private tokenCaches: Map<string, [number, vscode.SemanticTokens]> = new Map<string, [number, vscode.SemanticTokens]>();

    constructor(client: clientRef.DefaultClient) {
        this.client = client;
        this.onDidChangeSemanticTokens = this.onDidChangeSemanticTokensEvent.event;
    }

    public async provideDocumentSemanticTokens(document: vscode.TextDocument, token: vscode.CancellationToken): Promise<vscode.SemanticTokens> {
        return new Promise<vscode.SemanticTokens>((resolve, reject) => {
            this.client.notifyWhenReady(() => {
                const uriString: string = document.uri.toString();
                // First check the token cache to see if we already have results for that file and version
                const cache: [number, vscode.SemanticTokens] | undefined = this.tokenCaches.get(uriString);
                if (cache && cache[0] === document.version) {
                    resolve(cache[1]);
                } else {
                    const id: number = ++abortRequestId;
                    const params: client.GetSemanticTokensParams = {
                        id: id,
                        uri: uriString
                    };
                    this.client.languageClient.sendRequest(clientRef.GetSemanticTokensRequest, params)
                        .then((tokensResult) => {
                            if (tokensResult.canceled) {
                                reject();
                            } else {
                                if (tokensResult.fileVersion !== clientRef.openFileVersions.get(uriString)) {
                                    reject();
                                } else {
                                    const builder: vscode.SemanticTokensBuilder = new vscode.SemanticTokensBuilder(this.client.semanticTokensLegend);
                                    tokensResult.tokens.forEach((token) => {
                                        builder.push(token.line, token.character, token.length, token.type, token.modifiers);
                                    });
                                    const tokens: vscode.SemanticTokens = builder.build();
                                    this.tokenCaches.set(uriString, [tokensResult.fileVersion, tokens]);
                                    resolve(tokens);
                                }
                            }
                        });
                    token.onCancellationRequested(e => this.client.abortRequest(id));
                }
            });
        });
    }

    public invalidateFile(uri: string): void {
        this.tokenCaches.delete(uri);
        this.onDidChangeSemanticTokensEvent.fire();
    }
}