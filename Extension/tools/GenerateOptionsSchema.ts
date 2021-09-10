/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */

import * as fs from 'fs';
import * as os from 'os';

function appendFieldsToObject(reference: any, obj: any): any {
    // Make sure it is an object type
    if (typeof obj === 'object') {
        for (const referenceKey in reference) {
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
    const newDefault: any = {};

    for (const attrname in childDefault) {
        newDefault[attrname] = childDefault[attrname];
    }

    for (const attrname in parentDefault) {
        newDefault[attrname] = parentDefault[attrname];
    }

    return newDefault;
}

function updateDefaults(object: any, defaults: any): any {
    if (defaults !== null) {
        for (const key in object) {
            if (object[key].hasOwnProperty('type') && object[key].type === 'object' && object[key].properties !== null) {
                object[key].properties = updateDefaults(object[key].properties, mergeDefaults(defaults, object[key].default));
            } else if (defaults && key in defaults) {
                object[key].default = defaults[key];
            }
        }
    }

    return object;
}

function refReplace(definitions: any, ref: any): any {
// $ref is formatted as "#/definitions/ObjectName"
    const referenceStringArray: string[] = ref['$ref'].split('/');

    // Getting "ObjectName"
    const referenceName: string = referenceStringArray[referenceStringArray.length - 1];

    // Make sure reference has replaced its own $ref fields and hope there are no recursive references.
    definitions[referenceName] = replaceReferences(definitions, definitions[referenceName]);

    // Retrieve ObjectName from definitions. (TODO: Does not retrieve inner objects)
    // Need to deep copy, there are no functions in these objects.
    const reference: any = JSON.parse(JSON.stringify(definitions[referenceName]));

    ref = appendFieldsToObject(reference, ref);

    // Remove $ref field
    delete ref['$ref'];

    return ref;
}

function replaceReferences(definitions: any, objects: any): any {
    for (const key in objects) {
        if (objects[key].hasOwnProperty('$ref')) {
            objects[key] = refReplace(definitions, objects[key]);
        }

        // Handle 'anyOf' with references
        if (objects[key].hasOwnProperty('anyOf')) {
            for (const index in objects[key].anyOf) {
                if (objects[key].anyOf[index].hasOwnProperty('$ref')) {
                    objects[key].anyOf[index] = refReplace(definitions, objects[key].anyOf[index]);
                }
            }
        }

        // Recursively replace references if this object has properties.
        if (objects[key].hasOwnProperty('type') && objects[key].type === 'object' && objects[key].properties !== null) {
            objects[key].properties = replaceReferences(definitions, objects[key].properties);
            objects[key].properties = updateDefaults(objects[key].properties, objects[key].default);
        }

        // Recursively replace references if the array has objects in items.
        if (objects[key].hasOwnProperty('type') && objects[key].type === "array" && objects[key].items !== null && objects[key].items.hasOwnProperty('$ref')) {
            objects[key].items = refReplace(definitions, objects[key].items);
        }
    }

    return objects;
}

function mergeReferences(baseDefinitions: any, additionalDefinitions: any): void {
    for (const key in additionalDefinitions) {
        if (baseDefinitions[key]) {
            throw `Error: '${key}' defined in multiple schema files.`;
        }
        baseDefinitions[key] = additionalDefinitions[key];
    }
}

function generateOptionsSchema(): void {
    const packageJSON: any = JSON.parse(fs.readFileSync('package.json').toString());
    const schemaJSON: any = JSON.parse(fs.readFileSync('tools/OptionsSchema.json').toString());
    const symbolSettingsJSON: any = JSON.parse(fs.readFileSync('tools/VSSymbolSettings.json').toString());

    mergeReferences(schemaJSON.definitions, symbolSettingsJSON.definitions);

    schemaJSON.definitions = replaceReferences(schemaJSON.definitions, schemaJSON.definitions);

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
}

generateOptionsSchema();
