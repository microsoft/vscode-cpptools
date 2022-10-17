/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as core from '@actions/core';
import { context, getOctokit } from '@actions/github';
import axios from 'axios';
import { OctoKitIssue } from '../api/octokit';

export const getInput = (name: string) => core.getInput(name) || undefined;
export const getRequiredInput = (name: string) => core.getInput(name, { required: true });

export const normalizeIssue = (issue: {
	body: string;
	title: string;
}): { body: string; title: string; issueType: 'bug' | 'feature_request' | 'unknown' } => {
	let { body, title } = issue;
	body = body ?? '';
	title = title ?? '';
	const isBug = body.includes('bug_report_template') || /Issue Type:.*Bug.*/.test(body);
	const isFeatureRequest =
		body.includes('feature_request_template') || /Issue Type:.*Feature Request.*/.test(body);

	const cleanse = (str: string) => {
		let out = str
			.toLowerCase()
			.replace(/<!--.*-->/gu, '')
			.replace(/.* version: .*/gu, '')
			.replace(/issue type: .*/gu, '')
			.replace(/vs ?code/gu, '')
			.replace(/we have written.*please paste./gu, '')
			.replace(/steps to reproduce:/gu, '')
			.replace(/does this issue occur when all extensions are disabled.*/gu, '')
			.replace(/!?\[[^\]]*\]\([^)]*\)/gu, '')
			.replace(/\s+/gu, ' ')
			.replace(/```[^`]*?```/gu, '');

		while (
			out.includes(`<details>`) &&
			out.includes('</details>') &&
			out.indexOf(`</details>`) > out.indexOf(`<details>`)
		) {
			out = out.slice(0, out.indexOf('<details>')) + out.slice(out.indexOf(`</details>`) + 10);
		}

		return out;
	};

	return {
		body: cleanse(body),
		title: cleanse(title),
		issueType: isBug ? 'bug' : isFeatureRequest ? 'feature_request' : 'unknown',
	};
};

export interface Release {
	productVersion: string;
	timestamp: number;
	version: string;
}

export const loadLatestRelease = async (quality: 'stable' | 'insider'): Promise<Release | undefined> =>
	(await axios.get(`https://update.code.visualstudio.com/api/update/darwin/${quality}/latest`)).data;

export const daysAgoToTimestamp = (days: number): number =>
	+new Date(Date.now() - days * 24 * 60 * 60 * 1000);

export const daysAgoToHumanReadbleDate = (days: number) =>
	new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().replace(/\.\d{3}\w$/, '');

export const getRateLimit = async (token: string) => {
	const usageData = (await getOctokit(token).rest.rateLimit.get()).data.resources;
	const usage = {} as { core: number; graphql: number; search: number };
	(['core', 'graphql', 'search'] as const).forEach(async (category) => {
		if (usageData[category]) {
			usage[category] = 1 - (usageData[category]?.remaining ?? 0) / (usageData[category]?.limit ?? 1);
		}
	});
	return usage;
};

export const errorLoggingIssue = (() => {
	try {
		const repo = context.repo.owner.toLowerCase() + '/' + context.repo.repo.toLowerCase();
		if (repo === 'microsoft/vscode' || repo === 'microsoft/vscode-remote-release') {
			return { repo: 'vscode', owner: 'Microsoft', issue: 93814 };
		} else if (/microsoft\//.test(repo)) {
			return { repo: 'vscode-internalbacklog', owner: 'Microsoft', issue: 974 };
		} else if (getInput('errorLogIssueNumber')) {
			return { ...context.repo, issue: +getRequiredInput('errorLogIssueNumber') };
		} else {
			return undefined;
		}
	} catch (e) {
		console.error(e);
		return undefined;
	}
})();

export const logErrorToIssue = async (message: string, ping: boolean, token: string): Promise<void> => {
	// Attempt to wait out abuse detection timeout if present
	await new Promise((resolve) => setTimeout(resolve, 10000));
	const dest = errorLoggingIssue;
	if (!dest) return console.log('no error logging repo defined. swallowing error.');

	return new OctoKitIssue(token, { owner: dest.owner, repo: dest.repo }, { number: dest.issue })
		.postComment(`
Workflow: ${context.workflow}

Error: ${message}

Issue: ${ping ? `${context.repo.owner}/${context.repo.repo}#` : ''}${context.issue?.number}

Repo: ${context.repo.owner}/${context.repo.repo}

<!-- Context:
${JSON.stringify(context, null, 2)
	.replace(/<!--/gu, '<@--')
	.replace(/-->/gu, '--@>')
	.replace(/\/|\\/gu, 'slash-')}
-->
`);
};

export const safeLog = (message: string, ...args: (string | number | string[])[]): void => {
	const clean = (val: any) => ('' + val).replace(/:|#/g, '');
	console.log(clean(message), ...args.map(clean));
};
