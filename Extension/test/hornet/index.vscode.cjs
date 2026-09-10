// Run in an isolated VS Code extension host with an unopened C/C++ fixture folder.
const vscode = require('vscode');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');

exports.run = async () => {
    const root = vscode.workspace.workspaceFolders[0].uri.fsPath;
    const result = path.join(root, 'index-host-result.json');
    const waitFor = async (check, label) => {
        const deadline = Date.now() + 30000;
        while (Date.now() < deadline) {
            if (await check()) { return; }
            await new Promise(resolve => setTimeout(resolve, 200));
        }
        throw new Error(`Timed out: ${label}`);
    };
    try {
        assert.equal(vscode.workspace.textDocuments.filter(doc => ['c', 'cpp'].includes(doc.languageId)).length, 0);
        const extension = vscode.extensions.getExtension('hornet.hornet-cpp');
        assert.ok(extension);
        // Do not activate explicitly: workspaceContains must activate the extension on folder open.
        await waitFor(() => extension.isActive, 'automatic activation');
        await waitFor(async () => (await fs.readdir(root, { recursive: true })).some(file => file.endsWith('.idx')), 'automatic persistent index');
        await fs.writeFile(path.join(root, 'new.cpp'), 'int addedThroughManualBuild() { return 3; }\n');
        // The command must wait for completion, even if discovery is also handling the file event.
        await vscode.commands.executeCommand('hornet-cpp.buildProjectIndex', vscode.Uri.file(root));
        const files = await fs.readdir(root, { recursive: true });
        assert.ok(files.some(file => file.includes('new.cpp') && file.endsWith('.idx')), files.join('\n'));
        const symbols = await vscode.commands.executeCommand('vscode.executeWorkspaceSymbolProvider', 'addedThroughManualBuild');
        assert.ok(symbols.some(symbol => symbol.name.startsWith('addedThroughManualBuild')), JSON.stringify(symbols));
        // Consume any deferred discovery restart from the deliberate new-file event before opening a graph.
        await extension.exports.getApi(1).refreshIndex();
        const editor = await vscode.window.showTextDocument(vscode.Uri.file(path.join(root, 'a.cpp')));
        editor.selection = new vscode.Selection(0, 5, 0, 5);
        const tabs = () => vscode.window.tabGroups.all.flatMap(group => group.tabs);
        const originalTabs = tabs().length, originalGroups = vscode.window.tabGroups.all.length;
        await vscode.commands.executeCommand('hornet-cpp.showCallGraph');
        await vscode.commands.executeCommand('hornet-cpp.graphView.focus');
        assert.equal(tabs().length, originalTabs, 'show graph does not create an editor tab');
        assert.equal(vscode.window.tabGroups.all.length, originalGroups, 'show graph does not split the editor');
        assert.ok(!tabs().some(tab => tab.input instanceof vscode.TabInputWebview));
        await vscode.commands.executeCommand('workbench.action.closePanel');
        await vscode.commands.executeCommand('hornet-cpp.graphView.focus');
        assert.equal(tabs().length, originalTabs, 'reopening the bottom panel keeps the editor layout');
        if (process.env.HORNET_PANEL_CAPTURE) {
            await vscode.commands.executeCommand('notifications.clearAll');
            await fs.writeFile(path.join(root, 'panel-ready.json'), '{}');
            await waitFor(async () => fs.access(path.join(root, 'panel-captured.json')).then(() => true, () => false), 'panel screenshot');
        }
        await fs.writeFile(result, JSON.stringify({ passed: true, version: extension.packageJSON.version, shards: files.filter(file => file.endsWith('.idx')) }, null, 2));
    } catch (error) {
        await fs.writeFile(result, JSON.stringify({ passed: false, error: error.stack }, null, 2));
        throw error;
    }
};
