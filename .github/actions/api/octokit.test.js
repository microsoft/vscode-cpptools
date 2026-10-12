/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const ts = require('typescript');

const params = { owner: 'microsoft', repo: 'vscode-cpptools' };
const timestamp = '2026-01-02T03:04:05Z';
const commitUrl = 'https://api.github.com/repos/microsoft/vscode-cpptools/commits/abcdef0';
const source = fs.readFileSync(path.join(__dirname, 'octokit.js'), 'utf8');

function issue(overrides = {}) {
	return {
		number: 1,
		user: { login: 'author', type: 'User' },
		body: 'Issue body',
		title: 'Issue title',
		labels: ['bug', { name: 'triage' }, {}],
		state: 'closed',
		state_reason: 'duplicate',
		locked: false,
		comments: 2,
		reactions: { '+1': 1, '-1': 0, laugh: 0, hooray: 0, confused: 0, heart: 0, rocket: 0, eyes: 0 },
		assignee: null,
		assignees: [{ login: 'first' }, { login: 'second' }],
		milestone: null,
		created_at: timestamp,
		updated_at: timestamp,
		closed_at: timestamp,
		...overrides,
	};
}

function adapter({ issues = { 1: issue() }, timelines = {}, search = [] } = {}) {
	const requests = [];
	const timelineEndpoint = () => assert.fail('Timeline endpoint must be paginated');
	const searchEndpoint = () => assert.fail('Search endpoint must be paginated');
	const client = {
		rest: {
			issues: {
				get: async ({ owner, repo, issue_number }) => {
					assert.deepEqual({ owner, repo }, params);
					requests.push(['get', issue_number]);
					assert.ok(issues[issue_number], `Unexpected issue read: ${issue_number}`);
					return { data: issues[issue_number] };
				},
				listEventsForTimeline: timelineEndpoint,
			},
			search: { issuesAndPullRequests: searchEndpoint },
		},
		paginate: {
			async *iterator(endpoint, options) {
				assert.ok(endpoint === timelineEndpoint || endpoint === searchEndpoint);
				const pages = endpoint === timelineEndpoint ? timelines[options.issue_number] ?? [] : search;
				if (endpoint === timelineEndpoint) {
					assert.deepEqual({ owner: options.owner, repo: options.repo }, params);
				} else {
					assert.equal(options.q, 'is:issue repo:microsoft/vscode-cpptools');
					assert.equal(options.per_page, 100);
				}
				for (let page = 0; page < pages.length; page++) {
					requests.push([endpoint === timelineEndpoint ? 'timeline' : 'search', options.issue_number, page]);
					yield { data: pages[page] };
				}
			},
		},
	};
	const exports = {};
	const dependencies = {
		'@actions/github': { getOctokit: () => client },
		'../common/utils': { safeLog: () => { } },
		child_process: { exec: () => assert.fail('Unexpected subprocess') },
	};
	vm.runInThisContext(`(function(require, exports, setTimeout) {\n${source}\n})`, {
		filename: path.join(__dirname, 'octokit.js'),
	})(
		(name) => {
			assert.ok(Object.hasOwn(dependencies, name), `Unexpected dependency: ${name}`);
			return dependencies[name];
		},
		exports,
		() => assert.fail('Unexpected timer'),
	);
	return {
		repo: new exports.OctoKit('offline-test-token', params, { readonly: true }),
		getIssue: (number = 1) => new exports.OctoKitIssue('offline-test-token', params, { number }, { readonly: true }),
		requests,
	};
}

function closed(event = 'closed', overrides = {}) {
	return { event, created_at: timestamp, commit_id: 'abcdef0', commit_url: commitUrl, ...overrides };
}

function reference(number) {
	return {
		event: 'cross-referenced',
		source: { issue: { number, pull_request: { url: `https://api.github.com/repos/microsoft/vscode-cpptools/pulls/${number}` } } },
	};
}

test('checked-in adapter JavaScript matches the locked TypeScript compiler', () => {
	const fileName = path.join(__dirname, 'octokit.ts');
	const configPath = path.join(__dirname, '../tsconfig.json');
	const config = ts.readConfigFile(configPath, ts.sys.readFile);
	assert.equal(config.error, undefined);
	const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, path.dirname(configPath));
	assert.deepEqual(parsed.errors, []);
	const generated = ts.transpileModule(fs.readFileSync(fileName, 'utf8'), {
		fileName,
		compilerOptions: parsed.options,
	}).outputText;
	const printer = ts.createPrinter({ removeComments: true, newLine: ts.NewLineKind.LineFeed });
	const normalize = (text) => printer.printFile(ts.createSourceFile('octokit.js', text, ts.ScriptTarget.ES2019, true, ts.ScriptKind.JS));
	assert.equal(normalize(source), normalize(generated));
});

test('getIssue normalizes the current issue response, including duplicate state reasons', async () => {
	const data = issue();
	const result = await adapter({ issues: { 1: data } }).getIssue().getIssue();
	assert.deepEqual(result, {
		author: { name: 'author', isGitHubApp: false },
		body: 'Issue body',
		number: 1,
		title: 'Issue title',
		isPr: false,
		labels: ['bug', 'triage', ''],
		open: false,
		locked: false,
		numComments: 2,
		reactions: data.reactions,
		assignee: 'first',
		assignees: ['first', 'second'],
		milestone: null,
		createdAt: Date.parse(timestamp),
		updatedAt: Date.parse(timestamp),
		closedAt: Date.parse(timestamp),
	});
});

test('getIssue preserves nullable fields and milestone date normalization', async () => {
	const data = issue({
		user: null, body: null, assignees: null, assignee: { login: 'assigned' }, closed_at: null,
		state: 'open', pull_request: { html_url: 'https://github.com/microsoft/vscode-cpptools/pull/1' },
		milestone: {
			number: 7, title: 'Milestone', created_at: timestamp, due_on: timestamp, closed_at: null,
			description: null, closed_issues: 2, open_issues: 3, state: 'open',
		},
	});
	const result = await adapter({ issues: { 1: data } }).getIssue().getIssue();
	assert.deepEqual(result.author, { name: 'unkown', isGitHubApp: false });
	assert.equal(result.body, '');
	assert.equal(result.assignee, 'assigned');
	assert.deepEqual(result.assignees, []);
	assert.equal(result.closedAt, undefined);
	assert.equal(result.open, true);
	assert.equal(result.isPr, true);
	assert.deepEqual(result.milestone, {
		title: 'Milestone', milestoneId: 7, createdAt: new Date('2026-01-02'), dueOn: new Date('2026-01-02'),
		closedAt: null, description: '', numClosedIssues: 2, numOpenIssues: 3, state: 'open',
	});
});

test('query accepts search responses with broader state reasons', async () => {
	const data = issue({ state_reason: 'search-specific-reason' });
	const fixture = adapter({ search: [[data]] });
	const pages = [];
	for await (const page of fixture.repo.query({ q: 'is:issue' })) pages.push(page);
	assert.equal(pages.length, 1);
	assert.equal(pages[0].length, 1);
	assert.equal((await pages[0][0].getIssue()).number, 1);
	assert.equal(fixture.requests[0][0], 'search');
});

test('getAssigner keeps the last matching actor in the first matching page', async () => {
	const assigned = (login, actor, event = 'assigned') => ({ event, assignee: { login }, actor: { login: actor } });
	const fixture = adapter({
		timelines: {
			1: [
				[{ event: 'committed', sha: 'abcdef0' }, assigned('other', 'ignored'), assigned('target', 'ignored', 'unassigned')],
				[assigned('target', 'first'), assigned('target', 'last')],
				[assigned('target', 'unvisited')],
			]
		}
	});
	assert.equal(await fixture.getIssue().getAssigner('target'), 'last');
	assert.deepEqual(fixture.requests, [['timeline', 1, 0], ['timeline', 1, 1]]);
});

test('getAssigner rejects timelines without a matching actor', async () => {
	const fixture = adapter({
		timelines: {
			1: [[
				{ event: 'assigned' }, { event: 'assigned', assignee: { login: 'target' }, actor: null },
				{ event: 'reviewed', body: 'review' },
			]]
		}
	});
	await assert.rejects(fixture.getIssue().getAssigner('target'), /Expected to find target in issue timeline/);
});

for (const event of ['closed', 'merged']) {
	test(`getClosingInfo accepts ${event} commits from the same repository`, async () => {
		const fixture = adapter({ timelines: { 1: [[closed(event, { commit_url: commitUrl.toUpperCase() })]] } });
		assert.deepEqual(await fixture.getIssue().getClosingInfo(), { hash: 'abcdef0', timestamp: Date.parse(timestamp) });
	});
}

test('getClosingInfo ignores unrelated, incomplete and foreign-repository events', async () => {
	const fixture = adapter({
		timelines: {
			1: [[
				{ event: 'committed', sha: 'abcdef0' }, { event: 'closed', created_at: timestamp, commit_id: 'abcdef0' },
				closed('closed', { created_at: '' }), closed('closed', { commit_id: null }), closed('closed', { commit_url: null }),
				closed('closed', { commit_url: commitUrl.replace('/vscode-cpptools/', '/other/') }), closed('labeled'),
			]]
		}
	});
	assert.equal(await fixture.getIssue().getClosingInfo(), undefined);
});

test('reopening clears earlier closing information across pages', async () => {
	const fixture = adapter({ timelines: { 1: [[closed()], [{ event: 'reopened' }]] } });
	assert.equal(await fixture.getIssue().getClosingInfo(), undefined);
});

test('a later close replaces earlier closing information', async () => {
	const fixture = adapter({ timelines: { 1: [[closed(), { event: 'reopened' }], [closed('merged', { commit_id: '1234567' })]] } });
	assert.deepEqual(await fixture.getIssue().getClosingInfo(), { hash: '1234567', timestamp: Date.parse(timestamp) });
});

for (const body of ['/closedWith abcdef0', '\\closedWith abcdef0', '/closedWith https://github.com/microsoft/vscode/commit/abcdef0']) {
	test(`getClosingInfo honors ${body}`, async () => {
		const fixture = adapter({ timelines: { 1: [[{ event: 'commented', created_at: timestamp, body }]] } });
		assert.deepEqual(await fixture.getIssue().getClosingInfo(), { hash: 'abcdef0', timestamp: Date.parse(timestamp) });
	});
}

test('empty, suppressed and non-comment bodies do not overwrite closing information', async () => {
	const comments = [undefined, null, '', 'ordinary comment', 'UNABLE_TO_LOCATE_COMMIT_MESSAGE /closedWith 1234567'];
	const fixture = adapter({
		timelines: {
			1: [[
				closed(), ...comments.map((body) => ({ event: 'commented', created_at: timestamp, body })),
				{ event: 'commented', body: '/closedWith 1234567' },
				{ event: 'reviewed', created_at: timestamp, body: '/closedWith 1234567' },
			]]
		}
	});
	assert.deepEqual(await fixture.getIssue().getClosingInfo(), { hash: 'abcdef0', timestamp: Date.parse(timestamp) });
});

test('open issues and already-checked issues do not read timelines', async () => {
	const fixture = adapter({ issues: { 1: issue({ state: 'open' }) } });
	assert.equal(await fixture.getIssue().getClosingInfo([1]), undefined);
	assert.deepEqual(fixture.requests, []);
	assert.equal(await fixture.getIssue().getClosingInfo(), undefined);
	assert.deepEqual(fixture.requests, [['get', 1]]);
});

test('linked pull requests are checked newest first', async () => {
	const fixture = adapter({
		issues: { 1: issue(), 2: issue({ number: 2 }), 3: issue({ number: 3 }) },
		timelines: { 1: [[reference(2), reference(3)]], 2: [[closed()]], 3: [[closed('merged', { commit_id: '1234567' })]] },
	});
	assert.deepEqual(await fixture.getIssue().getClosingInfo(), { hash: '1234567', timestamp: Date.parse(timestamp) });
	assert.equal(fixture.requests.some(([kind, number]) => kind === 'get' && number === 2), false);
});

for (const offset of [-5000, -4999, 4999, 5000]) {
	test(`linked closing timestamps preserve the five-second boundary (${offset}ms)`, async () => {
		const linkedTime = Date.parse(timestamp) + offset;
		const fixture = adapter({
			issues: { 1: issue(), 2: issue({ number: 2 }) },
			timelines: { 1: [[reference(2)]], 2: [[closed('merged', { created_at: new Date(linkedTime).toISOString() })]] },
		});
		assert.deepEqual(await fixture.getIssue().getClosingInfo(), Math.abs(offset) < 5000 ? { hash: 'abcdef0', timestamp: linkedTime } : undefined);
	});
}

test('cyclic cross references terminate without rereading the original issue', async () => {
	const fixture = adapter({ issues: { 1: issue(), 2: issue({ number: 2 }) }, timelines: { 1: [[reference(2)]], 2: [[reference(1)]] } });
	assert.equal(await fixture.getIssue().getClosingInfo(), undefined);
	assert.deepEqual(fixture.requests.filter(([kind]) => kind === 'get'), [['get', 1], ['get', 2]]);
});
