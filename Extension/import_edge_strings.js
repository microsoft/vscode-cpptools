'use strict';

const fs = require('fs');
const path = require('path');
const parseString = require('xml2js').parseString;

let vsRepoPath = process.argv[2];
let cpptoolsRepoPath = process.argv[3];

if (!vsRepoPath || !cpptoolsRepoPath) {
    console.error(`ERROR: Usage: ${path.parse(process.argv[0]).base} ${path.parse(process.argv[1]).base} <VS repo path> <vscode-cpptools repo path>`);
    return;
}

console.log("Importing EDGE strings from VS repo: " + vsRepoPath);
console.log("Writing to cpptols repo: " + cpptoolsRepoPath);

let locPath = path.join(vsRepoPath, "auxsrc/Localize");

if (!fs.existsSync(path.join(locPath, ".git"))) {
    console.error("ERROR: Localize repo submodule is not initialized in VS repo");
    return;
}

const languages = [
    { id: "zh-TW", folderName: "cht", transifexId: "zh-hant" },
    { id: "zh-CN", folderName: "chs", transifexId: "zh-hans" },
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

var locFolderNames = fs.readdirSync(locPath).filter(f => fs.lstatSync(path.join(locPath, f)).isDirectory());
locFolderNames.forEach((locFolderName) => {
    let lclPath = path.join(locPath, locFolderName, "vc/vc/cpfeui.dll.lcl");
    let languageId = languages.find(l => l.folderName == locFolderName).id;
    let outputPath = path.join(cpptoolsRepoPath, "Extension/bin", `edge_strings.${languageId}.json`);
    let sourceContent = fs.readFileSync(lclPath, 'utf-8');

    // Scan once, just to determine how many there are the size of the array we need
    let highestValue = 0;
    parseString(sourceContent, function (err, result) {
        result.LCX.Item.forEach((item) => {
            if (item.$.ItemId == ";String Table") {
                item.Item.forEach((subItem) => {
                    let itemId = parseInt(subItem.$.ItemId, 10);
                    if (subItem.Str[0].Tgt) {
                        //console.log(subItem.Str[0].Tgt[0].Val[0]);
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
                        resultArray[itemId] = subItem.Str[0].Tgt[0].Val[0];
                        if (highestValue < itemId) {
                            highestValue = itemId;
                        }
                    }
                });
            }
        });
    });

    fs.writeFileSync(outputPath, JSON.stringify(resultArray), 'utf8');
});
