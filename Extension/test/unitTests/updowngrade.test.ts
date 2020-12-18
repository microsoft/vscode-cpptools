/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */

import * as assert from "assert";
import { Build, Asset, getTargetBuild } from "../../src/githubAPI";
import { PackageVersion } from '../../src/packageVersion';

suite("UpgradeDowngrade", () => {

    const asset_win32: Asset = {name: "cpptools-win32.vsix", browser_download_url: "https://github.com/microsoft/vscode-cpptools/releases/download/0.27.0/cpptools-win32.vsix"};
    const asset_linux: Asset = {name: "cpptools-linux.vsix", browser_download_url: "https://github.com/microsoft/vscode-cpptools/releases/download/0.27.0/cpptools-linux.vsix"};
    const asset_osx: Asset = {name: "cpptools-osx.vsix", browser_download_url: "https://github.com/microsoft/vscode-cpptools/releases/download/0.27.0/cpptools-osx.vsix"};
    const three_assets: Asset[] = [asset_win32, asset_linux, asset_osx];

    const release1patch: string = "0.28.1";
    const release1: string = "0.28.0";
    const insider3: string = "0.28.0-insiders3";
    const insider2: string = "0.28.0-insiders2";
    const insider1: string = "0.28.0-insiders";
    const release0patch: string = "0.27.1";
    const release0: string = "0.27.0";

    suite("DefaultChannel", () => {
        const updateChannel: string = "Default";
        // When updateChannel switches from 'Insiders' to 'Default', the only possible action is to downgrade.
        suite("Downgrade", () => {
            test("Insiders to Release", () => {
                const builds: Build[] = [{
                    name: insider3, assets: []}, {
                    name: insider2, assets: three_assets}, {
                    name: insider1, assets: three_assets}, {
                    name: release0patch, assets: []}, {
                    name: release0, assets: three_assets}];

                const userVersion: PackageVersion = new PackageVersion(insider2);
                const targetBuild: Build | undefined = getTargetBuild(builds, userVersion, updateChannel, false);
                assert.equal(targetBuild.name, release0);
            });
        });
        suite("Internal Testing, no Downgrade", () => {
            test("Insider to Release", () => {
                const builds: Build[] = [{
                    name: release0, assets: three_assets}];

                const userVersion: PackageVersion = new PackageVersion(insider1);
                const targetBuild: Build | undefined = getTargetBuild(builds, userVersion, updateChannel, false);
                assert.equal(targetBuild, undefined);
            });
            test("Insider to Insider", () => {
                const builds: Build[] = [{
                    name: insider2, assets: three_assets}, {
                    name: insider1, assets: three_assets}, {
                    name: release0, assets: three_assets}];

                const userVersion: PackageVersion = new PackageVersion(insider3);
                const targetBuild: Build | undefined = getTargetBuild(builds, userVersion, updateChannel, false);
                assert.equal(targetBuild, undefined);
            });
            test("Release to Insider (main)", () => {
                const builds: Build[] = [{
                    name: insider3, assets: three_assets}, {
                    name: insider2, assets: three_assets}, {
                    name: insider1, assets: three_assets}, {
                    name: release0, assets: three_assets}];
                // In internal testing, the name of the release has a "-main" at the end of it.
                const userVersion: PackageVersion = new PackageVersion(release1 + "-main");
                const targetBuild: Build | undefined = getTargetBuild(builds, userVersion, updateChannel, false);
                assert.equal(targetBuild, undefined);
            });
            test("Release to Insider", () => {
                const builds: Build[] = [{
                    name: insider3, assets: three_assets}, {
                    name: insider2, assets: three_assets}, {
                    name: insider1, assets: three_assets}, {
                    name: release0, assets: three_assets}];
                const userVersion: PackageVersion = new PackageVersion(release1);
                const targetBuild: Build | undefined = getTargetBuild(builds, userVersion, updateChannel, false);
                assert.equal(targetBuild, undefined);
            });
        });
    });

    suite("InsidersChannel", () => {
        const updateChannel: string = "Insiders";
        suite("Downgrade", () => {
            suite("Internal Testing, no Downgrade", () => {
                test("Insider to Release", () => {
                    const builds: Build[] = [{
                        name: release0, assets: three_assets}];

                    const userVersion: PackageVersion = new PackageVersion(insider1);
                    const targetBuild: Build | undefined = getTargetBuild(builds, userVersion, updateChannel, false);
                    assert.equal(targetBuild, undefined);
                });
                test("Insider to Insider", () => {
                    const builds: Build[] = [{
                        name: insider2, assets: three_assets}, {
                        name: insider1, assets: three_assets}, {
                        name: release0, assets: three_assets}];

                    const userVersion: PackageVersion = new PackageVersion(insider3);
                    const targetBuild: Build | undefined = getTargetBuild(builds, userVersion, updateChannel, false);
                    assert.equal(targetBuild, undefined);
                });
                test("Release to Insider (main)", () => {
                    const builds: Build[] = [{
                        name: insider3, assets: three_assets}, {
                        name: insider2, assets: three_assets}, {
                        name: insider1, assets: three_assets}, {
                        name: release0, assets: three_assets}];
                    // In internal testing, the name of the release has a "-main" at the end of it.
                    const userVersion: PackageVersion = new PackageVersion(release1 + "-main");
                    const targetBuild: Build | undefined = getTargetBuild(builds, userVersion, updateChannel, false);
                    assert.equal(targetBuild, undefined);
                });
                test("Release to Insider", () => {
                    const builds: Build[] = [{
                        name: insider3, assets: three_assets}, {
                        name: insider2, assets: three_assets}, {
                        name: insider1, assets: three_assets}, {
                        name: release0, assets: three_assets}];
                    const userVersion: PackageVersion = new PackageVersion(release1);
                    const targetBuild: Build | undefined = getTargetBuild(builds, userVersion, updateChannel, false);
                    assert.equal(targetBuild, undefined);
                });
            });

            suite("Insider Users, Downgrade", () => {
                test("Insider to Release", () => {
                    const builds: Build[] = [{
                        name: insider3, assets: []}, {
                        name: insider2, assets: []}, {
                        name: insider1, assets: []}, {
                        name: release0patch, assets: []}, {
                        name: release0, assets: three_assets}];

                    const userVersion: PackageVersion = new PackageVersion(insider3);
                    const targetBuild: Build | undefined = getTargetBuild(builds, userVersion, updateChannel, false);
                    assert.equal(targetBuild.name, release0);
                });
                test("Insider to Insider", () => {
                    const builds: Build[] = [{
                        name: insider3, assets: []}, {
                        name: insider2, assets: []}, {
                        name: insider1, assets: three_assets}, {
                        name: release0, assets: three_assets}];

                    const userVersion: PackageVersion = new PackageVersion(insider3);
                    const targetBuild: Build | undefined = getTargetBuild(builds, userVersion, updateChannel, false);
                    assert.equal(targetBuild.name, insider1);
                });
            });
        });

        suite("Upgrade", () => {
            suite("Automatic Upgrade", () => {
                test("Release to Release", () => {
                    const builds: Build[] = [{
                        name: release1patch, assets: []}, {
                        name: release1, assets: three_assets}, {
                        name: insider3, assets: three_assets}, {
                        name: insider2, assets: three_assets}];

                    const userVersion: PackageVersion = new PackageVersion(release0);
                    const targetBuild: Build | undefined = getTargetBuild(builds, userVersion, updateChannel, false);
                    assert.equal(targetBuild.name, release1);
                });
                test("Insider to Release", () => {
                    const builds: Build[] = [{
                        name: release1, assets: three_assets}, {
                        name: insider3, assets: three_assets}, {
                        name: insider2, assets: three_assets}];

                    const userVersion: PackageVersion = new PackageVersion(insider2);
                    const targetBuild: Build | undefined = getTargetBuild(builds, userVersion, updateChannel, false);
                    assert.equal(targetBuild.name, release1);
                });
            });

            suite("Asset Checking Upgrade", () => {
                test("Release to Insider, Upgrade", () => {
                    const builds: Build[] = [{
                        name: insider2, assets: []}, {
                        name: insider1, assets: three_assets}, {
                        name: release0, assets: three_assets}];

                    const userVersion: PackageVersion = new PackageVersion(release0);
                    const targetBuild: Build | undefined = getTargetBuild(builds, userVersion, updateChannel, false);
                    assert.equal(targetBuild.name, insider1);
                });
                test("Release to Insider, no Upgrade", () => {
                    const builds: Build[] = [{
                        name: insider2, assets: []}, {
                        name: insider1, assets: []}, {
                        name: release0, assets: three_assets}];

                    const userVersion: PackageVersion = new PackageVersion(release0);
                    const targetBuild: Build | undefined = getTargetBuild(builds, userVersion, updateChannel, false);
                    assert.equal(targetBuild, undefined);
                });
                test("Insider to Insider, Upgrade", () => {
                    const builds: Build[] = [{
                        name: insider3, assets: []}, {
                        name: insider2, assets: three_assets}, {
                        name: insider1, assets: three_assets}, {
                        name: release0, assets: three_assets}];

                    const userVersion: PackageVersion = new PackageVersion(insider1);
                    const targetBuild: Build | undefined = getTargetBuild(builds, userVersion, updateChannel, false);
                    assert.equal(targetBuild.name, insider2);
                });
                test("Insider to Insider, no Upgrade", () => {
                    const builds: Build[] = [{
                        name: insider3, assets: []}, {
                        name: insider2, assets: three_assets}, {
                        name: release0, assets: three_assets}];

                    const userVersion: PackageVersion = new PackageVersion(insider2);
                    const targetBuild: Build | undefined = getTargetBuild(builds, userVersion, updateChannel, false);
                    assert.equal(targetBuild, undefined);
                });
            });
        });
    });
});
