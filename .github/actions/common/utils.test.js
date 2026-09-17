/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const ts = require('typescript');

const configPath = path.join(__dirname, '..', 'tsconfig.json');
const config = ts.readConfigFile(configPath, ts.sys.readFile);
assert.equal(config.error, undefined);
const project = ts.parseJsonConfigFileContent(config.config, ts.sys, path.dirname(configPath));
assert.deepEqual(project.errors, []);
const compiled = ts.transpileModule(readFileSync(path.join(__dirname, 'utils.ts'), 'utf8'), {
    fileName: 'utils.ts',
    compilerOptions: project.options,
    reportDiagnostics: true,
});
assert.deepEqual(compiled.diagnostics, []);
const committed = readFileSync(path.join(__dirname, 'utils.js'), 'utf8');

function printJavaScript(source) {
    const tree = ts.createSourceFile('utils.js', source, ts.ScriptTarget.ES2019, true, ts.ScriptKind.JS);
    assert.deepEqual(tree.parseDiagnostics, []);
    return ts.createPrinter({ removeComments: true }).printFile(tree);
}

test('committed utils.js matches the TypeScript output', () => {
    assert.equal(printJavaScript(committed), printJavaScript(compiled.outputText));
});

function loadUtils(source, errorLogIssueNumber = '99') {
    const context = {
        repo: { owner: 'example', repo: 'triage' },
        workflow: 'Helper tests',
        issue: { number: 7 },
        payload: { action: 'labeled' },
    };
    const requests = [];
    const comments = [];
    const delays = [];
    const logs = [];
    const modules = {
        '@actions/core': {
            getInput: (name) => name === 'errorLogIssueNumber' ? errorLogIssueNumber : '',
        },
        '@actions/github': { context },
        axios: {},
        '../api/octokit': {
            OctoKitIssue: class {
                constructor(token, repo, issue) {
                    requests.push(JSON.parse(JSON.stringify({ token, repo, issue })));
                }
                async postComment(body) {
                    comments.push(body);
                }
            },
        },
    };
    const exports = {};
    new vm.Script(source, { filename: 'utils.js' }).runInNewContext({
        exports,
        require: (name) => {
            assert.ok(Object.hasOwn(modules, name), `Unexpected dependency: ${name}`);
            return modules[name];
        },
        console: {
            log: (...args) => logs.push(args),
            error: (error) => assert.fail(`Unexpected error: ${error}`),
        },
        setTimeout: (callback, delay) => {
            delays.push(delay);
            callback();
        },
    }, { timeout: 1000 });
    return { utils: exports, context, requests, comments, delays, logs };
}

for (const [name, source] of [
    ['committed JavaScript', committed],
    ['TypeScript output', compiled.outputText],
]) {
    test(`${name}: normalizes ordinary issue text`, () => {
        const { utils } = loadUtils(source);
        const result = utils.normalizeIssue({ body: 'Ordinary body', title: 'Useful title' });
        assert.equal(result.body, 'ordinary body');
        assert.equal(result.title, 'useful title');
        assert.equal(result.issueType, 'unknown');
    });

    test(`${name}: preserves text between separate comments`, () => {
        const { utils } = loadUtils(source);
        const result = utils.normalizeIssue({
            body: 'Start <!-- first note --> keep <!-- second note --> end',
            title: 'A <!-- note --> title',
        });
        assert.equal(result.body, 'start  keep  end');
        assert.equal(result.title, 'a  title');
    });

    test(`${name}: removes ordinary multiline comments`, () => {
        const { utils } = loadUtils(source);
        const result = utils.normalizeIssue({
            body: 'Start <!-- first line\nsecond line --> end',
            title: 'Title',
        });
        assert.equal(result.body, 'start  end');
        assert.equal(result.title, 'title');
    });

    test(`${name}: preserves issue classification`, () => {
        const { utils } = loadUtils(source);
        for (const [body, issueType] of [
            ['Issue Type: Bug', 'bug'],
            ['Issue Type: Feature Request', 'feature_request'],
            ['Ordinary issue', 'unknown'],
        ]) {
            assert.equal(utils.normalizeIssue({ body, title: 'Title' }).issueType, issueType);
        }
    });

    test(`${name}: reports an ordinary error through the stubbed client`, async () => {
        for (const ping of [false, true]) {
            const runtime = loadUtils(source);
            await runtime.utils.logErrorToIssue('Routine test failure', ping, '');
            assert.deepEqual(runtime.requests, [{
                token: '',
                repo: { owner: 'example', repo: 'triage' },
                issue: { number: 99 },
            }]);
            assert.deepEqual(runtime.delays, [10000]);
            assert.equal(runtime.comments.length, 1);
            const comment = runtime.comments[0];
            assert.ok(comment.includes('Workflow: Helper tests'));
            assert.ok(comment.includes('Error: Routine test failure'));
            assert.ok(comment.includes(`Issue: ${ping ? 'example/triage#' : ''}7`));
            assert.ok(comment.includes('Repo: example/triage'));
            assert.ok(comment.includes(JSON.stringify(runtime.context, null, 2)));
        }
    });

    test(`${name}: skips reporting when no destination is configured`, async () => {
        const runtime = loadUtils(source, '');
        await runtime.utils.logErrorToIssue('Routine test failure', false, '');
        assert.deepEqual(runtime.requests, []);
        assert.deepEqual(runtime.comments, []);
        assert.deepEqual(runtime.logs, [['no error logging repo defined. swallowing error.']]);
    });
}
