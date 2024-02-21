/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
'use strict';
import { setInterval } from 'timers';
import * as vscode from 'vscode';
import { Position, TextDocumentIdentifier } from 'vscode-languageclient';
import * as nls from 'vscode-nls';
import * as util from '../common';
import * as logger from '../logger';
import * as telemetry from '../telemetry';
import { DefaultClient } from './client';
import { PersistentState } from './persistentState';
import { FindAllRefsView } from './referencesView';

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

export interface ReferencesParams {
    newName: string;
    position: Position;
    textDocument: TextDocumentIdentifier;
}

export interface ReferencesResult {
    referenceInfos: ReferenceInfo[];
    text: string;
    isFinished: boolean;
    isCanceled: boolean;
}

export type ReferencesResultCallback = (result: ReferencesResult | null) => void;

enum ReferencesProgress {
    Started,
    StartedRename,
    StartedCallHierarchy,
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
    Rename,
    CallHierarchy
}

export enum CancellationSender {
    /* No cancellations */
    None,

    /* Cancellation was from a new request */
    NewRequest,

    /* Cancellation was from the provider cancellation token */
    ProviderToken,

    /* Cancellation was from the language server */
    LanguageServer,

    /* Cancellation was from the user selecting the cancel button in the reference search progress bar */
    User
}

export function referencesCommandModeToString(referencesCommandMode: ReferencesCommandMode): string {
    switch (referencesCommandMode) {
        case ReferencesCommandMode.Find:
            return localize("find.all.references", "Find All References");
        case ReferencesCommandMode.Peek:
            return localize("peek.references", "Peek References");
        case ReferencesCommandMode.Rename:
            return localize("rename", "Rename");
        case ReferencesCommandMode.CallHierarchy:
            return localize("call.hierarchy", "Call Hierarchy");
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
}

function getReferenceCanceledString(upperCase?: boolean): string {
    return upperCase ?
        localize("confirmation.canceled.upper", "CONFIRMATION CANCELED") :
        localize("confirmation.canceled", "Confirmation canceled");
}

export function getReferenceTagString(referenceType: ReferenceType, referenceCanceled: boolean, upperCase?: boolean): string {
    return referenceCanceled && referenceType === ReferenceType.ConfirmationInProgress ? getReferenceCanceledString(upperCase) : convertReferenceTypeToString(referenceType, upperCase);
}

export function getReferenceTypeIconPath(referenceType: ReferenceType): { light: vscode.Uri; dark: vscode.Uri } {
    const assetsFolder: string = "assets/";
    const postFixLight: string = "-light.svg";
    const postFixDark: string = "-dark.svg";
    let basePath: string = "ref-cannot-confirm";

    switch (referenceType) {
        case ReferenceType.Confirmed: basePath = "ref-confirmed"; break;
        case ReferenceType.Comment: basePath = "ref-comment"; break;
        case ReferenceType.String: basePath = "ref-string"; break;
        case ReferenceType.Inactive: basePath = "ref-inactive"; break;
        case ReferenceType.CannotConfirm: basePath = "ref-cannot-confirm"; break;
        case ReferenceType.NotAReference: basePath = "ref-not-a-reference"; break;
        case ReferenceType.ConfirmationInProgress: basePath = "ref-confirmation-in-progress"; break;
    }

    const lightPath: string = util.getExtensionFilePath(assetsFolder + basePath + postFixLight);
    const lightPathUri: vscode.Uri = vscode.Uri.file(lightPath);
    const darkPath: string = util.getExtensionFilePath(assetsFolder + basePath + postFixDark);
    const darkPathUri: vscode.Uri = vscode.Uri.file(darkPath);
    return {
        light: lightPathUri,
        dark: darkPathUri
    };
}

function getReferenceCanceledIconPath(): { light: vscode.Uri; dark: vscode.Uri } {
    const lightPath: string = util.getExtensionFilePath("assets/ref-canceled-light.svg");
    const lightPathUri: vscode.Uri = vscode.Uri.file(lightPath);
    const darkPath: string = util.getExtensionFilePath("assets/ref-canceled-dark.svg");
    const darkPathUri: vscode.Uri = vscode.Uri.file(darkPath);
    return {
        light: lightPathUri,
        dark: darkPathUri
    };
}

export function getReferenceItemIconPath(type: ReferenceType, isCanceled: boolean): { light: vscode.Uri; dark: vscode.Uri } {
    return (isCanceled && type === ReferenceType.ConfirmationInProgress) ? getReferenceCanceledIconPath() : getReferenceTypeIconPath(type);
}

export class ReferencesManager {
    private client: DefaultClient;
    private disposables: vscode.Disposable[] = [];

    private referencesChannel?: vscode.OutputChannel;
    private findAllRefsView?: FindAllRefsView;
    private viewsInitialized: boolean = false;

    public renamePending: boolean = false;
    private referenceRequestCanceled = new vscode.EventEmitter<CancellationSender>();

    private referencesCurrentProgress?: ReportReferencesProgressNotification;
    private referencesPrevProgressIncrement: number = 0;
    private referencesPrevProgressMessage: string = "";
    private referencesDelayProgress?: NodeJS.Timeout;
    private referencesProgressOptions?: vscode.ProgressOptions;
    private referencesStartedWhileTagParsing?: boolean;
    private referencesProgressMethod?: (progress: vscode.Progress<{
        message?: string;
        increment?: number;
    }>, token: vscode.CancellationToken) => Thenable<unknown>;
    private referencesProgressBarStartTime: number = 0;
    private referencesCurrentProgressUICounter: number = 0;
    private readonly referencesProgressUpdateInterval: number = 1000;
    private readonly referencesProgressDelayInterval: number = 2000;
    private currentUpdateProgressTimer?: NodeJS.Timeout;
    private currentUpdateProgressResolve?: (value: unknown) => void;

    private prevVisibleRangesLength: number = 0;
    private visibleRangesDecreased: boolean = false;
    private visibleRangesDecreasedTicks: number = 0;
    private readonly ticksForDetectingPeek: number = 1000; // TODO: Might need tweaking?

    public groupByFile: PersistentState<boolean> = new PersistentState<boolean>("CPP.referencesGroupByFile", false);

    constructor(client: DefaultClient) {
        this.client = client;
        this.disposables.push(vscode.Disposable.from(this.referenceRequestCanceled));
    }

    initializeViews(): void {
        if (!this.viewsInitialized) {
            this.findAllRefsView = new FindAllRefsView();
            this.viewsInitialized = true;
        }
    }

    public get onCancellationRequested(): vscode.Event<CancellationSender> {
        return this.referenceRequestCanceled.event;
    }

    public cancelCurrentReferenceRequest(sender: CancellationSender): void {
        // Notify the current listener to cancel its request.
        this.referenceRequestCanceled.fire(sender);
    }

    public dispose(): void {
        this.disposables.forEach((d) => d.dispose());
        this.disposables = [];
    }

    public toggleGroupView(): void {
        this.groupByFile.Value = !this.groupByFile.Value;
        if (this.findAllRefsView) {
            this.findAllRefsView.setGroupBy(this.groupByFile.Value);
        }
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

    private reportProgress(progress: vscode.Progress<{ message?: string; increment?: number }>, forceUpdate: boolean, mode: ReferencesCommandMode): void {
        const helpMessage: string = (mode !== ReferencesCommandMode.Find) ? "" : ` ${localize("click.search.icon", "To preview results, click the search icon in the status bar.")}`;
        if (this.referencesCurrentProgress) {
            switch (this.referencesCurrentProgress.referencesProgress) {
                case ReferencesProgress.Started:
                case ReferencesProgress.StartedRename:
                case ReferencesProgress.StartedCallHierarchy:
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
                    for (const targetLocationProgress of this.referencesCurrentProgress.targetReferencesProgress) {
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
                    if (numLexing >= (numParsing + numConfirmingReferences) && numFinishedConfirming === 0) {
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
    }

    private handleProgressStarted(referencesProgress: ReferencesProgress): void {
        this.referencesStartedWhileTagParsing = this.client.IsTagParsing;

        let mode: ReferencesCommandMode = ReferencesCommandMode.None;
        if (referencesProgress === ReferencesProgress.StartedCallHierarchy) {
            mode = ReferencesCommandMode.CallHierarchy;
        } else if (referencesProgress === ReferencesProgress.StartedRename) {
            mode = ReferencesCommandMode.Rename;
        } else if (this.visibleRangesDecreased && (Date.now() - this.visibleRangesDecreasedTicks < this.ticksForDetectingPeek)) {
            mode = ReferencesCommandMode.Peek;
        } else {
            mode = ReferencesCommandMode.Find;
        }
        this.client.setReferencesCommandMode(mode);

        this.referencesPrevProgressIncrement = 0;
        this.referencesPrevProgressMessage = "";
        this.referencesCurrentProgressUICounter = 0;
        this.currentUpdateProgressTimer = undefined;
        this.currentUpdateProgressResolve = undefined;
        let referencePreviousProgressUICounter: number = 0;
        this.referencesProgressBarStartTime = Date.now();
        this.clearViews();

        if (this.referencesDelayProgress) {
            clearInterval(this.referencesDelayProgress);
        }

        this.referencesDelayProgress = setInterval(() => {
            const progressTitle: string = referencesCommandModeToString(this.client.ReferencesCommandMode);
            this.referencesProgressOptions = { location: vscode.ProgressLocation.Notification, title: progressTitle, cancellable: true };
            this.referencesProgressMethod = (progress: vscode.Progress<{ message?: string; increment?: number }>, token: vscode.CancellationToken) =>
                new Promise((resolve) => {
                    this.currentUpdateProgressResolve = resolve;
                    this.reportProgress(progress, true, mode);
                    this.currentUpdateProgressTimer = setInterval(() => {
                        if (token.isCancellationRequested) {
                            this.cancelCurrentReferenceRequest(CancellationSender.User);
                            if (this.currentUpdateProgressTimer) {
                                clearInterval(this.currentUpdateProgressTimer);
                            }
                            if (this.referencesDelayProgress) {
                                clearInterval(this.referencesDelayProgress);
                            }
                        }
                        if (this.referencesCurrentProgressUICounter !== referencePreviousProgressUICounter) {
                            if (this.currentUpdateProgressTimer) {
                                clearInterval(this.currentUpdateProgressTimer);
                            }
                            this.currentUpdateProgressTimer = undefined;
                            if (this.referencesCurrentProgressUICounter !== referencePreviousProgressUICounter) {
                                referencePreviousProgressUICounter = this.referencesCurrentProgressUICounter;
                                this.referencesPrevProgressIncrement = 0; // Causes update bar to not reset.
                                if (this.referencesProgressOptions && this.referencesProgressMethod) {
                                    void vscode.window.withProgress(this.referencesProgressOptions, this.referencesProgressMethod);
                                }
                            }
                            resolve(undefined);
                        } else {
                            this.reportProgress(progress, false, mode);
                        }
                    }, this.referencesProgressUpdateInterval);
                });
            void vscode.window.withProgress(this.referencesProgressOptions, this.referencesProgressMethod);
            if (this.referencesDelayProgress) {
                clearInterval(this.referencesDelayProgress);
            }
        }, this.referencesProgressDelayInterval);
    }

    public handleProgress(notificationBody: ReportReferencesProgressNotification): void {
        this.initializeViews();

        switch (notificationBody.referencesProgress) {
            case ReferencesProgress.StartedCallHierarchy:
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

    public resetProgressBar(): void {
        if (this.referencesDelayProgress) {
            clearInterval(this.referencesDelayProgress);
        }
        if (this.currentUpdateProgressTimer) {
            if (this.currentUpdateProgressTimer) {
                clearInterval(this.currentUpdateProgressTimer);
            }
            if (this.currentUpdateProgressResolve) {
                this.currentUpdateProgressResolve(undefined);
            }
            this.currentUpdateProgressResolve = undefined;
            this.currentUpdateProgressTimer = undefined;
        }
        this.referencesProgressBarStartTime = 0;
    }

    public startRename(): void {
        this.renamePending = true;
    }

    public resetReferences(): void {
        this.renamePending = false;
        this.initializeViews();
        this.client.setReferencesCommandMode(ReferencesCommandMode.None);
    }

    public showResultsInPanelView(referencesResult: ReferencesResult): void {
        this.initializeViews();
        this.clearViews();

        if (this.client.ReferencesCommandMode === ReferencesCommandMode.Peek && !this.referencesChannel) {
            this.referencesChannel = vscode.window.createOutputChannel(localize("c.cpp.peek.references", "C/C++ Peek References"));
            this.disposables.push(this.referencesChannel);
        }

        if (this.referencesStartedWhileTagParsing) {
            const msg: string = localize("some.references.may.be.missing", "[Warning] Some references may be missing, because workspace parsing was incomplete when {0} was started.",
                referencesCommandModeToString(this.client.ReferencesCommandMode));
            if (this.client.ReferencesCommandMode === ReferencesCommandMode.Peek) {
                if (this.referencesChannel) {
                    this.referencesChannel.appendLine(msg);
                    this.referencesChannel.appendLine("");
                    this.referencesChannel.show(true);
                }
            } else if (this.client.ReferencesCommandMode === ReferencesCommandMode.Find) {
                const logChannel: vscode.OutputChannel = logger.getOutputChannel();
                logChannel.appendLine(msg);
                logChannel.appendLine("");
                logChannel.show(true);
            }
        }

        if (this.client.ReferencesCommandMode === ReferencesCommandMode.Find || this.client.ReferencesCommandMode === ReferencesCommandMode.Peek) {
            if (this.findAllRefsView) {
                this.findAllRefsView.setData(referencesResult, this.groupByFile.Value);
            }

            // Display in "Other References" view or channel based on command mode: "peek references" OR "find all references"
            if (this.client.ReferencesCommandMode === ReferencesCommandMode.Peek) {
                const showConfirmedReferences: boolean = referencesResult.isCanceled;
                if (this.findAllRefsView) {
                    const peekReferencesResults: string = this.findAllRefsView.getResultsAsText(showConfirmedReferences);
                    if (peekReferencesResults) {
                        if (this.referencesChannel) {
                            this.referencesChannel.appendLine(peekReferencesResults);
                            this.referencesChannel.show(true);
                        }
                    }
                }
            } else if (this.client.ReferencesCommandMode === ReferencesCommandMode.Find) {
                if (this.findAllRefsView) {
                    this.findAllRefsView.show(true);
                }
            }
        }

        // If this is the final result, reset after process results.
        if (referencesResult.isFinished || referencesResult.isCanceled) {
            this.resetReferences();
        }
    }

    public getCallHierarchyProgressBarDuration(): number | undefined {
        let referencesProgressBarDuration: number | undefined;

        if (this.referencesProgressBarStartTime !== 0) {
            referencesProgressBarDuration = Date.now() - this.referencesProgressBarStartTime;
            this.referencesProgressBarStartTime = 0;
        }
        return referencesProgressBarDuration;
    }

    public clearViews(): void {
        // Rename should not clear the Find All References view
        if (this.client.ReferencesCommandMode !== ReferencesCommandMode.Rename) {
            if (this.referencesChannel) {
                this.referencesChannel.clear();
            }
            if (this.findAllRefsView) {
                this.findAllRefsView.show(false);
            }
        }
    }
}
