/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { OctoKit, OctoKitIssue, getNumRequests } from '../api/octokit';
import { context, getOctokit } from '@actions/github';
import { getRequiredInput, logErrorToIssue, getRateLimit, errorLoggingIssue, safeLog } from './utils';
import { getInput, setFailed } from '@actions/core';
import { WebhookPayload } from '@actions/github/lib/interfaces';

export abstract class Action {
	abstract id: string;

	private username: Promise<string>;
	private token = getRequiredInput('token');

	constructor() {
		this.username = getOctokit(this.token)
			.rest.users.getAuthenticated()
			.then(
				(v) => v.data.name ?? 'unknown',
				() => 'unknown',
			);
	}

	public async run() {
		if (errorLoggingIssue) {
			const { repo, issue, owner } = errorLoggingIssue;
			if (
				context.repo.repo === repo &&
				context.repo.owner === owner &&
				context.payload.issue?.number === issue
			) {
				return safeLog('refusing to run on error logging issue to prevent cascading errors');
			}
		}

		try {
			const token = getRequiredInput('token');
			const readonly = !!getInput('readonly');

			const issue = context?.issue?.number;
			if (issue) {
				const octokit = new OctoKitIssue(token, context.repo, { number: issue }, { readonly });
				if (context.eventName === 'issue_comment') {
					await this.onCommented(octokit, context.payload.comment?.body, context.actor);
				} else if (
					context.eventName === 'issues' ||
					context.eventName === 'pull_request' ||
					context.eventName === 'pull_request_target'
				) {
					switch (context.payload.action) {
						case 'opened':
						case 'ready_for_review':
							await this.onOpened(octokit, context.payload);
							break;
						case 'reopened':
							await this.onReopened(octokit);
							break;
						case 'closed':
							await this.onClosed(octokit, context.payload);
							break;
						case 'labeled':
							await this.onLabeled(octokit, context.payload.label.name);
							break;
						case 'assigned':
							await this.onAssigned(octokit, context.payload.assignee.login);
							break;
						case 'unassigned':
							await this.onUnassigned(octokit, context.payload.assignee.login);
							break;
						case 'edited':
							await this.onEdited(octokit);
							break;
						case 'milestoned':
							await this.onMilestoned(octokit);
							break;
						default:
							throw Error('Unexpected action: ' + context.payload.action);
					}
				}
			} else if (context.eventName === 'create') {
				await this.onCreated(
					new OctoKit(token, context.repo, { readonly }),
					context?.payload?.ref,
					context?.payload?.sender?.login,
				);
			} else {
				await this.onTriggered(new OctoKit(token, context.repo, { readonly }));
			}
		} catch (e) {
			const err = e as Error;
			try {
				await this.error(err);
			} catch {
				safeLog(err?.stack || err?.message || String(e));
			}
		}

		const usage = await getRateLimit(this.token);
	}

	private async error(error: Error) {
		const details: any = {
			message: `${error.message}\n${error.stack}`,
			id: this.id,
			user: await this.username,
		};

		if (context.issue?.number) details.issue = context.issue.number;

		const rendered = `
Message: ${details.message}

Actor: ${details.user}

ID: ${details.id}
`;
		await logErrorToIssue(rendered, true, this.token);

		setFailed(error.message);
	}

	protected async onTriggered(_octokit: OctoKit): Promise<void> {
		throw Error('not implemented');
	}
	protected async onCreated(_octokit: OctoKit, _ref: string, _creator: string): Promise<void> {
		throw Error('not implemented');
	}
	protected async onEdited(_issue: OctoKitIssue): Promise<void> {
		throw Error('not implemented');
	}
	protected async onLabeled(_issue: OctoKitIssue, _label: string): Promise<void> {
		throw Error('not implemented');
	}
	protected async onAssigned(_issue: OctoKitIssue, _assignee: string): Promise<void> {
		throw Error('not implemented');
	}
	protected async onUnassigned(_issue: OctoKitIssue, _assignee: string): Promise<void> {
		throw Error('not implemented');
	}
	protected async onOpened(_issue: OctoKitIssue, _payload: WebhookPayload): Promise<void> {
		throw Error('not implemented');
	}
	protected async onReopened(_issue: OctoKitIssue): Promise<void> {
		throw Error('not implemented');
	}
	protected async onClosed(_issue: OctoKitIssue, _payload: WebhookPayload): Promise<void> {
		throw Error('not implemented');
	}
	protected async onMilestoned(_issue: OctoKitIssue): Promise<void> {
		throw Error('not implemented');
	}
	protected async onCommented(_issue: OctoKitIssue, _comment: string, _actor: string): Promise<void> {
		throw Error('not implemented');
	}
}
