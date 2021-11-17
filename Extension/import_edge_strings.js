'use strict';

const fs = require('fs');
const path = require('path');
const parseString = require('xml2js').parseString;

let localizeRepoPath = process.argv[2];
let cpptoolsRepoPath = process.argv[3];

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

var locFolderNames = fs.readdirSync(localizeRepoPath).filter(f => fs.lstatSync(path.join(localizeRepoPath, f)).isDirectory());
locFolderNames.forEach((locFolderName) => {
    let lclPath = path.join(localizeRepoPath, locFolderName, "vc/vc/cpfeui.dll.lcl");
    let languageInfo = languages.find(l => l.folderName == locFolderName);
    if (!languageInfo) {
        return;
    }
    let languageId = languageInfo.id;
    let outputLanguageFolder = path.join(cpptoolsRepoPath, "Extension/bin/messages", languageId);
    let outputPath = path.join(outputLanguageFolder, "messages.json");
    let sourceContent = fs.readFileSync(lclPath, 'utf-8');

    // Scan once, just to determine how many there are the size of the array we need
    let highestValue = 0;
    parseString(sourceContent, function (err, result) {
        result.LCX.Item.forEach((item) => {
            if (item.$.ItemId == ";String Table") {
                item.Item.forEach((subItem) => {
                    let itemId = parseInt(subItem.$.ItemId, 10);
                    if (subItem.Str[0].Tgt) {
                        if (highestValue < itemId) {
                            highestValue = itemId;
                        }
                    }
                });
            }
        });
    });

    let resultArray = new Array(highestValue);
    parseString(sourceContent, function (err, result) {
        result.LCX.Item.forEach((item) => {
            if (item.$.ItemId == ";String Table") {
                item.Item.forEach((subItem) => {
                    let itemId = parseInt(subItem.$.ItemId, 10);
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

    fs.mkdirSync(outputLanguageFolder, { recursive: true });
    fs.writeFileSync(outputPath, JSON.stringify(resultArray, null, 2), 'utf8');
});
