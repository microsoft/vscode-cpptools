/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
import * as vscode from 'vscode';

class Deferral {
    private timer?: NodeJS.Timeout;

    constructor(callback: () => void, timeout: number) {
        this.timer = setTimeout(() => {
            this.timer = undefined; ''
            callback();
        }, timeout);
    }
    public cancel() {
        if (this.timer) {
            clearTimeout(this.timer);
            this.timer = undefined;
        }
    }
}

export class DataBinding<T> {
    private valueChanged = new vscode.EventEmitter<T>();
    private isActive: boolean = true;
    private deferral?: Deferral;

    constructor(private value: T, private delay: number = 0, private delayValueTrigger?: T) {
        this.isActive = true;
    }

    public get Value(): T {
        return this.value;
    }

    public set Value(value: T) {
        if (value !== this.value) {
            if (this.delay === 0 || value !== this.delayValueTrigger) {
                this.value = value;
                this.valueChanged.fire(this.value);
            } else {
                if (this.deferral) {
                    this.deferral.cancel();
                }
                this.deferral = new Deferral(() => {
                    this.value = value;
                    this.valueChanged.fire(this.value);
                }, this.delay);
            }
        } else if (this.deferral) {
            this.deferral.cancel();
            this.deferral = undefined;
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
