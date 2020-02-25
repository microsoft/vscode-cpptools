/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
import * as vscode from 'vscode';

export class DataBinding<T> {
    private value: T;
    private valueChanged = new vscode.EventEmitter<T>();
    private isActive: boolean = true;

    constructor(value: T) {
        this.value = value;
        this.isActive = true;
    }

    public get Value(): T {
        return this.value;
    }

    public set Value(value: T) {
        if (value !== this.value) {
            this.value = value;
            this.valueChanged.fire(this.value);
        }
    }

    public setValueIfActive(value: T): void {
        if (value !== this.value) {
            this.value = value;
            if (this.isActive) {
                this.valueChanged.fire(this.value);
            }
        }
    }

    public get ValueChanged(): vscode.Event<T> {
        return this.valueChanged.event;
    }

    public activate(): void {
        this.isActive = true;
        this.valueChanged.fire(this.value);
    }

    public deactivate(): void {
        this.isActive = false;
    }

    public dispose(): void {
        this.deactivate();
        this.valueChanged.dispose();
    }
}
