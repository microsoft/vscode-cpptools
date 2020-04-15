/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */

import * as assert from "assert";
import { resolveVariables, escapeForSquiggles } from "../../src/common";
import { Build, Asset, getTargetBuild } from "../../src/githubAPI";
import { PackageVersion } from '../../src/packageVersion';


suite("upgrade downgrade", () => {

    test("downgrade insiders", () => {
        const builds_downgrade: Build[] = [{
            name: "0.27.1-insiders", assets: [{name: "dummy_name", browser_download_url: "dummy_url"}]},{
            name: "0.27.0", assets: [{name: "dummy_name", browser_download_url: "dummy_url"}]},{
            name: "0.27.0-insiders2", assets: [{name: "dummy_name", browser_download_url: "dummy_url"}]},{
            name: "0.27.0-insiders1", assets: [{name: "dummy_name", browser_download_url: "dummy_url"}]},{
            name: "0.27.0", assets: [{name: "dummy_name", browser_download_url: "dummy_url"}]}];

        const userVersion: PackageVersion = new PackageVersion("0.27.1-insiders2");
        const updateChannel: string = "Insiders";
        const targetBuild: Build | undefined = getTargetBuild(builds_downgrade, userVersion, updateChannel);
        assert.equal(targetBuild, undefined);
    });

});

