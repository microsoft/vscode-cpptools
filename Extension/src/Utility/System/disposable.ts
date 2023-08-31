/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */

// enable typescript disposable types/interfaces
/// <reference lib="esnext.disposable" />

export function dispose(onDispose: () => void): Disposable {
    return { [Symbol.dispose] : onDispose };
}
