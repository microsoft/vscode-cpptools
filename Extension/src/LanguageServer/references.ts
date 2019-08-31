/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
'use strict';
import * as vscode from 'vscode';
import { DefaultClient } from './client';
import * as telemetry from '../telemetry';
import * as nls from 'vscode-nls';

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

interface ReferenceInfo {
    file: string;
    position: vscode.Position;
    text: string;
    type: ReferenceType;
}

export interface ReferencesResult {
    referenceInfos: ReferenceInfo[];
}

export interface ReferencesResultMessage {
    referencesResult: ReferencesResult;
}

enum ReferencesProgress {
    Started,
    StartedRename,
    ProcessingSource,
    ProcessingTargets,
    CanceledFinalResultsAvailable,
    FinalResultsAvailable,
    Finished
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
            return "Find All References";
        case ReferencesCommandMode.Peek:
            return "Peek References";
        case ReferencesCommandMode.Rename:
            return "Rename";
        default:
            return "";
    }
}

function convertReferenceTypeToString(referenceType: ReferenceType, isReferencesCanceled: boolean, isRename: boolean): string {
    switch (referenceType) {
        case ReferenceType.Confirmed: return isRename ? localize("renamed.reference", "Renamed reference") : localize("confirmed.reference", "Confirmed reference");
        case ReferenceType.ConfirmationInProgress: return isReferencesCanceled ? localize("confirmation.canceled", "Confirmation canceled") : localize("confirmation.in.progress", "Confirmation in progress");
        case ReferenceType.Comment: return localize("comment.reference", "Comment reference");
        case ReferenceType.String: return localize("string.reference", "String reference");
        case ReferenceType.Inactive: return localize("inactive.reference", "Inactive reference");
        case ReferenceType.CannotConfirm: return localize("cannot.confirm.reference", "Cannot confirm reference");
        case ReferenceType.NotAReference: return localize("not.a.reference", "Not a reference");
    }
    return "";
}

export class ProgressHandler {
    private client: DefaultClient;
    private disposables: vscode.Disposable[] = [];

    private referencesChannel: vscode.OutputChannel;

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
    private referencePreviousProgressUICounter: number;
    public referencesCurrentProgressUICounter: number;
    private readonly referencesProgressUpdateInterval: number = 1000;
    private readonly referencesProgressDelayInterval: number = 2000;

    // Used to determine if Find or Peek References is used.
    // TODO: Investigate using onDidExecuteCommand instead.
    private prevVisibleRangesLength: number = 0;
    private visibleRangesDecreased: boolean = false;
    private visibleRangesDecreasedTicks: number = 0;
    private readonly ticksForDetectingPeek: number = 1000; // TODO: Might need tweeking?

    constructor(client: DefaultClient) {
        this.client = client;
    }

    public dispose(): void {
        this.disposables.forEach((d) => d.dispose());
        this.disposables = [];
    }

    public updateVisibleRange(visibleRangesLength: number): void {
        this.visibleRangesDecreased = visibleRangesLength < this.prevVisibleRangesLength;
        if (this.visibleRangesDecreased) {
            this.visibleRangesDecreasedTicks = Date.now();
        }
        this.prevVisibleRangesLength = visibleRangesLength;
    }

    public reportProgress(progress: vscode.Progress<{message?: string; increment?: number }>, forceUpdate: boolean): void {
        const helpMessage: string = ` ${localize("click.search.icon", "To preview results, click the search icon in the status bar.")}`;
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
            case ReferencesProgress.CanceledFinalResultsAvailable:
            case ReferencesProgress.FinalResultsAvailable:
                progress.report({ message: localize("finished", "Finished."), increment: 100 });
                break;
        }
    }

    public handleProgress(notificationBody: ReportReferencesProgressNotification): void {
        switch (notificationBody.referencesProgress) {
            case ReferencesProgress.StartedRename:
            case ReferencesProgress.Started:
                this.referencesStartedWhileTagParsing = this.client.IsTagParsing;
                let mode: ReferencesCommandMode = notificationBody.referencesProgress === ReferencesProgress.StartedRename ? ReferencesCommandMode.Rename :
                    (this.visibleRangesDecreased && (Date.now() - this.visibleRangesDecreasedTicks < this.ticksForDetectingPeek) ?
                    ReferencesCommandMode.Peek : ReferencesCommandMode.Find);
                this.client.setReferencesCommandMode(mode);
                if (this.client.ReferencesCommandMode === ReferencesCommandMode.Peek) {
                    telemetry.logLanguageServerEvent("peekReferences");
                }
                this.referencesRequestHasOccurred = false;
                this.referencesCanceled = false;
                this.referencesPrevProgressIncrement = 0;
                this.referencesPrevProgressMessage = "";
                this.referencePreviousProgressUICounter = 0;
                this.referencesCurrentProgressUICounter = 0;
                if (!this.referencesChannel) {
                    this.referencesChannel = vscode.window.createOutputChannel(localize("c.cpp.references", "C/C++ References"));
                    this.disposables.push(this.referencesChannel);
                } else {
                    this.referencesChannel.clear();
                }
                this.referencesDelayProgress = setInterval(() => {
                    this.referencesProgressOptions = { location: vscode.ProgressLocation.Notification, title: referencesCommandModeToString(this.client.ReferencesCommandMode), cancellable: true };
                    this.referencesProgressMethod = (progress: vscode.Progress<{message?: string; increment?: number }>, token: vscode.CancellationToken) =>
                    // tslint:disable-next-line: promise-must-complete
                        new Promise((resolve) => {
                            this.reportProgress(progress, true);
                            let currentUpdateProgressTimer: NodeJS.Timeout = setInterval(() => {
                                if (token.isCancellationRequested && !this.referencesCanceled) {
                                    this.client.cancelReferences();
                                    this.client.sendRequestReferences();
                                    this.referencesCanceled = true;
                                }
                                if (this.referencesCurrentProgress.referencesProgress === ReferencesProgress.Finished || this.referencesCurrentProgressUICounter !== this.referencePreviousProgressUICounter) {
                                    clearInterval(currentUpdateProgressTimer);
                                    if (this.referencesCurrentProgressUICounter !== this.referencePreviousProgressUICounter) {
                                        this.referencePreviousProgressUICounter = this.referencesCurrentProgressUICounter;
                                        this.referencesPrevProgressIncrement = 0; // Causes update bar to not reset.
                                        vscode.window.withProgress(this.referencesProgressOptions, this.referencesProgressMethod);
                                    }
                                    resolve();
                                } else {
                                    this.reportProgress(progress, false);
                                }
                            }, this.referencesProgressUpdateInterval);
                        });
                    vscode.window.withProgress(this.referencesProgressOptions, this.referencesProgressMethod);
                    clearInterval(this.referencesDelayProgress);
                }, this.referencesProgressDelayInterval);
                break;
            case ReferencesProgress.CanceledFinalResultsAvailable:
            case ReferencesProgress.FinalResultsAvailable:
                if (notificationBody.referencesProgress === ReferencesProgress.CanceledFinalResultsAvailable) {
                    this.referencesCanceled = true;
                }
                this.referencesCurrentProgress = notificationBody;
                this.client.sendRequestReferences();
                break;
            case ReferencesProgress.Finished:
                this.referencesCurrentProgress = notificationBody;
                this.client.setReferencesCommandMode(ReferencesCommandMode.None);
                clearInterval(this.referencesDelayProgress);
                break;
            default:
                this.referencesCurrentProgress = notificationBody;
                break;
        }
    }

    public processResults(referencesResult: ReferencesResult): void {
        this.referencesViewFindPending = false;
        this.referencesChannel.clear();

        if (this.referencesStartedWhileTagParsing) {
            this.referencesChannel.appendLine(localize("some.references.may.be.missing", "[Warning] Some references may be missing, because workspace parsing was incomplete when {0} was started.",
            referencesCommandModeToString(this.client.ReferencesCommandMode)));
            this.referencesChannel.appendLine("");
        }

        let showConfirmedReferences: boolean = this.client.ReferencesCommandMode === ReferencesCommandMode.Rename ||
            (this.client.ReferencesCommandMode === ReferencesCommandMode.Peek && ((!this.referencesCanceled && this.referencesCurrentProgress.referencesProgress !== ReferencesProgress.FinalResultsAvailable)
                || (this.referencesCanceled && this.referencesCurrentProgress.referencesProgress === ReferencesProgress.CanceledFinalResultsAvailable)));
        let refsFound: boolean = false;
        for (let reference of referencesResult.referenceInfos) {
            if (!showConfirmedReferences && reference.type === ReferenceType.Confirmed) {
                continue;
            } else if (!refsFound) {
                refsFound = true;
            }
            let isFileReference: boolean = reference.position.line === 0 && reference.position.character === 0;
            this.referencesChannel.appendLine("[" + convertReferenceTypeToString(reference.type, this.referencesCanceled, this.client.ReferencesCommandMode === ReferencesCommandMode.Rename)
                + "] " + reference.file + (!isFileReference ? ":" + (reference.position.line + 1) + ":" + (reference.position.character + 1) : "") + " " + reference.text);
        }

        if (this.referencesStartedWhileTagParsing || refsFound) {
            this.referencesChannel.show(true);
        }
    }
}
