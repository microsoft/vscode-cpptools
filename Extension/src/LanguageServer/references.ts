/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
'use strict';
import * as vscode from 'vscode';
import { DefaultClient } from './client';
import { FindAllRefsView } from './referencesView';
import * as telemetry from '../telemetry';
import * as nls from 'vscode-nls';
import { RenameView } from './renameView';

nls.config({ messageFormat: nls.MessageFormat.bundle, bundleFormat: nls.BundleFormat.standalone })();
const localize: nls.LocalizeFunc = nls.loadMessageBundle();

export enum ReferenceType {
    Confirmed,
    ConfirmationInProgress,
    Comment,
    String,
    Inactive,
    CannotConfirm,
    NotAReference
}

export interface ReferenceInfo {
    file: string;
    position: vscode.Position;
    text: string;
    type: ReferenceType;
}

export interface ReferencesResult {
    referenceInfos: ReferenceInfo[];
    text: string;
    isFinished: boolean;
}

export interface ReferencesResultMessage {
    referencesResult: ReferencesResult;
}

enum ReferencesProgress {
    Started,
    StartedRename,
    ProcessingSource,
    ProcessingTargets
}

enum TargetReferencesProgress {
    WaitingToLex,
    Lexing,
    WaitingToParse,
    Parsing,
    ConfirmingReferences,
    FinishedWithoutConfirming,
    FinishedConfirming
}

export interface ReportReferencesProgressNotification {
    referencesProgress: ReferencesProgress;
    targetReferencesProgress: TargetReferencesProgress[];
}

export enum ReferencesCommandMode {
    None,
    Find,
    Peek,
    Rename
}

export function referencesCommandModeToString(referencesCommandMode: ReferencesCommandMode): string {
    switch (referencesCommandMode) {
        case ReferencesCommandMode.Find:
            return localize("find.all.references", "Find All References");
        case ReferencesCommandMode.Peek:
            return localize("peek.references", "Peek References");
        case ReferencesCommandMode.Rename:
            return localize("rename", "Rename");
        default:
            return "";
    }
}

export function convertReferenceTypeToString(referenceType: ReferenceType, upperCase?: boolean): string {
    if (upperCase) {
        switch (referenceType) {
            case ReferenceType.Confirmed: return localize("confirmed.reference.upper", "CONFIRMED REFERENCE");
            case ReferenceType.ConfirmationInProgress: return localize("confirmation.in.progress.upper", "CONFIRMATION IN PROGRESS");
            case ReferenceType.Comment: return localize("comment.reference.upper", "COMMENT REFERENCE");
            case ReferenceType.String: return localize("string.reference.upper", "STRING REFERENCE");
            case ReferenceType.Inactive: return localize("inactive.reference.upper", "INACTIVE REFERENCE");
            case ReferenceType.CannotConfirm: return localize("cannot.confirm.reference.upper", "CANNOT CONFIRM REFERENCE");
            case ReferenceType.NotAReference: return localize("not.a.reference.upper", "NOT A REFERENCE");
        }
    } else {
        switch (referenceType) {
            case ReferenceType.Confirmed: return localize("confirmed.reference", "Confirmed reference");
            case ReferenceType.ConfirmationInProgress: return localize("confirmation.in.progress", "Confirmation in progress");
            case ReferenceType.Comment: return localize("comment.reference", "Comment reference");
            case ReferenceType.String: return localize("string.reference", "String reference");
            case ReferenceType.Inactive: return localize("inactive.reference", "Inactive reference");
            case ReferenceType.CannotConfirm: return localize("cannot.confirm.reference", "Cannot confirm reference");
            case ReferenceType.NotAReference: return localize("not.a.reference", "Not a reference");
        }
    }
    return "";
}

function getReferenceCanceledString(upperCase?: boolean): string {
    return upperCase ?
        localize("confirmation.canceled.upper", "CONFIRMATION CANCELED") :
        localize("confirmation.canceled", "Confirmation canceled");
}

export function getReferenceTagString(referenceType: ReferenceType, referenceCanceled: boolean, upperCase?: boolean): string {
    return referenceCanceled && referenceType === ReferenceType.ConfirmationInProgress ? getReferenceCanceledString(upperCase) : convertReferenceTypeToString(referenceType, upperCase);
}

export class ReferencesManager {
    private client: DefaultClient;
    private disposables: vscode.Disposable[] = [];

    private referencesChannel: vscode.OutputChannel;
    private findAllRefsView: FindAllRefsView;
    private renameView: RenameView;
    private viewsInitialized: boolean = false;

    private referencesCurrentProgress: ReportReferencesProgressNotification;
    private referencesPrevProgressIncrement: number;
    private referencesPrevProgressMessage: string;
    public referencesRequestHasOccurred: boolean;
    public referencesViewFindPending: boolean = false;
    private referencesDelayProgress: NodeJS.Timeout;
    private referencesProgressOptions: vscode.ProgressOptions;
    private referencesCanceled: boolean;
    private referencesStartedWhileTagParsing: boolean;
    private referencesProgressMethod: (progress: vscode.Progress<{
        message?: string;
        increment?: number;
    }>, token: vscode.CancellationToken) => Thenable<unknown>;
    private referencesCurrentProgressUICounter: number;
    private readonly referencesProgressUpdateInterval: number = 1000;
    private readonly referencesProgressDelayInterval: number = 2000;

    private prevVisibleRangesLength: number = 0;
    private visibleRangesDecreased: boolean = false;
    private visibleRangesDecreasedTicks: number = 0;
    private readonly ticksForDetectingPeek: number = 1000; // TODO: Might need tweeking?

    private resultsCallback: (results: ReferencesResult) => void;
    private currentUpdateProgressTimer: NodeJS.Timeout;
    private currentUpdateProgressResolve: () => void;

    constructor(client: DefaultClient) {
        this.client = client;
    }

    initializeViews(): void {
        if (!this.viewsInitialized) {
            this.referencesChannel = vscode.window.createOutputChannel(localize("c.cpp.references", "C/C++ References"));
            this.disposables.push(this.referencesChannel);
            this.findAllRefsView = new FindAllRefsView();
            this.renameView = new RenameView();
            this.viewsInitialized = true;
        }
    }

    public dispose(): void {
        this.disposables.forEach((d) => d.dispose());
        this.disposables = [];
    }

    public toggleGroupView(): void {
        this.findAllRefsView.toggleGroupView();
    }

    public UpdateProgressUICounter(mode: ReferencesCommandMode): void {
        if (mode !== ReferencesCommandMode.None) {
            ++this.referencesCurrentProgressUICounter;
        }
    }

    public updateVisibleRange(visibleRangesLength: number): void {
        this.visibleRangesDecreased = visibleRangesLength < this.prevVisibleRangesLength;
        if (this.visibleRangesDecreased) {
            this.visibleRangesDecreasedTicks = Date.now();
        }
        this.prevVisibleRangesLength = visibleRangesLength;
    }

    private reportProgress(progress: vscode.Progress<{message?: string; increment?: number }>, forceUpdate: boolean, mode: ReferencesCommandMode): void {
        const helpMessage: string = (mode !== ReferencesCommandMode.Find) ? "" : ` ${localize("click.search.icon", "To preview results, click the search icon in the status bar.")}`;
        switch (this.referencesCurrentProgress.referencesProgress) {
            case ReferencesProgress.Started:
            case ReferencesProgress.StartedRename:
                progress.report({ message: localize("started", "Started."), increment: 0 });
                break;
            case ReferencesProgress.ProcessingSource:
                progress.report({ message: localize("processing.source", "Processing source."), increment: 0 });
                break;
            case ReferencesProgress.ProcessingTargets:
                let numWaitingToLex: number = 0;
                let numLexing: number = 0;
                let numParsing: number = 0;
                let numConfirmingReferences: number = 0;
                let numFinishedWithoutConfirming: number = 0;
                let numFinishedConfirming: number = 0;
                for (let targetLocationProgress of this.referencesCurrentProgress.targetReferencesProgress) {
                    switch (targetLocationProgress) {
                        case TargetReferencesProgress.WaitingToLex:
                            ++numWaitingToLex;
                            break;
                        case TargetReferencesProgress.Lexing:
                            ++numLexing;
                            break;
                        case TargetReferencesProgress.WaitingToParse:
                            // The count is derived.
                            break;
                        case TargetReferencesProgress.Parsing:
                            ++numParsing;
                            break;
                        case TargetReferencesProgress.ConfirmingReferences:
                            ++numConfirmingReferences;
                            break;
                        case TargetReferencesProgress.FinishedWithoutConfirming:
                            ++numFinishedWithoutConfirming;
                            break;
                        case TargetReferencesProgress.FinishedConfirming:
                            ++numFinishedConfirming;
                            break;
                        default:
                            break;
                    }
                }

                let currentMessage: string;
                const numTotalToLex: number = this.referencesCurrentProgress.targetReferencesProgress.length;
                const numFinishedLexing: number = numTotalToLex - numWaitingToLex - numLexing;
                const numTotalToParse: number = this.referencesCurrentProgress.targetReferencesProgress.length - numFinishedWithoutConfirming;
                if (numLexing >= numParsing && numFinishedConfirming === 0) {
                    if (numTotalToLex === 0) {
                        currentMessage = localize("searching.files", "Searching files."); // TODO: Prevent this from happening.
                    } else {
                        currentMessage = localize("files.searched", "{0}/{1} files searched.{2}", numFinishedLexing, numTotalToLex, helpMessage);
                    }
                } else {
                    currentMessage = localize("files.confirmed", "{0}/{1} files confirmed.{2}", numFinishedConfirming, numTotalToParse, helpMessage);
                }
                const currentLexProgress: number = numFinishedLexing / numTotalToLex;
                const confirmingWeight: number = 0.5; // Count confirming as 50% of parsing time (even though it's a lot less) so that the progress bar change is more noticeable.
                const currentParseProgress: number = (numConfirmingReferences * confirmingWeight + numFinishedConfirming) / numTotalToParse;
                const averageLexingPercent: number = 25;
                const currentIncrement: number = currentLexProgress * averageLexingPercent + currentParseProgress * (100 - averageLexingPercent);
                if (forceUpdate || currentIncrement > this.referencesPrevProgressIncrement || currentMessage !== this.referencesPrevProgressMessage) {
                    progress.report({ message: currentMessage, increment: currentIncrement - this.referencesPrevProgressIncrement });
                    this.referencesPrevProgressIncrement = currentIncrement;
                    this.referencesPrevProgressMessage = currentMessage;
                }
                break;
        }
    }

    private handleProgressStarted(referencesProgress: ReferencesProgress): void {
        this.referencesStartedWhileTagParsing = this.client.IsTagParsing;

        let mode: ReferencesCommandMode =
            (referencesProgress === ReferencesProgress.StartedRename) ? ReferencesCommandMode.Rename :
            (this.visibleRangesDecreased && (Date.now() - this.visibleRangesDecreasedTicks < this.ticksForDetectingPeek) ?
            ReferencesCommandMode.Peek : ReferencesCommandMode.Find);
        this.client.setReferencesCommandMode(mode);

        this.referencesRequestHasOccurred = false;
        this.referencesCanceled = false;
        this.referencesPrevProgressIncrement = 0;
        this.referencesPrevProgressMessage = "";
        this.referencesCurrentProgressUICounter = 0;
        this.currentUpdateProgressTimer = null;
        this.currentUpdateProgressResolve = null;
        let referencePreviousProgressUICounter: number = 0;

        this.clearViews();

        this.referencesDelayProgress = setInterval(() => {

            this.referencesProgressOptions = { location: vscode.ProgressLocation.Notification, title: referencesCommandModeToString(this.client.ReferencesCommandMode), cancellable: true };
            this.referencesProgressMethod = (progress: vscode.Progress<{message?: string; increment?: number }>, token: vscode.CancellationToken) =>
            // tslint:disable-next-line: promise-must-complete
                new Promise((resolve) => {
                    this.currentUpdateProgressResolve = resolve;
                    this.reportProgress(progress, true, mode);
                    this.currentUpdateProgressTimer = setInterval(() => {
                        if (token.isCancellationRequested && !this.referencesCanceled) {
                            this.client.cancelReferences();
                            this.referencesCanceled = true;
                        }
                        if (this.referencesCurrentProgressUICounter !== referencePreviousProgressUICounter) {
                            clearInterval(this.currentUpdateProgressTimer);
                            this.currentUpdateProgressTimer = null;
                            if (this.referencesCurrentProgressUICounter !== referencePreviousProgressUICounter) {
                                referencePreviousProgressUICounter = this.referencesCurrentProgressUICounter;
                                this.referencesPrevProgressIncrement = 0; // Causes update bar to not reset.
                                vscode.window.withProgress(this.referencesProgressOptions, this.referencesProgressMethod);
                            }
                            resolve();
                        } else {
                            this.reportProgress(progress, false, mode);
                        }
                    }, this.referencesProgressUpdateInterval);
                });
            vscode.window.withProgress(this.referencesProgressOptions, this.referencesProgressMethod);
            clearInterval(this.referencesDelayProgress);
        }, this.referencesProgressDelayInterval);
    }

    public handleProgress(notificationBody: ReportReferencesProgressNotification): void {
        this.initializeViews();

        switch (notificationBody.referencesProgress) {
            case ReferencesProgress.StartedRename:
            case ReferencesProgress.Started:
                if (this.client.ReferencesCommandMode === ReferencesCommandMode.Peek) {
                    telemetry.logLanguageServerEvent("peekReferences");
                }
                this.handleProgressStarted(notificationBody.referencesProgress);
                break;
            default:
                this.referencesCurrentProgress = notificationBody;
                break;
        }
    }

    public processResults(referencesResult: ReferencesResult): void {
        this.initializeViews();
        this.referencesViewFindPending = false;
        this.clearViews();

        if (this.referencesStartedWhileTagParsing) {
            let msg: string = localize("some.references.may.be.missing", "[Warning] Some references may be missing, because workspace parsing was incomplete when {0} was started.",
                referencesCommandModeToString(this.client.ReferencesCommandMode));
            this.referencesChannel.appendLine(msg);
            this.referencesChannel.appendLine("");
            this.referencesChannel.show(true);
        }

        if (this.client.ReferencesCommandMode === ReferencesCommandMode.Rename) {
            if (!this.referencesCanceled) {
                // If there are only Confirmed results, complete the rename immediately.
                let foundUnconfirmed: ReferenceInfo = referencesResult.referenceInfos.find(e => e.type !== ReferenceType.Confirmed);
                if (!foundUnconfirmed) {
                    this.resultsCallback(referencesResult);
                } else {
                    this.renameView.show(true);
                    this.renameView.setData(referencesResult, this.resultsCallback);
                }
            } else {
                // Do nothing when rename is canceled while searching for references was in progress.
                this.resultsCallback(true, null);
            }
        } else {
            this.findAllRefsView.setData(referencesResult, this.referencesCanceled);

            // Display data based on command mode: peek references OR find all references
            if (this.client.ReferencesCommandMode === ReferencesCommandMode.Peek) {
                let showConfirmedReferences: boolean = this.referencesCanceled;
                let peekReferencesResults: string = this.findAllRefsView.getResultsAsText(showConfirmedReferences);
                if (peekReferencesResults) {
                    this.referencesChannel.appendLine(peekReferencesResults);
                    this.referencesChannel.show(true);
                }
            } else if (this.client.ReferencesCommandMode === ReferencesCommandMode.Find) {
                this.findAllRefsView.show(true);
            }
        }

        if (referencesResult.isFinished) {
            clearInterval(this.referencesDelayProgress);
            if (this.currentUpdateProgressTimer) {
                clearInterval(this.currentUpdateProgressTimer);
                this.currentUpdateProgressResolve();
                this.currentUpdateProgressResolve = null;
                this.currentUpdateProgressTimer = null;
            }
            if (this.client.ReferencesCommandMode !== ReferencesCommandMode.Rename) {
                this.resultsCallback(referencesResult);
            }
            this.client.setReferencesCommandMode(ReferencesCommandMode.None);
        }
    }

    public setResultsCallback(callback: (results: ReferencesResult) => void): void {
        this.resultsCallback = callback;
    }

    public closeRenameUI(): void {
        this.renameView.show(false);
    }

    public clearViews(): void {
        this.referencesChannel.clear();
        this.findAllRefsView.show(false);
        this.renameView.show(false);
    }
}
