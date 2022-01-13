/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

'use strict';

const gulp = require('gulp');
const eslint = require('gulp-eslint');
const fs = require('fs');
const nls = require('vscode-nls-dev');
const path = require('path');
const minimist = require('minimist');
const es = require('event-stream');
const sourcemaps = require('gulp-sourcemaps');
const ts = require('gulp-typescript');
const typescript = require('typescript');
const tsProject = ts.createProject('./tsconfig.json', { typescript });
const filter = require('gulp-filter');
const vinyl = require('vinyl');
const parse5 = require('parse5');
const traverse = require('parse5-traverse');
const jsonc = require('comment-json'); // Used to allow comments in nativeStrings.json
const crypto = require('crypto');
const https = require('https');

// Patterns to find HTML files
const htmlFilesPatterns = [
    "ui/**/*.html"
];

// HTML files for walkthroughs are handled differently, as localization support
// requires specific file name patterns, and must all reside in the same directory.
const walkthroughHtmlFilesPatterns = [
    "walkthrough/**/*.md"
];

const jsonSchemaFilesPatterns = [
    "*.schema.json"
];

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
    //{ id: "bg", folderName: "bul" }, // VS Code supports Bulgarian, but VS is not currently localized for it
    //{ id: "hu", folderName: "hun" }, // VS Code supports Hungarian, but VS is not currently localized for it
    { id: "pt-br", folderName: "ptb", transifexId: "pt-BR" },
    { id: "tr", folderName: "trk" },
    { id: "cs", folderName: "csy" },
    { id: "pl", folderName: "plk" }
];

/// Misc Tasks
const allTypeScript = [
    'src/**/*.ts',
    '!**/*.d.ts',
    '!**/typings**'
];

gulp.task('lint', function () {
    return gulp.src(allTypeScript)
        .pipe(eslint({ configFile: ".eslintrc.js" }))
        .pipe(eslint.format())
        .pipe(eslint.failAfterError());
});


// ****************************
// Command: translations-export
// The following is used to export and XLF file containing english strings for translations.
// The result will be written to: ../vscode-extensions-localization-export/ms-vscode/
// ****************************

const translationProjectName = "vscode-extensions";
const translationExtensionName = "vscode-cpptools";

function removePathPrefix(path, prefix) {
    if (!prefix) {
        return path;
    }
    if (!path.startsWith(prefix)) {
        return path;
    }
    if (path === prefix) {
        return "";
    }
    let ch = prefix.charAt(prefix.length - 1);
    if (ch === '/' || ch === '\\') {
        return path.substr(prefix.length);
    }
    ch = path.charAt(prefix.length);
    if (ch === '/' || ch === '\\') {
        return path.substr(prefix.length + 1);
    }
    return path;
}

const dataLocIdAttribute = "data-loc-id";
const dataLocHintAttribute = "data-loc-hint";

// Helper to traverse HTML tree
// nodeCallback(locId, locHint, node) is invoked for nodes
// attributeCallback(locId, locHint, attribute) is invoked for attributes
const traverseHtml = (contents, nodeCallback, attributeCallback, isFragment) => {
    const htmlTree = isFragment ? parse5.parseFragment(contents) : parse5.parse(contents);
    traverse(htmlTree, {
        pre(node, parent) {
            if (node.attrs) {
                // Check if content text should be localized based on presense of data-loc-id attribute
                let locId = node.attrs.find(attribute => attribute.name.toLowerCase() == dataLocIdAttribute);
                if (locId) {
                    let locHint = node.attrs.find(attribute => attribute.name.toLowerCase() == dataLocHintAttribute);
                    nodeCallback(locId.value, locHint?.value, node);
                }
                // Check if an attribute should be localized based on presense of data-loc-id-<attribute_name> attribute
                node.attrs.forEach(attribute => {
                    if (attribute.name.startsWith(`${dataLocIdAttribute}-`)) {
                        let targetAttributeName = attribute.name.substring(dataLocIdAttribute.length + 1);
                        let targetAttribute = node.attrs.find(a => a.name == targetAttributeName);
                        if (targetAttribute) {
                            let hint = node.attrs.find(a => a.name.toLowerCase() == `${dataLocHintAttribute}-${targetAttributeName}`);
                            attributeCallback(attribute.value, hint?.value, targetAttribute);
                        }
                    }
                });
            }
        }
    });
    return htmlTree;
};

// Traverses the HTML document looking for node and attributes containing data-loc-id, to localize
// Outputs *.nls.json files containing strings to localize.
const processHtmlFiles = () => {
    return es.through(function (file) {
        let localizationJsonContents = {};
        let localizationMetadataContents = {
            messages: [],
            keys: [],
            filePath: removePathPrefix(file.path, file.cwd)
        };
        let nodeCallback = (locId, locHint, node) => {
            let subNodeCount = 0;
            let text = "";
            node.childNodes.forEach((childNode) => {
                if (childNode.nodeName == "#text") {
                    text += childNode.value;
                } else {
                    text += `{${subNodeCount++}}`;
                }
            });
            localizationJsonContents[locId] = text;
            localizationMetadataContents.keys.push(locHint ? { key: locId, comment: [locHint] } : locId);
            localizationMetadataContents.messages.push(text);
        };
        let attributeCallback = (locId, locHint, attribute) => {
            localizationJsonContents[locId] = attribute.value;
            localizationMetadataContents.keys.push(locHint ? { key: locId, comment: [locHint] } : locId);
            localizationMetadataContents.messages.push(attribute.value);
        };
        traverseHtml(file.contents.toString(), nodeCallback, attributeCallback, false);
        this.queue(new vinyl({
            path: path.join(file.path + '.nls.json'),
            contents: Buffer.from(JSON.stringify(localizationJsonContents, null, '\t'), 'utf8')
        }));
        this.queue(new vinyl({
            path: path.join(file.path + '.nls.metadata.json'),
            contents: Buffer.from(JSON.stringify(localizationMetadataContents, null, '\t'), 'utf8')
        }));
    });
};

// descriptionCallback(path, value, parent) is invoked for attributes
const traverseJson = (jsonTree, descriptionCallback, prefixPath) => {
    for (let fieldName in jsonTree) {
        if (jsonTree[fieldName] !== null) {
            if (typeof (jsonTree[fieldName]) == "string" && (fieldName === "description" || fieldName === "markdownDescription")) {
                descriptionCallback(prefixPath, jsonTree[fieldName], jsonTree);
            } else if (typeof (jsonTree[fieldName]) == "object") {
                let path = prefixPath;
                if (path !== "")
                    path = path + ".";
                path = path + fieldName;
                traverseJson(jsonTree[fieldName], descriptionCallback, path);
            }
        }
    }
};

// Traverses schema json files looking for "description" fields to localized.
// The path to the "description" field is used to create a localization key.
const processJsonSchemaFiles = () => {
    return es.through(function (file) {
        let jsonTree = JSON.parse(file.contents.toString());
        let localizationJsonContents = {};
        let filePath = removePathPrefix(file.path, file.cwd);
        let localizationMetadataContents = {
            messages: [],
            keys: [],
            filePath: filePath
        };
        let descriptionCallback = (path, value, parent) => {
            let locId = filePath + "." + path;
            let locHint = parent.descriptionHint;
            localizationJsonContents[locId] = value;
            localizationMetadataContents.keys.push(locHint ? { key: locId, comment: [locHint] } : locId);
            localizationMetadataContents.messages.push(value);
        };
        traverseJson(jsonTree, descriptionCallback, "");
        this.queue(new vinyl({
            path: path.join(file.path + '.nls.json'),
            contents: Buffer.from(JSON.stringify(localizationJsonContents, null, '\t'), 'utf8')
        }));
        this.queue(new vinyl({
            path: path.join(file.path + '.nls.metadata.json'),
            contents: Buffer.from(JSON.stringify(localizationMetadataContents, null, '\t'), 'utf8')
        }));
    });
};

gulp.task("translations-export", (done) => {

    // Transpile the TS to JS, and let vscode-nls-dev scan the files for calls to localize.
    let jsStream = tsProject.src()
        .pipe(sourcemaps.init())
        .pipe(tsProject()).js
        .pipe(nls.createMetaDataFiles());

    // Scan html files for tags with the data-loc-id attribute
    let htmlStream = gulp.src([...htmlFilesPatterns, ...walkthroughHtmlFilesPatterns])
        .pipe(processHtmlFiles());

    let jsonSchemaStream = gulp.src(jsonSchemaFilesPatterns)
        .pipe(processJsonSchemaFiles());

    // Merge files from all source streams
    es.merge(jsStream, htmlStream, jsonSchemaStream)

    // Filter down to only the files we need
    .pipe(filter(['**/*.nls.json', '**/*.nls.metadata.json']))

    // Consoldate them into nls.metadata.json, which the xlf is built from.
    .pipe(nls.bundleMetaDataFiles('ms-vscode.cpptools', '.'))

    // filter down to just the resulting metadata files
    .pipe(filter(['**/nls.metadata.header.json', '**/nls.metadata.json']))

    // Add package.nls.json, used to localized package.json
    .pipe(gulp.src(["package.nls.json"]))

    // package.nls.json and nls.metadata.json are used to generate the xlf file
    // Does not re-queue any files to the stream.  Outputs only the XLF file
    .pipe(nls.createXlfFiles(translationProjectName, translationExtensionName))
    .pipe(gulp.dest(path.join("..", `${translationProjectName}-localization-export`)))
    .pipe(es.wait(() => {
        done();
    }));
});


// ****************************
// Command: translations-import
// The following is used to import an XLF file containing all language strings.
// This results in a i18n directory, which should be checked in.
// ****************************

// Imports translations from raw localized MLCP strings to VS Code .i18n.json files
gulp.task("translations-import", (done) => {
    let options = minimist(process.argv.slice(2), {
        string: "location",
        default: {
            location: "../vscode-translations-import"
        }
    });
    es.merge(languages.map((language) => {
        let id = language.transifexId || language.id;
        return gulp.src(path.join(options.location, id, translationProjectName, `${translationExtensionName}.xlf`))
            .pipe(nls.prepareJsonFiles())
            .pipe(gulp.dest(path.join("./i18n", language.folderName)));
    }))
    .pipe(es.wait(() => {
        done();
    }));
});

// ****************************
// Command: translations-generate
// The following is used to import an i18n directory structure and generate files used at runtime.
// ****************************

// Generate package.nls.*.json files from: ./i18n/*/package.i18n.json
// Outputs to root path, as these nls files need to be along side package.json
const generateAdditionalLocFiles = () => {
    return gulp.src(['package.nls.json'])
        .pipe(nls.createAdditionalLanguageFiles(languages, 'i18n'))
        .pipe(gulp.dest('.'));
};

// Generates ./dist/nls.bundle.<language_id>.json from files in ./i18n/** *//<src_path>/<filename>.i18n.json
// Localized strings are read from these files at runtime.
const generateSrcLocBundle = () => {
    // Transpile the TS to JS, and let vscode-nls-dev scan the files for calls to localize.
    return tsProject.src()
        .pipe(sourcemaps.init())
        .pipe(tsProject()).js
        .pipe(nls.createMetaDataFiles())
        .pipe(nls.createAdditionalLanguageFiles(languages, "i18n"))
        .pipe(nls.bundleMetaDataFiles('ms-vscode.cpptools', 'dist'))
        .pipe(nls.bundleLanguageFiles())
        .pipe(filter(['**/nls.bundle.*.json', '**/nls.metadata.header.json', '**/nls.metadata.json']))
        .pipe(gulp.dest('dist'));
};

const generateLocalizedHtmlFilesImpl = (file, relativePath, language, isFragment) => {
    let stringTable = {};
    // Try to open i18n file for this file
    let locFile = path.join("./i18n", language.folderName, relativePath + ".i18n.json");
    if (fs.existsSync(locFile)) {
        stringTable = jsonc.parse(fs.readFileSync(locFile).toString());
    }
    // Entire file is scanned and modified, then serialized for that language.
    // Even if no translations are available, we still write new files to dist/html/...

    // Rewrite child nodes to fill in {0}, {1}, etc., in localized string.
    let nodeCallback = (locId, locHint, node) => {
        let locString = stringTable[locId];
        if (locString) {
            let nonTextChildNodes = node.childNodes.filter(childNode => childNode.nodeName != "#text");
            let textParts = locString.split(/\{[0-9]+\}/);
            let matchParts = locString.match(/\{[0-9]+\}/g);
            let newChildNodes = [];
            let i = 0;
            for (; i < textParts.length - 1; i++) {
                if (textParts[i] != "") {
                    newChildNodes.push({ nodeName: "#text", value: textParts[i] });
                }
                let childIndex = matchParts[i].match(/[0-9]+/);
                newChildNodes.push(nonTextChildNodes[childIndex]);
            }
            if (textParts[i] != "") {
                newChildNodes.push({ nodeName: "#text", value: textParts[i] });
            }
            node.childNodes = newChildNodes;
        }
    };
    let attributeCallback = (locId, locHint, attribute) => {
        let value = stringTable[locId];
        if (value) {
            attribute.value = value;
        }
    };
    let htmlTree = traverseHtml(file.contents.toString(), nodeCallback, attributeCallback, isFragment);
    return parse5.serialize(htmlTree);
};

const generateLocalizedHtmlFiles = () => {
    return es.through(function (file) {
        let relativePath = removePathPrefix(file.path, file.cwd);
        languages.map((language) => {
            let newContent = generateLocalizedHtmlFilesImpl(file, relativePath, language, false);
            this.queue(new vinyl({
                path: path.join("html", language.id, relativePath),
                contents: Buffer.from(newContent, 'utf8')
            }));
        });
        // Put the original in an 'en' directory.
        this.queue(new vinyl({
            path: path.join("html/en", relativePath),
            contents: file.contents
        }));
    });
};

const generateLocalizedWalkthroughHtmlFiles = () => {
    return es.through(function (file) {
        let relativePath = removePathPrefix(file.path, file.cwd);
        languages.map((language) => {
            let newPath = relativePath.substr(0, relativePath.lastIndexOf(".")) + `.nls.${language.id}.md`;
            let newContent = generateLocalizedHtmlFilesImpl(file, relativePath, language, true);
            this.queue(new vinyl({
                path: newPath,
                contents: Buffer.from(newContent, 'utf8')
            }));
        });
        // Put the original in an 'en' file.
        let newPath = relativePath.substr(0, relativePath.lastIndexOf(".")) + ".nls.en.md";
        this.queue(new vinyl({
            path: newPath,
            contents: file.contents
        }));
    });
}

// Generate localized versions of HTML files.
// Check for corresponding localized json file in i18n.
// Generate new version of the HTML file in: dist/html/<language_id>/<path>
const generateHtmlLoc = () => {
    return gulp.src(htmlFilesPatterns)
        .pipe(generateLocalizedHtmlFiles())
        .pipe(gulp.dest('dist'));
};

// Generate localized versions of walkthrough HTML (.md) files.
// Check for corresponding localized json file in i18n.
// Generate new version of the HTML file in: dist/<path>
// The destination filename will have ".md" extension replaced with: .nls.<language>.md
// For example, the Spanish translation of "walkthrough/doc.md" will be written to "dist/walkthrough/doc.nls.es.md".
const generateWalkthroughHtmlLoc = () => {
    return gulp.src(walkthroughHtmlFilesPatterns)
        .pipe(generateLocalizedWalkthroughHtmlFiles())
        .pipe(gulp.dest('dist'));
};

const generateLocalizedJsonSchemaFiles = () => {
    return es.through(function (file) {
        let jsonTree = JSON.parse(file.contents.toString());
        languages.map((language) => {
            let stringTable = {};
            // Try to open i18n file for this file
            let relativePath = removePathPrefix(file.path, file.cwd);
            let locFile = path.join("./i18n", language.folderName, relativePath + ".i18n.json");
            if (fs.existsSync(locFile)) {
                stringTable = jsonc.parse(fs.readFileSync(locFile).toString());
            }
            // Entire file is scanned and modified, then serialized for that language.
            // Even if no translations are available, we still write new files to dist/schema/...
            let keyPrefix = relativePath + ".";
            keyPrefix = keyPrefix.replace(/\\/g, "/");
            let descriptionCallback = (path, value, parent) => {
                if (stringTable[keyPrefix + path]) {
                    if (!parent.markdownDescription)
                        parent.description = stringTable[keyPrefix + path];
                    else
                        parent.markdownDescription = stringTable[keyPrefix + path];
                }
            };
            traverseJson(jsonTree, descriptionCallback, "");
            let newContent = JSON.stringify(jsonTree, null, '\t');
            this.queue(new vinyl({
                path: path.join("schema", language.id, relativePath),
                contents: Buffer.from(newContent, 'utf8')
            }));
        });
    });
};

// Generate localized versions of JSON schema files
// Check for corresponding localized json file in i18n
// Generate new version of the JSON schema file in dist/schema/<language_id>/<path>
const generateJsonSchemaLoc = () => {
    return gulp.src(jsonSchemaFilesPatterns)
        .pipe(generateLocalizedJsonSchemaFiles())
        .pipe(gulp.dest('dist'));
};

gulp.task('translations-generate', gulp.series(generateSrcLocBundle, generateAdditionalLocFiles, generateHtmlLoc, generateWalkthroughHtmlLoc, generateJsonSchemaLoc));

// ****************************
// Command: generate-native-strings
// The following is used to generate nativeStrings.ts and localized_string_ids.h from ./src/nativeStrings.json
// If adding localized strings to the native side, start by adding it to nativeStrings.json and use this to generate the others.
// ****************************

// A gulp task to parse ./src/nativeStrings.json and generate nativeStrings.ts, and localized_string_ids.h
gulp.task("generate-native-strings", (done) => {
    const stringTable = jsonc.parse(fs.readFileSync('./src/nativeStrings.json').toString());

    let nativeEnumContent = ""
    let nativeStringTableContent = "";
    let typeScriptSwitchContent = "";

    let stringIndex = 1;
    for (let property in stringTable) {
        let stringValue = stringTable[property];
        let hintValue;
        if (typeof stringValue !== "string") {
            hintValue = stringValue.hint;
            stringValue = stringValue.text;
        }

        // Add to native enum
        nativeEnumContent += `    ${property} = ${stringIndex},\n`;

        // Add to native string table
        nativeStringTableContent += `    ${JSON.stringify(stringValue)},\n`;

        // Add to TypeScript switch
        // Skip empty strings, which can be used to prevent enum/index reordering
        if (stringValue != "") {
            // It's possible that a translation may skip "{#}" entries, so check for up to 50 of them.
            let numArgs = 0;
            for (let i = 0; i < 50; i++) {
                if (stringValue.includes(`{${i}}`)) {
                    numArgs = i + 1;
                }
            }
            typeScriptSwitchContent += `        case ${stringIndex}:\n`;
            if (numArgs != 0) {
                typeScriptSwitchContent += `            if (stringArgs) {\n`;
                if (hintValue) {
                    typeScriptSwitchContent += `                message = localize({ key: ${JSON.stringify(property)}, comment: [${JSON.stringify(hintValue)}] }, ${JSON.stringify(stringValue)}`;
                } else {
                    typeScriptSwitchContent += `                message = localize(${JSON.stringify(property)}, ${JSON.stringify(stringValue)}`;
                }
                for (let i = 0; i < numArgs; i++) {
                    typeScriptSwitchContent += `, stringArgs[${i}]`;
                }
                typeScriptSwitchContent += `);\n                break;\n            }\n`;
            }
            if (hintValue) {
                typeScriptSwitchContent += `            message = localize({ key: ${JSON.stringify(property)}, comment: [${JSON.stringify(hintValue)}] }, ${JSON.stringify(stringValue)}`;
            } else {
                typeScriptSwitchContent += `            message = localize(${JSON.stringify(property)}, ${JSON.stringify(stringValue)}`;
            }
            typeScriptSwitchContent += `);\n            break;\n`;
        }
        ++stringIndex;
    };

    let typeScriptContent = `/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */

// ****** This file is generated from nativeStrings.json.  Do not edit this file directly. ******

'use strict';

import * as nls from 'vscode-nls';

nls.config({ messageFormat: nls.MessageFormat.bundle, bundleFormat: nls.BundleFormat.standalone })();
const localize: nls.LocalizeFunc = nls.loadMessageBundle();

export const localizedStringCount: number = ${stringIndex};

export function lookupString(stringId: number, stringArgs?: string[]): string {
    let message: string = "";
    switch (stringId) {
        case 0:
            // Special case for blank string
            break;
${typeScriptSwitchContent}
        default:
            console.assert(\"Unrecognized string ID\");
            break;
    }
    return message;
}
`;
    console.log("Writing file: ./src/nativeStrings.ts");
    fs.writeFileSync("./src/nativeStrings.ts", typeScriptContent, 'utf8');

    let nativeContents = `/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */

// ****** This file is generated from nativeStrings.json.  Do not edit this file directly. ******

#pragma once
// NOLINTBEGIN(modernize-raw-string-literal)
enum class localized_string_id : unsigned int
{
    blank = 0,
${nativeEnumContent}};

inline static const char *localizable_strings[] = {
    "",
${nativeStringTableContent}};
// NOLINTEND(modernize-raw-string-literal)
`;

    console.log("Writing file: localized_string_ids.h -- If changed, copy to VS repo: src/vc/designtime/vscode/Common/generated/");
    fs.writeFileSync("localized_string_ids.h", nativeContents, 'utf8');
    done();
});
