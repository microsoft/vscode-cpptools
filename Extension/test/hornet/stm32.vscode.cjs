// Optional native check: writes only Hornet's managed .vscode database in the selected project.
const vscode = require('vscode');
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
exports.run = async () => {
    const resultPath = process.env.HORNET_STM32_RESULT;
    assert.ok(resultPath);
    const root = vscode.workspace.workspaceFolders[0];
    try {
        const extension = vscode.extensions.getExtension('hornet.hornet-cpp');
        await extension.activate();
        const api = extension.exports.getApi(1);
        await api.refreshIndex(root.uri.toString());
        const managed = path.join(root.uri.fsPath, '.vscode/hornet/compile-db/compile_commands.json');
        const commands = JSON.parse(await fs.readFile(managed, 'utf8'));
        assert.ok(commands.length > 0);
        const uri = vscode.Uri.joinPath(root.uri, 'core/src/main.c');
        const command = await api.getCompileCommand(uri.fsPath);
        assert.ok(JSON.stringify(command).includes('-DSTM32F103xE'));
        const editor = await vscode.window.showTextDocument(uri);
        const lines = editor.document.getText().split('\n');
        const line = lines.findIndex(line => /^void SystemClockConfig\(/.test(line));
        const position = new vscode.Position(line, 7);
        editor.selection = new vscode.Selection(position, position);
        const items = await vscode.commands.executeCommand('vscode.prepareCallHierarchy', uri, position);
        assert.ok(items?.length, 'SystemClockConfig parses in the extension host');
        const incoming = await vscode.commands.executeCommand('vscode.provideIncomingCalls', items[0]);
        const outgoing = await vscode.commands.executeCommand('vscode.provideOutgoingCalls', items[0]);
        assert.ok(incoming.some(call => call.from.name === 'main'));
        assert.ok(outgoing.some(call => call.to.name === 'HAL_RccOscConfig'));
        assert.ok(outgoing.some(call => call.to.name === 'HAL_RccClockConfig'));
        await vscode.commands.executeCommand('hornet-cpp.showCallGraph');
        const errors = vscode.languages.getDiagnostics(uri).filter(value => value.severity === vscode.DiagnosticSeverity.Error).map(value => value.message);
        assert.deepEqual(errors, []);
        await fs.writeFile(resultPath, JSON.stringify({ passed: true, version: extension.packageJSON.version, managed,
            commands: commands.length, incoming: incoming.map(call => call.from.name), outgoing: outgoing.map(call => call.to.name), errors }, null, 2));
    } catch (error) { await fs.writeFile(resultPath, JSON.stringify({ passed: false, error: error.stack }, null, 2)); throw error; }
};
