/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as fs from 'fs';
import * as os from 'os';

let nlsJSON: any = null;
let reverseNlsJSON: any = {};

const collisionList = [
    'type', 
    'externalConsole', 
    'visualizerFile'
];

function appendFieldsToObject(reference: any, obj: any): any {
    // Make sure it is an object type
    if (typeof obj === 'object') {
        for (let referenceKey in reference) {
            // If key exists in original object and is an object.
            if (obj.hasOwnProperty(referenceKey)) {
                obj[referenceKey] = appendFieldsToObject(reference[referenceKey], obj[referenceKey]);
            } else {
                // Does not exist in current object context
                obj[referenceKey] = reference[referenceKey];
            }
        }
    }

    return obj;
}

// Combines two object's fields, giving the parentDefault a higher precedence.
function mergeDefaults(parentDefault: any, childDefault: any): any {
    let newDefault: any = {};

    for (let attrname in childDefault) {
        newDefault[attrname] = childDefault[attrname];
    }

    for (let attrname in parentDefault) {
        newDefault[attrname] = parentDefault[attrname];
    }

    return newDefault;
}

function updateDefaults(object: any, defaults: any, nameBuilder: string): any {
    if (defaults !== null) {
        for (let key in object) {
            if (object[key].hasOwnProperty('type') && object[key].type === 'object' && object[key].properties !== null) {
                object[key].properties = updateDefaults(object[key].properties, mergeDefaults(defaults, object[key].default), nameBuilder.concat(key, "."));
            } else if (key in defaults) {
                object[key].default = defaults[key];
            }
        }
    }

    return object;
}

function refReplace(definitions: any, ref: any): any {
// $ref is formatted as "#/definitions/ObjectName"
    let referenceStringArray: string[] = ref['$ref'].split('/');

    // Getting "ObjectName"
    let referenceName: string = referenceStringArray[referenceStringArray.length - 1];

    // Make sure reference has replaced its own $ref fields and hope there are no recursive references.
    definitions[referenceName] = replaceReferences(definitions, definitions[referenceName], "");

    // Retrieve ObjectName from definitions. (TODO: Does not retrieve inner objects)
    // Need to deep copy, there are no functions in these objects.
    let reference: any = JSON.parse(JSON.stringify(definitions[referenceName]));

    ref = appendFieldsToObject(reference, ref);

    // Remove $ref field
    delete ref['$ref'];

    return ref;
}

function replaceReferences(definitions: any, objects: any, nameBuilder: string): any {
    for (let key in objects) {
        if (objects[key].hasOwnProperty('$ref')) {
            objects[key] = refReplace(definitions, objects[key]);
        }

        // Recursively replace references if this object has properties.
        if (objects[key].hasOwnProperty('type') && objects[key].type === 'object' && objects[key].properties !== null) {
            objects[key].properties = replaceReferences(definitions, objects[key].properties, nameBuilder.concat(key, "."));
            objects[key].default = generateDefaultNLS(key, objects[key].default, nameBuilder)
            objects[key].properties = updateDefaults(objects[key].properties, objects[key].default, nameBuilder.concat(key, "."));
        }

        // Recursively replace references if the array has objects in items.
        if (objects[key].hasOwnProperty('type') && objects[key].type === "array" && objects[key].items !== null && objects[key].items.hasOwnProperty('$ref')) {
            objects[key].items = refReplace(definitions, objects[key].items);
        }

        objects[key] = generateDescriptionNLS(key, objects[key], nameBuilder);
    }

    return objects;
}

function generateDescriptionNLS(key: string, focusItem: any, nameBuilder: string) {
    if (focusItem.hasOwnProperty('anyOf'))
    {
        for (let i in focusItem.anyOf) {
            focusItem.anyOf[i] = generateDescriptionNLS(key, focusItem.anyOf[i], nameBuilder);
        }
    }

    if (focusItem.hasOwnProperty('description') && typeof focusItem.description === 'string' && focusItem.description.indexOf(' ') > 0) {           
        if (reverseNlsJSON.hasOwnProperty(focusItem.description)) {
            focusItem.description = "%" + reverseNlsJSON[focusItem.description] + "%";
        }
        else {
            let nlsString = "c_cpp.debuggers." + nameBuilder.concat(key, ".description");

            if (collisionList.indexOf(key) < 0)
            {
                nlsString = nlsString.replace(".CppdbgLaunchOptions", "");
                nlsString = nlsString.replace(".CppvsdbgLaunchOptions", "");
            }

            nlsJSON[nlsString] = focusItem.description;
            reverseNlsJSON[focusItem.description] = nlsString;
            focusItem.description = "%" + nlsString + "%";
        }
    }

    return focusItem;
}

// Goes through the default object and replaces the string with the nls version.
function generateDefaultNLS(parentName: string, defaultObj: any, nameBuilder: string) {
    for (let key in defaultObj) {
        if (typeof defaultObj[key] === 'string' && defaultObj[key].indexOf(' ') > 0) {
            if (reverseNlsJSON.hasOwnProperty(defaultObj[key])) {
                defaultObj[key] = "%" + reverseNlsJSON[defaultObj[key]] + "%";
            }
            else {
                let nlsString = "c_cpp.debuggers." + nameBuilder.concat(parentName, ".default.", key);

                if (collisionList.indexOf(parentName) < 0) {
                    nlsString = nlsString.replace(".CppdbgLaunchOptions", "");
                    nlsString = nlsString.replace(".CppvsdbgLaunchOptions", "");
                }

                nlsJSON[nlsString] = defaultObj[key];
                reverseNlsJSON[defaultObj[key]] = nlsString;
                defaultObj[key] = "%" + nlsString + "%";
            }
        }
    }

    return defaultObj;
}

export function generateOptionsSchema(): void {
    let packageJSON: any = JSON.parse(fs.readFileSync('package.json').toString());
    let schemaJSON: any = JSON.parse(fs.readFileSync('tools/OptionsSchema.json').toString());
    nlsJSON = JSON.parse(fs.readFileSync('package.nls.json').toString());

    schemaJSON.definitions = replaceReferences(schemaJSON.definitions, schemaJSON.definitions, "");

    // Hard Code adding in configurationAttributes launch and attach.
    // cppdbg
    packageJSON.contributes.debuggers[0].configurationAttributes.launch = schemaJSON.definitions.CppdbgLaunchOptions;
    packageJSON.contributes.debuggers[0].configurationAttributes.attach = schemaJSON.definitions.CppdbgAttachOptions;

    // cppvsdbg
    packageJSON.contributes.debuggers[1].configurationAttributes.launch = schemaJSON.definitions.CppvsdbgLaunchOptions;
    packageJSON.contributes.debuggers[1].configurationAttributes.attach = schemaJSON.definitions.CppvsdbgAttachOptions;

    let content: string = JSON.stringify(packageJSON, null, 2);
    if (os.platform() === 'win32') {
        content = content.replace(/\n/gm, "\r\n");
    }

    // We use '\u200b' (unicode zero-length space character) to break VS Code's URL detection regex for URLs that are examples. This process will
    // convert that from the readable espace sequence, to just an invisible character. Convert it back to the visible espace sequence.
    content = content.replace(/\u200b/gm, "\\u200b");

    fs.writeFileSync('package.json', content);
    fs.writeFileSync('package.nls.json', JSON.stringify(nlsJSON, null, 4));
}

generateOptionsSchema();