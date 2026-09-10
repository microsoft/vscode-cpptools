// Optional capture/assertions for an isolated VS Code launched with --remote-debugging-port=9337.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { chromium } = require(process.env.HORNET_PLAYWRIGHT_MODULE || 'playwright-core');
const root = path.resolve(process.argv[2]);
(async () => {
    const deadline = Date.now() + 45000;
    let browser;
    while (!browser) {
        try { browser = await chromium.connectOverCDP('http://127.0.0.1:9337'); }
        catch { if (Date.now() > deadline) throw new Error('VS Code debugging endpoint unavailable'); await new Promise(resolve => setTimeout(resolve, 200)); }
    }
    const statuses = new Set();
    while (!await fs.access(path.join(root, 'panel-ready.json')).then(() => true, () => false)) {
        if (Date.now() > deadline) throw new Error('VS Code did not reach the graph capture step');
        const workbench = browser.contexts().flatMap(context => context.pages()).find(page => page.url().includes('workbench'));
        if (workbench) for (const text of await workbench.locator('.statusbar-item').filter({ hasText: 'Hornet' }).allInnerTexts()) statuses.add(text);
        await new Promise(resolve => setTimeout(resolve, 200));
    }
    try {
        const page = browser.contexts().flatMap(context => context.pages()).find(page => page.url().includes('workbench'));
        assert.ok(page, 'VS Code workbench is available');
        const panel = page.locator('.part.panel');
        await page.screenshot({ path: path.join(root, '../vscode-panel-before.png') });
        await panel.waitFor({ state: 'visible', timeout: 10000 });
        assert.ok(await panel.isVisible());
        assert.match(await panel.innerText(), /Hornet Graph/i);
        // Webview rendering and interactions are covered by callGraph.browser.cjs.
        // This capture checks the actual workbench placement and supports visual inspection.
        const bounds = await panel.boundingBox();
        const editor = await page.locator('.part.editor').boundingBox();
        assert.ok(bounds.y >= editor.y + editor.height - 2, 'graph panel is below the source editor');
        await page.screenshot({ path: path.join(root, '../vscode-bottom-panel.png') });
        const mode = page.locator('.statusbar-item').filter({ hasText: /Hornet: (Hybrid|Compiler)/ });
        assert.equal(await mode.count(), 1, 'mode has its own persistent status item');
        assert.equal(await page.locator('.statusbar-item').filter({ hasText: 'Hornet: Index ready' }).count(), 1);
        assert.ok([...statuses].some(text => /Discovering|Starting index|Parsing source|Finalizing|Indexing/.test(text)), 'intermediate indexing stages are visible');
        await fs.writeFile(path.join(root, '../index-status-history.json'), JSON.stringify([...statuses], null, 2));
        await mode.click();
        const picker = page.locator('.quick-input-widget');
        await picker.waitFor({ state: 'visible' });
        for (const name of ['Compiler', 'Hybrid', 'Tag', 'Flyweight']) assert.ok((await picker.innerText()).includes(name));
        await page.screenshot({ path: path.join(root, '../vscode-mode-picker.png') });
        await page.keyboard.press('Escape');
        console.log('PASS: actual VS Code bottom panel, separate mode/index statuses, intermediate progress and mode picker.');
    } finally {
        await fs.writeFile(path.join(root, 'panel-captured.json'), '{}');
        await browser.close();
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
