/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
import * as fs from "fs";
import * as path from 'path';
import { parseString } from 'xml2js';
import { mkdir, write } from './common';

export async function main() {

    const localizeRepoPath = process.argv[2];
    const cpptoolsRepoPath = process.argv[3];

    if (!localizeRepoPath || !cpptoolsRepoPath) {
        console.error(`ERROR: Usage: ${path.parse(process.argv[0]).base} ${path.parse(process.argv[1]).base} <Localize repo path> <vscode-cpptools repo path>`);
        return;
    }

    console.log("Importing EDGE strings from Localize repo: " + localizeRepoPath);
    console.log("Writing to cpptools repo: " + cpptoolsRepoPath);

    if (!fs.existsSync(path.join(localizeRepoPath, ".git"))) {
        console.error("ERROR: Localize repo submodule is not initialized in Localize repo");
        return;
    }

    const languages = [
        { id: "zh-tw", folderName: "cht", transifexId: "zh-hant" },
        { id: "zh-cn", folderName: "chs", transifexId: "zh-hans" },
        { id: "fr", folderName: "fra" },
        { id: "de", folderName: "deu" },
        { id: "it", folderName: "ita" },
        { id: "es", folderName: "esn" },
        { id: "ja", folderName: "jpn" },
        { id: "ko", folderName: "kor" },
        { id: "ru", folderName: "rus" },
        { id: "bg", folderName: "bul" }, // VS Code supports Bulgarian, but VS is not currently localized for those languages.
        { id: "hu", folderName: "hun" }, // VS Code supports Hungarian, but VS is not currently localized for those languages.
        { id: "pt-br", folderName: "ptb", transifexId: "pt-BR" },
        { id: "tr", folderName: "trk" },
        { id: "cs", folderName: "csy" },
        { id: "pl", folderName: "plk" }
    ];

    const locFolderNames = fs.readdirSync(localizeRepoPath).filter(f => fs.lstatSync(path.join(localizeRepoPath, f)).isDirectory());
    for (const locFolderName of locFolderNames) {
        const lclPath = path.join(localizeRepoPath, locFolderName, "vc/vc/cpfeui.dll.lcl");
        const languageInfo = languages.find(l => l.folderName === locFolderName);
        if (!languageInfo) {
            return;
        }
        const languageId = languageInfo.id;
        const outputLanguageFolder = path.join(cpptoolsRepoPath, "Extension/bin/messages", languageId);
        const outputPath = path.join(outputLanguageFolder, "messages.json");
        const sourceContent = fs.readFileSync(lclPath, 'utf-8');

        // Scan once, just to determine how many there are the size of the array we need
        let highestValue = 0;
        parseString(sourceContent, function (err, result) {
            result.LCX.Item.forEach((item) => {
                if (item.$.ItemId === ";String Table") {
                    item.Item.forEach((subItem) => {
                        const itemId = parseInt(subItem.$.ItemId, 10);
                        if (subItem.Str[0].Tgt) {
                            if (highestValue < itemId) {
                                highestValue = itemId;
                            }
                        }
                    });
                }
            });
        });

        const resultArray = new Array(highestValue);
        parseString(sourceContent, function (err, result) {
            result.LCX.Item.forEach((item) => {
                if (item.$.ItemId === ";String Table") {
                    item.Item.forEach((subItem) => {
                        const itemId = parseInt(subItem.$.ItemId, 10);
                        if (subItem.Str[0].Tgt) {
                            resultArray[itemId] = subItem.Str[0].Tgt[0].Val[0].replace(/\]5D;/g, "]");
                            if (highestValue < itemId) {
                                highestValue = itemId;
                            }
                        }
                    });
                }
            });
        });

        await mkdir(outputLanguageFolder);
        await write(outputPath, JSON.stringify(resultArray, null, 4) + "\n");
    }
}
