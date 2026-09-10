const assert = require('node:assert/strict');
const path = require('node:path');
const yauzl = require('yauzl');
const expected = require('./package.json');

async function verify(file) {
    const contents = await new Promise((resolve, reject) => {
        const entries = new Map();
        yauzl.open(file, { lazyEntries: true }, (error, zip) => {
            if (error) { reject(error); return; }
            zip.on('error', reject);
            zip.on('end', () => resolve(entries));
            zip.on('entry', entry => {
                if (!['extension/package.json', 'extension/dist/hornet.js', 'extension/assets/callGraph/graph.js', 'extension/assets/callGraph/layout.js'].includes(entry.fileName)) { zip.readEntry(); return; }
                zip.openReadStream(entry, (err, stream) => {
                    if (err) { zip.close(); reject(err); return; }
                    const chunks = [];
                    stream.on('error', reason => { zip.close(); reject(reason); });
                    stream.on('data', chunk => chunks.push(chunk));
                    stream.on('end', () => { entries.set(entry.fileName, Buffer.concat(chunks).toString('utf8')); zip.readEntry(); });
                });
            });
            zip.readEntry();
        });
    });
    const manifest = JSON.parse(contents.get('extension/package.json'));
    assert.equal(manifest.version, expected.version);
    const graph = manifest.contributes.commands.find(command => command.command === 'hornet-cpp.showCallGraph');
    assert.equal(graph.title, 'Hornet Show Graph');
    assert.equal(graph.shortTitle ?? graph.title, 'Hornet Show Graph');
    assert.ok(manifest.contributes.commands.some(command => command.command === 'hornet-cpp.autoSetupClangd'));
    assert.ok(manifest.contributes.commands.some(command => command.command === 'hornet-cpp.buildProjectIndex' && command.title === 'Hornet Build Index'));
    assert.ok(manifest.activationEvents.includes('workspaceContains:**/*.{c,cc,cpp,cxx,h,hh,hpp,hxx,cu,cuh}'));
    assert.ok(manifest.contributes.viewsContainers.panel.some(panel => panel.id === 'hornet-cpp-graph'));
    assert.ok(manifest.contributes.views['hornet-cpp-graph'].some(view => view.id === 'hornet-cpp.graphView' && view.type === 'webview'));
    const bundle = contents.get('extension/dist/hornet.js');
    assert.ok(bundle.includes('installClangd') && bundle.includes('clangdInstallRoots'));
    assert.ok(!bundle.includes('Duplicate completions or diagnostics may appear.'));
    assert.ok(contents.get('extension/assets/callGraph/graph.js').includes("state.action === 'none'"));
    assert.ok(contents.get('extension/assets/callGraph/layout.js').includes('layoutGraph'));
    assert.ok(bundle.includes('layout.js'));
    assert.ok(bundle.includes('registerWebviewViewProvider'));
    assert.ok(!bundle.includes('createWebviewPanel('));
    assert.ok(bundle.includes('expandChains') && bundle.includes('prepareCompilerConfiguration'));
    assert.ok(bundle.includes('buildProjectIndex') && bundle.includes('Indexing') && bundle.includes('Index ready'));
    console.log(`Verified ${path.basename(file)}: ${manifest.version}, Hornet Show Graph, automatic clangd setup, no coexistence popup, hidden empty branches.`);
}
if (require.main === module) {
    Promise.all(process.argv.slice(2).map(verify)).catch(error => { console.error(error); process.exitCode = 1; });
}
module.exports = { verify };
