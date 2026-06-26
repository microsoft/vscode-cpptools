/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

'use strict';

const gulp = require('gulp');

const fs = require('fs');
const { getL10nJson, getL10nXlf, getL10nFilesFromXlf } = require('@vscode/l10n-dev');
const fastGlob = require('fast-glob');
const path = require('path');
const minimist = require('minimist');
const es = require('event-stream');
const vinyl = require('vinyl');
const parse5 = require('parse5');
const traverse = require('parse5-traverse');
const jsonc = require('comment-json'); // Used to allow comments in nativeStrings.json
const crypto = require('crypto');
const https = require('https');

// Patterns to find HTML files
const htmlFilesPatterns = [
    "ui/**/*.html",
    "Reinstalling the Extension.md"
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
        return path.substring(prefix.length);
    }
    ch = path.charAt(prefix.length);
    if (ch === '/' || ch === '\\') {
        return path.substring(prefix.length + 1);
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

// ****************************
// @vscode/l10n-dev helpers
//
// Localization is built around VS Code's l10n support (vscode.l10n.t at runtime and the
// "l10n" field in package.json). The helpers below collect the English strings from each
// source kind into the @vscode/l10n-dev "l10n JSON" format ({ key: string | { message, comment } }).
// The XLF round-trip (translations-export / translations-import) targets the same Microsoft
// localization (MLCP) pipeline that vscode-nls-dev previously fed.
// ****************************

// Collect TS source strings (vscode.l10n.t call sites) as a single l10n JSON object.
const collectSourceL10n = async () => {
    const files = await fastGlob('src/**/*.ts', { cwd: __dirname });
    const fileContents = files.map((relativePath) => ({
        extension: '.ts',
        contents: fs.readFileSync(path.join(__dirname, relativePath)).toString()
    }));
    return getL10nJson(fileContents);
};

// Collect HTML strings (data-loc-id attributes) as one l10n JSON section per file.
// Returns [{ name, contents }] where name is the relative file path (used as the XLF unit name).
const collectHtmlL10n = () => {
    const results = [];
    const files = fastGlob.sync([...htmlFilesPatterns, ...walkthroughHtmlFilesPatterns], { cwd: __dirname });
    for (const relativePath of files) {
        const fileContents = fs.readFileSync(path.join(__dirname, relativePath)).toString();
        const contents = {};
        const nodeCallback = (locId, locHint, node) => {
            let subNodeCount = 0;
            let text = "";
            node.childNodes.forEach((childNode) => {
                if (childNode.nodeName == "#text") {
                    text += childNode.value;
                } else {
                    text += `{${subNodeCount++}}`;
                }
            });
            contents[locId] = locHint ? { message: text, comment: [locHint] } : text;
        };
        const attributeCallback = (locId, locHint, attribute) => {
            contents[locId] = locHint ? { message: attribute.value, comment: [locHint] } : attribute.value;
        };
        traverseHtml(fileContents, nodeCallback, attributeCallback, false);
        if (Object.keys(contents).length > 0) {
            results.push({ name: relativePath.replace(/\\/g, '/'), contents });
        }
    }
    return results;
};

// Collect JSON schema description strings as one l10n JSON section per file.
const collectJsonSchemaL10n = () => {
    const results = [];
    const files = fastGlob.sync(jsonSchemaFilesPatterns, { cwd: __dirname });
    for (const relativePath of files) {
        const jsonTree = JSON.parse(fs.readFileSync(path.join(__dirname, relativePath)).toString());
        const filePath = relativePath.replace(/\\/g, '/');
        const contents = {};
        const descriptionCallback = (descPath, value, parent) => {
            const locId = filePath + "." + descPath;
            contents[locId] = parent.descriptionHint ? { message: value, comment: [parent.descriptionHint] } : value;
        };
        traverseJson(jsonTree, descriptionCallback, "");
        if (Object.keys(contents).length > 0) {
            results.push({ name: filePath, contents });
        }
    }
    return results;
};

// Maps an imported XLF unit name back to the i18n file it should be written to.
const importedSectionToI18nPath = (folderName, name) => {
    if (name === 'bundle') {
        return path.join('i18n', folderName, 'bundle.l10n.json');
    }
    if (name === 'package') {
        return path.join('i18n', folderName, 'package.i18n.json');
    }
    // HTML / JSON schema sections are keyed by their relative source path.
    return path.join('i18n', folderName, name + '.i18n.json');
};

gulp.task("translations-export", async () => {
    // Build a single XLF containing every English string: TS source, package.json, HTML, and JSON schema.
    const l10nContents = new Map();
    l10nContents.set('bundle', await collectSourceL10n());
    l10nContents.set('package', JSON.parse(fs.readFileSync(path.join(__dirname, 'package.nls.json')).toString()));
    for (const { name, contents } of collectHtmlL10n()) {
        l10nContents.set(name, contents);
    }
    for (const { name, contents } of collectJsonSchemaL10n()) {
        l10nContents.set(name, contents);
    }

    const xlf = getL10nXlf(l10nContents);
    const exportDir = path.join(__dirname, "..", `${translationProjectName}-localization-export`);
    fs.mkdirSync(exportDir, { recursive: true });
    fs.writeFileSync(path.join(exportDir, `${translationExtensionName}.xlf`), xlf);
});


// ****************************
// Command: translations-import
// The following is used to import an XLF file containing all language strings.
// This results in a i18n directory, which should be checked in.
// ****************************

// Imports translations from raw localized MLCP strings to VS Code .i18n.json files
gulp.task("translations-import", async () => {
    const options = minimist(process.argv.slice(2), {
        string: "location",
        default: {
            location: "../vscode-translations-import"
        }
    });
    for (const language of languages) {
        const id = language.transifexId || language.id;
        const xlfPath = path.join(options.location, id, translationProjectName, `${translationExtensionName}.xlf`);
        if (!fs.existsSync(xlfPath)) {
            continue;
        }
        const importedFiles = await getL10nFilesFromXlf(fs.readFileSync(xlfPath).toString());
        for (const importedFile of importedFiles) {
            // importedFile.name is the XLF unit name we assigned during export.
            const outputPath = path.join(__dirname, importedSectionToI18nPath(language.folderName, importedFile.name));
            fs.mkdirSync(path.dirname(outputPath), { recursive: true });
            fs.writeFileSync(outputPath, JSON.stringify(importedFile.messages, null, '\t'));
        }
    }
});

// ****************************
// Command: translations-generate
// The following is used to import an i18n directory structure and generate files used at runtime.
// ****************************

// Generate package.nls.*.json files from: ./i18n/*/package.i18n.json
// Outputs to root path, as these nls files need to be along side package.json
const generateAdditionalLocFiles = async () => {
    const englishPackage = JSON.parse(fs.readFileSync(path.join(__dirname, 'package.nls.json')).toString());
    for (const language of languages) {
        const i18nPackage = path.join(__dirname, 'i18n', language.folderName, 'package.i18n.json');
        if (!fs.existsSync(i18nPackage)) {
            continue;
        }
        const translated = jsonc.parse(fs.readFileSync(i18nPackage).toString());
        // Start from the English strings so any untranslated keys fall back to English.
        const merged = { ...englishPackage, ...translated };
        fs.writeFileSync(path.join(__dirname, `package.nls.${language.id}.json`), JSON.stringify(merged, null, '\t'));
    }
};

// Generates ./l10n/bundle.l10n.json (English) and ./l10n/bundle.l10n.<language_id>.json.
// VS Code loads these at runtime based on the "l10n" field in package.json.
const generateSrcLocBundle = async () => {
    const l10nDir = path.join(__dirname, 'l10n');
    fs.mkdirSync(l10nDir, { recursive: true });

    // English bundle, extracted from the vscode.l10n.t call sites.
    const englishBundle = await collectSourceL10n();
    fs.writeFileSync(path.join(l10nDir, 'bundle.l10n.json'), JSON.stringify(englishBundle, null, '\t'));

    // Per-language bundles, copied from the translated bundles produced by translations-import.
    for (const language of languages) {
        const translatedBundle = path.join(__dirname, 'i18n', language.folderName, 'bundle.l10n.json');
        if (fs.existsSync(translatedBundle)) {
            fs.copyFileSync(translatedBundle, path.join(l10nDir, `bundle.l10n.${language.id}.json`));
        }
    }
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
    });
};

const generateLocalizedWalkthroughHtmlFiles = () => {
    return es.through(function (file) {
        let relativePath = removePathPrefix(file.path, file.cwd);
        languages.map((language) => {
            let newPath = relativePath.substring(0, relativePath.lastIndexOf(".")) + `.nls.${language.id}.md`;
            let newContent = generateLocalizedHtmlFilesImpl(file, relativePath, language, true);
            this.queue(new vinyl({
                path: newPath,
                contents: Buffer.from(newContent, 'utf8')
            }));
        });
        // Put the original in an 'en' file.
        let newPath = relativePath.substring(0, relativePath.lastIndexOf(".")) + ".nls.en.md";
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

