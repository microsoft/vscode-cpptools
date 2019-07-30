/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All Rights Reserved.
 * See 'LICENSE' in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
'use strict';

import * as nls from 'vscode-nls';

const localize: nls.LocalizeFunc = nls.loadMessageBundle();

export function lookupString(stringId: number, stringArgs?: string[]): string {
    let message: string;
    switch (stringId) {
        case 0:
            message = "";   // Special case for blank string
            break;
        case 1:
            message = localize("send.response.failed", "Failed to send response to client: {0}", stringArgs[0]);
            break;
        case 2:
            message = localize("read.response.failed", "Failed to read response from server: {0}", stringArgs[0]);
            break;
        case 3:
            message = localize("send.request.failed", "Failed to send request to server: {0}", stringArgs[0]);
            break;
        case 4:
            message = localize("request.wait.error", "Unexpected error while waiting for requests: {0}", stringArgs[0]);
            break;
        case 5:
            message = localize("errored.with", "{0} errored with: {1}", "posix_spwan()", stringArgs[0]);
            break;
        case 6:
            message = localize("file.open.failed", "Failed to open the file {0}", stringArgs[0]);
            break;
        case 7:
            message = localize("default.query.failed", "Failed to query default include paths and defines for {0}. {1}", stringArgs[0], stringArgs[1]);
            break;
        case 8:
            message = localize("failed.call.getwindowsdirectory", "Failed calling {0}", "GetWindowsDirectory");
            break;
        case 9:
            message = localize("quick.info.failed", "Quick info operation failed: {0}", stringArgs[0]);
            break;
        case 10:
            message = localize("create.intellisense.client.failed", "Failed to create IntelliSense client. {0}", stringArgs[0]);
            break;
        case 11:
            message = localize("cant.find.intellisense.client", "Cannot find IntelliSense client: Invalid file path {0}", stringArgs[0]);
            break;
        case 12:
            message = localize("intellisense.spawn.failed", "Failed to spawn IntelliSense process: {0}", stringArgs[0]);
            break;
        case 13:
            message = localize("browse_engine_update_thread.join.failed", "Error calling browse_engine_update_thread.join(): {0}", stringArgs[0]);
            break;
        case 14:
            message = localize("already.open.different.casing", "This file ({0}) is already opened in the editor but with a different casing. IntelliSense features will be disabled on this copy of the file.", stringArgs[0]);
            break;
        case 15:
            message = localize("intellisense.client.disconnected", "IntelliSense client has disconnected from the server - {0}", stringArgs[0]);
            break;
        case 16:
            message = localize("formatting.failed", "Formatting failed:\n{0}\n  {1}", stringArgs[0], stringArgs[1]);
            break;
        case 17:
            message = localize("database.add.file.failed", "Unable to add file to database, error = {0}: {1}", stringArgs[0], stringArgs[1]);
            break;
        case 18:
            message = localize("reset.timestamp.failed", "Failed to reset timestamp during abort, error = {0}: {1}", stringArgs[0], stringArgs[1]);
            break;
        case 19:
            message = localize("update.timestamp.failed", "Unable to update timestamp, error = {0}: {1}", stringArgs[0], stringArgs[1]);
            break;
        case 20:
            message = localize("symbol.add.failed", "Unable to begin adding code symbols for file, error = {0}: {1}", stringArgs[0], stringArgs[1]);
            break;
        case 21:
            message = localize("finalize.updates.failed", "Unable to finalize updates for file, error = {0}: {1}", stringArgs[0], stringArgs[1]);
            break;
        case 22:
            message = "  " + localize("not.a.directory.with.mode", "{0} is not a directory (st_mode={1})", stringArgs[0], stringArgs[1]);
            break;
        case 23:
            message = "  " + localize("retrieve.fs.info.failed", "Unable to retrieve file system information for {0}. error = {1}}", stringArgs[0], stringArgs[1]);
            break;
        case 24:
            message = "  " + localize("not.a.directory", "{0} is not a directory", stringArgs[0], stringArgs[1]);
            break;
        case 25:
            message = localize("file.discovery.aborted", "File discovery was aborted");
            break;
        case 26:
            message = localize("aborting.tag.parse", "Aborting tag parse of {0} and dependencies", stringArgs[0]);
            break;
        case 27:
            message = localize("unable.to.retrieve.to.reset.timestamps", "Unable to retrieve DB records to reset timestamps: error = {0}", stringArgs[0]);
            break;
        case 28:
            message = localize("failed.to.reset.timestamps.for", "Failed to reset timestamp for {0}: error = {1}", stringArgs[0], stringArgs[1]);
            break;
        case 29:
            message = localize("no.suitable.complier", 'No suitable compiler found. Please set the "compilerPath" in c_cpp_properties.json.');
            break;
        case 30:
            message = localize("compiler.include.not.found", "Compiler include path not found: {0}", stringArgs[0]);
            break;
        case 31:
            message = localize("intellisense.not.responding", "IntelliSense engine is not responding. Using the Tag Parser instead.");
            break;
        case 32:
            message = localize("tag.parser.will.be.used", "Tag Parser will be used for IntelliSense operations in: %s", stringArgs[0]);
            break;
        case 33:
            message = localize("error.squiggles.disabled.in", "Error squiggles will be disabled in: {0}", stringArgs[0]);
            break;
        case 34:
            message = "  " + localize("processing.folder.nonrecursive",  "Processing folder (non-recursive): {0}", stringArgs[0]);
            break;
        case 35:
            message = "  " + localize("processing.folder.recursive",  "Processing folder (recursive): {0}", stringArgs[0]);
            break;
        case 36:
            message = localize("file.exclude",  "File exclude: {0}", stringArgs[0]);
            break;
        case 37:
            message = localize("search.exclude",  "Search exclude: {0}", stringArgs[0]);
            break;
        case 38:
            message = "  " + localize("discovery.files.processed", "Discovering files: {0} file(s) processed", stringArgs[0]);
            break;
        case 39:
            message = "  " + localize("files.removed.from.database",  "{0} file(s) removed from database", stringArgs[0]);
            break;
        case 40:
            message = "  " + localize("parsing.files.processed",  "Parsing: {0} files(s) processed", stringArgs[0]);
            break;
        case 41:
            message = localize("shutting.down.intellisense",  "Shutting down IntelliSense server: {0}", stringArgs[0]);
            break;
        case 42:
            message = localize("resetting.intellisense",  "Resetting IntelliSense server: {0}", stringArgs[0]);
            break;
        case 43:
            message =  localize("code.browsing.initialized", "Code browsing service initialized");
            break;
        case 44:
            message = "  " + localize("folder.will.be.indexed", "Folder: {0} will be indexed", stringArgs[0]);
            break;
        case 45:
            message = localize("populate.include.completion.cache", "Populate include completion cache.");
            break;
        case 46:
            message = localize("discovering.files", "Discovering files...");
            break;
        case 47:
            message = localize("done.discovering.files", "Done discovering files.");
            break;
        case 48:
            message = localize("parsing.open.files.elipsis", "Parsing open files...");
            break;
        case 49:
            message = localize("done.parsing.open.files", "Done parsing open files.");
            break;
        case 50:
            message = localize("parsing.remaining.files", "Parsing remaining files...");
            break;
        case 51:
            message = localize("done.parsing.remaining.files", "Done parsing remaining files.");
            break;
        case 52:
            message = localize("using.configuration", 'Using configuration: "{0}"', stringArgs[0]);
            break;
        case 53:
            message = localize("include.path.suggestions.discovered", "{0} include path suggestion(s) discovered.", stringArgs[0]);
            break;
        case 54:
            message = localize("checking.for.syntax.errors", "Checking for syntax errors: {0}", stringArgs[0]);
            break;
        case 55:
            message = localize("intellisense.engine.is", "IntelliSense Engine = {0}.", stringArgs[0]);
            break;
        case 56:
            message = localize("will.use.tag.parser.when.includes.dont.resolve", "The extension will use the Tag Parser for IntelliSense when #includes don't resolve.");
            break;
        case 57:
            message = localize("autocomplete.is.enabled", "Autocomplete is enabled.");
            break;
        case 58:
            message = localize("autocomplete.is.disabled", "Autocomplete is disabled.");
            break;
        case 59:
            message = localize("enhanced.colorization.is.enabled", "Enhanced Colorization is enabled.");
            break;
        case 60:
            message = localize("error.squiggles.disabled", "Error squiggles are disabled.");
            break;
        case 61:
            message = localize("error.squiggles.enabled", "Error squiggles are enabled.");
            break;
        case 62:
            message = localize("error.squiggles.enabled.if.all.headers.resolve", "Error squiggles are enabled if all header dependencies are resolved.");
            break;
        case 63:
            message = localize("replaced.placeholder.file.record", "Replaced placeholder file record");
            break;
        case 64:
            message = "  " + localize("tag.parsing.file", "tag parsing file: {0}", stringArgs[0]);
            break;
        case 65:
            message = localize("tag.parsing.error", "Tag parsing encountered a error, but it may not matter. Let us know if symbols in the file can't be found: {0}", stringArgs[0]);
            break;
        case 66:
            message = localize("reset.timestamp.for", "Reset time stamp for {0}", stringArgs[0]);
            break;
        case 67:
            message = localize("remove.file.failed", "Failed to remove file: {0}", stringArgs[0]);
            break;
        case 68:
            message = localize("regex.parse.error", "Regex parse error - vscode pattern: {0}, regex: {1}, error message: {2}", stringArgs[0], stringArgs[1], stringArgs[2]);
            break;
        case 69:
            message = localize("terminating.child.process", "terminating child process: {0}", stringArgs[0]);
            break;
        case 70:
            message = localize("still.alive.killing", "still alive, killing...");
            break;
        case 71:
            message = localize("giving.up", "giving up");
            break;
        case 72:
            message = localize("not.exited.yet", "not exited yet. Will sleep for {0} seconds and try again", stringArgs[0]);
            break;
        case 73:
            message = localize("failed.to.spawn.process", "Failed to spawn process. Error: {0} ({1})", stringArgs[0], stringArgs[1]);
            break;
        case 74:
            message = localize("offering.completion", "Offering completion");
            break;
        case 75:
            message = localize("compiler.from.compiler.path", "Attempting to get defaults from compiler in \"compilerPath\" property: '{0}'", stringArgs[0]);
            break;
        case 76:
            message = localize("compiler.from.compile_commands", "Attempting to get defaults from compiler in compile_commands.json file: '{0}'", stringArgs[0]);
            break;
        case 77:
            message = localize("compiler.on.machine", "Attempting to get defaults from compiler found on the machine: '{0}'", stringArgs[0]);
            break;
        case 78:
            message = localize("unable.to.resolve.include.path", "Unable to resolve include path: {0}", stringArgs[0]);
            break;
        case 79:
            message = localize("error.searching.for.intellise.client", "Error searching for IntelliSense client: {0}", stringArgs[0]);
            break;
        case 80:
            message = localize("intellisense.client.not.available.quick.info", "IntelliSense client not available, using Tag Parser for quick info.");
            break;
        case 81:
            message = localize("tag.parser.quick.info", "using Tag Parser for quick info");
            break;
        case 82:
            message = localize("closing.communication.channel", "Closing the communication channel.");
            break;
        case 83:
            message = localize("sending.compilation.args", "sending compilation args for {0}", stringArgs[0]);
            break;
        case 84:
            message = "  " + localize("include.label", "include: {0}", stringArgs[0]);
            break;
        case 85:
            message = "  " + localize("framework.label", "framework: {0}", stringArgs[0]);
            break;
        case 86:
            message = "  " + localize("define.label", "define: {0}", stringArgs[0]);
            break;
        case 87:
            message = "  " + localize("preinclude.label", "preinclude: {0}", stringArgs[0]);
            break;
        case 88:
            message = "  " + localize("other.label", "other: {0}", stringArgs[0]);
            break;
        case 89:
            message = localize("sending.count.changes.to.server", "sending {0} changes to server", stringArgs[0]);
            break;
        case 90:
            message = localize("invalid.open.file.instance", "Invalid opened file instance. Ignoring IntelliSense message for file {0}.", stringArgs[0]);
            break;
        case 91:
            message = localize("idle.loop.reparing.active.document", "idle loop: reparsing the active document");
            break;
        case 92:
            message = localize("intellisense.client.currently.disconnected", "IntelliSense client is currently disconnected");
            break;
        case 93:
            message = localize("request.cancelled", "Request canceled: {0}", stringArgs[0]);
            break;
        case 94:
            message = localize("error.searching.for.intellisense.client", "Error searching for IntelliSense client: {0}", stringArgs[0]);
            break;
        case 95:
            message = localize("intellisense.client.not.available.go.to.definition", "IntelliSense client not available, using Tag Parser for go to definition.");
            break;
        case 96:
            message = "  " + localize("wsl.compiler.detected", "WSL compiler detected");
            break;
        case 97:
            message = localize("error.squiggle.count", "Error squiggle count: {0}", stringArgs[0]);
            break;
        case 98:
            message = localize("queueing.update.intellisense", "Queueing IntelliSense update for files in translation unit of: {0}", stringArgs[0]);
            break;
        case 99:
            message = localize("formatting.document", "Formatting document: {0}", stringArgs[0]);
            break;
        case 100:
            message = localize("formatting.input.label", "Formatting input:");
            break;
        case 101:
            message = localize("formatting.raw.output.label", "Formatting raw output:");
            break;
        case 102:
            message = localize("formatting.diff.before.cursor", "Formatting diffed output before cursor:");
            break;
        case 103:
            message = localize("formatting.diff.after.cursor", "Formatting diffed output after cursor:");
            break;
        case 104:
            message = localize("formatting.diff", "Formatting diffed output:");
            break;
        case 105:
            message = localize("update.browse.path", 'Edit "browse.path" setting');
            break;
        case 106:
            message = localize("add.to.includepath", 'Add to "includePath": {0}', stringArgs[0]);
            break;
        case 107:
            message = localize("edit.includepath", 'Edit "includePath" setting');
            break;
        case 108:
            message = localize("enable.error.squiggles", "Enable all error squiggles");
            break;
        case 109:
            message = localize("disable.error.squiggles", "Disable error squiggles");
            break;
        case 110:
            message = localize("disable.inactive.regions", "Disable inactive region colorization");
            break;
        case 111:
            message = localize("searching.include.path", "Searching include path...");
            break;
        case 112:
            message = localize("include.not.found.in.browse.path", "Include file not found in browse.path.");
            break;
        case 113:
            message = localize("error.limit.exceeded", "Error limit exceeded, {0} error(s) not reported.", stringArgs[0]);
            break;
        case 114:
            message = localize("include.errors.detected1", "#include errors detected. Consider updating your compile_commands.json or includePath. IntelliSense features for this translation unit ({0}) will be provided by the Tag Parser.", stringArgs[0]);
            break;
        case 115:
            message = localize("include.errors.detected2", "#include errors detected. Consider updating your compile_commands.json or includePath. Squiggles are disabled for this translation unit ({0}).", stringArgs[0]);
            break;
        case 116:
            message = localize("include.errors.detected3", "#include errors detected. Please update your includePath. IntelliSense features for this translation unit ({0}) will be provided by the Tag Parser.", stringArgs[0]);
            break;
        case 117:
            message = localize("include.errors.detected4", "#include errors detected. Please update your includePath. Squiggles are disabled for this translation unit ({0}).", stringArgs[0]);
            break;
        case 118:
            message = localize("could.not.parse.compile.commands", "\"{0}\" could not be parsed. 'includePath' from c_cpp_properties.json will be used instead.", stringArgs[0]);
            break;
        case 119:
            message = localize("could.not.find.compile.commands", "\"{0}\" could not be found. 'includePath' from c_cpp_properties.json will be used instead.", stringArgs[0]);
            break;
        case 120:
            message = localize("file.not.found.in.path", "\"{0}\" not found in \"{1}\". 'includePath' from c_cpp_properties.json will be used for this file instead.", stringArgs[0], stringArgs[1]);
            break;
        case 121:
            message = localize("cannot.reset.database", "The IntelliSense database could not be reset. To manually reset, close all VS Code instances and then delete this file: {0}", stringArgs[0]);
            break;
        case 122:
            message = localize("database.reset", "The IntelliSense database was successfully reset.");
            break;
         case 123:
            message = "(" + localize("global.scope", "Global Scope") + ")";
            break;
        case 124:
            message = localize("formatting.failed.see.output", "Formatting failed. See the output window for details.");
            break;
        case 125:
            message = localize("populating.include.completion.cache", "Populating include completion cache.");
            break;
        case 126:
            message = localize("discovering.files.count", "Discovering files: {0}", stringArgs[0]);
            break;
        case 127:
            message = localize("parsing.open.files", "Parsing open files");
            break;
        case 128:
            message = localize("tag.parser.initializing", "Tag parser initializing");
            break;
        case 129:
            message = localize("parsing.paused", "Parsing paused");
            break;
        case 130:
            message = localize("parsing.files", "Parsing files: {0}", stringArgs[0]);
            break;
        case 131:
            message = localize("discovering.files.count.progress", "Discovering files: {0} / {1} ({2}%)", stringArgs[0], stringArgs[1], stringArgs[2]);
            break;
        case 132:
            message = localize("parsing.files.progress", "Parsing files: {0} / {1} ({2}%)", stringArgs[0], stringArgs[1], stringArgs[2]);
            break;
        default:
            console.assert("Unrecognized stringId");
            break;
    }
    return message;
}
