/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as fs from 'fs';
import * as os from 'os';

function AppendFieldsToObject(reference: any, obj: any) {

    // Make sure it is an object type
    if (typeof obj == 'object') {
        for (let referenceKey in reference) {
            // If key exists in original object and is an object. 
            if (obj.hasOwnProperty(referenceKey)) {
                obj[referenceKey] = AppendFieldsToObject(reference[referenceKey], obj[referenceKey]);
            } else {
                // Does not exist in current object context
                obj[referenceKey] = reference[referenceKey];
            }
        }
    }

    return obj;
}

// Combines two object's fields, giving the parentDefault a higher precedence. 
function MergeDefaults(parentDefault: any, childDefault: any) {
    let newDefault: any = {};

    for (let attrname in childDefault) {
        newDefault[attrname] = childDefault[attrname];
    }

    for (let attrname in parentDefault) {
        newDefault[attrname] = parentDefault[attrname];
    }

    return newDefault;
}

function UpdateDefaults(object: any, defaults: any) {
    if (defaults != null) {
        for (let key in object) {
            if (object[key].hasOwnProperty('type') && object[key].type === 'object' && object[key].properties !== null) {
                object[key].properties = UpdateDefaults(object[key].properties, MergeDefaults(defaults, object[key].default));
            } else if (key in defaults) {
                object[key].default = defaults[key];
            }
        }
    }

    return object;
}

function RefReplace(definitions: any, ref: any): any {
// $ref is formatted as "#/definitions/ObjectName"
    let referenceStringArray: string[] = ref['$ref'].split('/');

    // Getting "ObjectName"
    let referenceName: string = referenceStringArray[referenceStringArray.length - 1];

    // Make sure reference has replaced its own $ref fields and hope there are no recursive references.
    definitions[referenceName] = ReplaceReferences(definitions, definitions[referenceName]);

    // Retrieve ObjectName from definitions. (TODO: Does not retrieve inner objects)
    // Need to deep copy, there are no functions in these objects.
    let reference: any = JSON.parse(JSON.stringify(definitions[referenceName]));

    ref = AppendFieldsToObject(reference, ref);

    // Remove $ref field
    delete ref['$ref'];

    return ref;
}

function ReplaceReferences(definitions: any, objects: any) {
    for (let key in objects) {
        if (objects[key].hasOwnProperty('$ref')) {
            objects[key] = RefReplace(definitions, objects[key]);
        }

        // Recursively replace references if this object has properties. 
        if (objects[key].hasOwnProperty('type') && objects[key].type === 'object' && objects[key].properties !== null) {
            objects[key].properties = ReplaceReferences(definitions, objects[key].properties);
            objects[key].properties = UpdateDefaults(objects[key].properties, objects[key].default);
        }

        // Recursively replace references if the array has objects in items.
        if (objects[key].hasOwnProperty('type') && objects[key].type === "array" && objects[key].items != null && objects[key].items.hasOwnProperty('$ref')) {
            objects[key].items = RefReplace(definitions, objects[key].items);
        }
    }

    return objects;
}

function MergeReferences(baseDefinitions: any, additionalDefinitions: any) : void {
    for (let key in additionalDefinitions) {
        if (baseDefinitions[key]) {
            throw `Error: '${key}' defined in multiple schema files.`;
        }
        baseDefinitions[key] = additionalDefinitions[key];
    }
}

export function GenerateOptionsSchema() {
    let packageJSON: any = JSON.parse(fs.readFileSync('package.json').toString());
    let schemaJSON: any = JSON.parse(fs.readFileSync('tools/OptionsSchema.json').toString());

    schemaJSON.definitions = ReplaceReferences(schemaJSON.definitions, schemaJSON.definitions);

    // Hard Code adding in configurationAttributes launch and attach.
    // cppdbg
    packageJSON.contributes.debuggers[0].configurationAttributes.launch = schemaJSON.definitions.CppdbgLaunchOptions;
    packageJSON.contributes.debuggers[0].configurationAttributes.attach = schemaJSON.definitions.CppdbgAttachOptions;

    // cppvsdbg
    packageJSON.contributes.debuggers[1].configurationAttributes.launch = schemaJSON.definitions.CppvsdbgLaunchOptions;
    packageJSON.contributes.debuggers[1].configurationAttributes.attach = schemaJSON.definitions.CppvsdbgAttachOptions;

    let content = JSON.stringify(packageJSON, null, 2);
    if (os.platform() === 'win32') {
        content = content.replace(/\n/gm, "\r\n");
    }
    
    // We use '\u200b' (unicode zero-length space character) to break VS Code's URL detection regex for URLs that are examples. This process will
    // convert that from the readable espace sequence, to just an invisible character. Convert it back to the visible espace sequence.
    content = content.replace(/\u200b/gm, "\\u200b");

    fs.writeFileSync('package.json', content);
}