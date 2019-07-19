/*! -------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
'use strict';

import * as nls from 'vscode-nls';

nls.config({ messageFormat: nls.MessageFormat.file })();

const localize: nls.LocalizeFunc = nls.loadMessageBundle();

export const testString: string = localize('test', 'value1');
