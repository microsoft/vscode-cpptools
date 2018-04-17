/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
'use strict';

import { CppToolsApi, CustomConfigurationProvider } from './api';
import * as LanguageServer from './LanguageServer/extension';

export class CppTools implements CppToolsApi {
    registerCustomConfigurationProvider(provider: CustomConfigurationProvider): void {
        LanguageServer.registerCustomConfigurationProvider(provider);
    }
}