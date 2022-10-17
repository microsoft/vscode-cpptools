/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { getOctokit } from '@actions/github';
import type { RequestError } from '@octokit/request-error';
import { exec } from 'child_process';
import { IssueGetResponse, IssuesGetResponseMilestone } from '../common/OctokitTypings';
import { safeLog } from '../common/utils';
import { Comment, GitHub, GitHubIssue, Issue, Milestone, Query, User } from './api';

let numRequests = 0;
export const getNumRequests = () => numRequests;

export class OctoKit implements GitHub {
	private _octokit: ReturnType<typeof getOctokit>;
	protected get octokit(): ReturnType<typeof getOctokit> {
		numRequests++;
		return this._octokit;
	}

	// when in readonly mode, record labels just-created so at to not throw unneccesary errors
	protected mockLabels: Set<string> = new Set();

	public readonly repoName: string;
	public readonly repoOwner: string;

	constructor(
		protected token: string,
		protected params: { repo: string; owner: string },
		protected options: { readonly: boolean } = { readonly: false },
	) {
		this._octokit = getOctokit(token);
		this.repoName = params.repo;
		this.repoOwner = params.owner;
	}

	getIssueByNumber(number: number) {
		return new OctoKitIssue(this.token, this.params, { number: number });
	}

	// TODO: just iterate over the issues in a page here instead of making caller do it
	async *query(query: Query): AsyncIterableIterator<GitHubIssue[]> {
		const q = query.q + ` repo:${this.params.owner}/${this.params.repo}`;

		const options = {
			...query,
			q,
			per_page: 100,
			headers: { Accept: 'application/vnd.github.squirrel-girl-preview+json' },
		};

		let pageNum = 0;

		const timeout = async () => {
			if (pageNum < 2) {
				/* pass */
			} else if (pageNum < 4) {
				await new Promise((resolve) => setTimeout(resolve, 10000));
			} else {
				await new Promise((resolve) => setTimeout(resolve, 30000));
			}
		};

		for await (const pageResponse of this.octokit.paginate.iterator(
			this.octokit.rest.search.issuesAndPullRequests,
			options,
		)) {
			await timeout();
			numRequests++;
			const page = pageResponse.data;
			safeLog(`Page ${++pageNum}: ${page.map(({ number }) => number).join(' ')}`);
			yield page.map(
				(issue) =>
					new OctoKitIssue(this.token, this.params, this.octokitIssueToIssue(issue), this.options),
			);
		}
	}

	async createIssue(owner: string, repo: string, title: string, body: string): Promise<void> {
		safeLog(`Creating issue \`${title}\` on ${owner}/${repo}`);
		if (!this.options.readonly) await this.octokit.rest.issues.create({ owner, repo, title, body });
	}

	protected octokitIssueToIssue(issue: IssueGetResponse): Issue {
		return {
			author: { name: issue.user?.login ?? 'unkown', isGitHubApp: issue.user?.type === 'Bot' },
			body: issue.body ?? '',
			number: issue.number,
			title: issue.title,
			isPr: !!issue.pull_request?.html_url,
			labels: issue.labels.map((label) => (typeof label === 'string' ? label : label.name ?? '')),
			open: issue.state === 'open',
			locked: (issue as any).locked,
			numComments: issue.comments,
			reactions: (issue as any).reactions,
			assignee: issue.assignee?.login ?? (issue as IssueGetResponse).assignees?.[0]?.login,
			assignees: (issue as IssueGetResponse).assignees?.map((assignee) => assignee.login) ?? [],
			milestone: issue.milestone ? this.octokitMilestoneToMilestone(issue.milestone) : null,
			createdAt: +new Date(issue.created_at),
			updatedAt: +new Date(issue.updated_at),
			closedAt: issue.closed_at ? +new Date(issue.closed_at as unknown as string) : undefined,
		};
	}

	protected octokitMilestoneToMilestone(milestone: IssuesGetResponseMilestone): Milestone | null {
		if (milestone?.number === undefined) {
			return null;
		}
		return {
			title: milestone.title,
			milestoneId: milestone.number,
			// Remove the time portions of the dates as they're not important
			createdAt: milestone.created_at !== null ? new Date(milestone.created_at.split('T')[0]) : null,
			dueOn: milestone.due_on !== null ? new Date(milestone.due_on.split('T')[0]) : null,
			closedAt: milestone.closed_at !== null ? new Date(milestone.closed_at.split('T')[0]) : null,
			description: milestone.description ?? '',
			numClosedIssues: milestone.closed_issues,
			numOpenIssues: milestone.open_issues,
			state: milestone.state === 'open' ? 'open' : 'closed',
		};
	}

	private writeAccessCache: Record<string, boolean> = {};
	async hasWriteAccess(user: User): Promise<boolean> {
		if (user.name in this.writeAccessCache) {
			safeLog('Got permissions from cache for ' + user);
			return this.writeAccessCache[user.name];
		}
		safeLog('Fetching permissions for ' + user.name);
		const permissions = (
			await this.octokit.rest.repos.getCollaboratorPermissionLevel({
				...this.params,
				username: user.name,
			})
		).data.permission;
		return (this.writeAccessCache[user.name] = permissions === 'admin' || permissions === 'write');
	}

	async repoHasLabel(name: string): Promise<boolean> {
		try {
			await this.octokit.rest.issues.getLabel({ ...this.params, name });
			return true;
		} catch (err) {
			const statusErorr = err as RequestError;
			if (statusErorr.status === 404) {
				return this.options.readonly && this.mockLabels.has(name);
			}
			throw err;
		}
	}

	async createLabel(name: string, color: string, description: string): Promise<void> {
		safeLog('Creating label ' + name);
		if (!this.options.readonly)
			await this.octokit.rest.issues.createLabel({ ...this.params, color, description, name });
		else this.mockLabels.add(name);
	}

	async deleteLabel(name: string): Promise<void> {
		safeLog('Deleting label ' + name);
		try {
			if (!this.options.readonly) await this.octokit.rest.issues.deleteLabel({ ...this.params, name });
		} catch (err) {
			const statusErorr = err as RequestError;
			if (statusErorr.status === 404) {
				return;
			}
			throw err;
		}
	}

	async readConfig(path: string): Promise<any> {
		safeLog('Reading config at ' + path);
		const repoPath = `.github/${path}.json`;
		try {
			const data = (await this.octokit.rest.repos.getContent({ ...this.params, path: repoPath })).data;
			if ('type' in data && data.type === 'file' && 'content' in data) {
				if (data.encoding === 'base64' && data.content) {
					return JSON.parse(Buffer.from(data.content, 'base64').toString('utf-8'));
				}
				throw Error(`Could not read contents "${data.content}" in encoding "${data.encoding}"`);
			}
			throw Error('Found directory at config path when expecting file' + JSON.stringify(data));
		} catch (e) {
			throw Error('Error with config file at ' + repoPath + ': ' + JSON.stringify(e));
		}
	}

	async releaseContainsCommit(release: string, commit: string): Promise<'yes' | 'no' | 'unknown'> {
		const isHash = (s: string) => /^[a-fA-F0-9]*$/.test(s);
		if (!isHash(release) || !isHash(commit)) return 'unknown';
		return new Promise((resolve, reject) =>
			exec(`git -C ./repo merge-base --is-ancestor ${commit} ${release}`, (err) => {
				if (!err || err.code === 1) {
					resolve(!err ? 'yes' : 'no');
				} else if (err.message.includes(`Not a valid commit name ${release}`)) {
					// release branch is forked. Probably in endgame. Not released.
					resolve('no');
				} else if (err.message.includes(`Not a valid commit name ${commit}`)) {
					// commit is probably in a different repo.
					resolve('unknown');
				} else {
					reject(err);
				}
			}),
		);
	}

	async getCurrentRepoMilestone(): Promise<number | undefined> {
		safeLog(`Getting repo milestone for ${this.params.owner}/${this.params.repo}`);
		// Fetch all milestones open for this repo
		const allMilestones = (
			await this.octokit.rest.issues.listMilestones({
				owner: this.params.owner,
				repo: this.params.repo,
				state: 'open',
				sort: 'due_on',
				direction: 'asc',
			})
		).data;
		const currentDate = new Date();
		const possibleMilestones = allMilestones
			.filter(
				(milestone) =>
					new Date(milestone.due_on === null ? currentDate : milestone.due_on) > currentDate &&
					currentDate > new Date(milestone.created_at) &&
					!milestone.title.includes('Recovery'),
			)
			.sort((a, b) => +new Date(a.due_on ?? currentDate) - +new Date(b.due_on ?? currentDate));
		if (possibleMilestones.length === 0) {
			return undefined;
		}
		return possibleMilestones[0].number;
	}

	async dispatch(title: string): Promise<void> {
		safeLog('Dispatching ' + title);
		if (!this.options.readonly)
			await this.octokit.rest.repos.createDispatchEvent({ ...this.params, event_type: title });
	}
}

export class OctoKitIssue extends OctoKit implements GitHubIssue {
	constructor(
		token: string,
		protected params: { repo: string; owner: string },
		private issueData: { number: number } | Issue,
		options: { readonly: boolean } = { readonly: false },
	) {
		super(token, params, options);
		safeLog('running bot on issue', issueData.number);
	}

	async addAssignee(assignee: string): Promise<void> {
		safeLog('Adding assignee ' + assignee + ' to ' + this.issueData.number);
		if (!this.options.readonly) {
			await this.octokit.rest.issues.addAssignees({
				...this.params,
				issue_number: this.issueData.number,
				assignees: [assignee],
			});
		}
	}

	async removeAssignee(assignee: string): Promise<void> {
		safeLog('Removing assignee ' + assignee + ' to ' + this.issueData.number);
		if (!this.options.readonly) {
			await this.octokit.rest.issues.removeAssignees({
				...this.params,
				issue_number: this.issueData.number,
				assignees: [assignee],
			});
		}
	}

	async closeIssue(reason: 'completed' | 'not_planned'): Promise<void> {
		safeLog('Closing issue ' + this.issueData.number);
		if (!this.options.readonly) {
			const issue = await this.octokit.rest.issues.get({
				...this.params,
				issue_number: this.issueData.number,
			});
			// Don't close already closed issues even if it means changing the state
			if (issue.data.state === 'closed') {
				return;
			}
			await this.octokit.rest.issues
				.update({
					...this.params,
					issue_number: this.issueData.number,
					state: 'closed',
					state_reason: reason,
				})
				.catch((e) => {
					safeLog('error closing issue:', e);
				});
		}
	}

	async reopenIssue(): Promise<void> {
		safeLog('Reopening issue ' + this.issueData.number);
		if (!this.options.readonly)
			await this.octokit.rest.issues.update({
				...this.params,
				issue_number: this.issueData.number,
				state: 'open',
			});
	}

	async lockIssue(): Promise<void> {
		safeLog('Locking issue ' + this.issueData.number);
		if (!this.options.readonly)
			await this.octokit.rest.issues.lock({ ...this.params, issue_number: this.issueData.number });
	}

	async unlockIssue(): Promise<void> {
		safeLog('Unlocking issue ' + this.issueData.number);
		if (!this.options.readonly)
			await this.octokit.rest.issues.unlock({ ...this.params, issue_number: this.issueData.number });
	}

	async getIssue(): Promise<Issue> {
		if (isIssue(this.issueData)) {
			safeLog('Got issue data from query result ' + this.issueData.number);
			return this.issueData;
		}

		safeLog('Fetching issue ' + this.issueData.number);
		const issue = (
			await this.octokit.rest.issues.get({
				...this.params,
				issue_number: this.issueData.number,
				mediaType: { previews: ['squirrel-girl'] },
			})
		).data;
		return (this.issueData = this.octokitIssueToIssue(issue));
	}

	async postComment(body: string): Promise<void> {
		safeLog(`Posting comment on ${this.issueData.number}`);
		if (!this.options.readonly)
			await this.octokit.rest.issues.createComment({
				...this.params,
				issue_number: this.issueData.number,
				body,
			});
	}

	async deleteComment(id: number): Promise<void> {
		safeLog(`Deleting comment ${id} on ${this.issueData.number}`);
		if (!this.options.readonly)
			await this.octokit.rest.issues.deleteComment({
				owner: this.params.owner,
				repo: this.params.repo,
				comment_id: id,
			});
	}

	async setMilestone(milestoneId: number) {
		safeLog(`Setting milestone for ${this.issueData.number} to ${milestoneId}`);
		if (!this.options.readonly)
			await this.octokit.rest.issues.update({
				...this.params,
				issue_number: this.issueData.number,
				milestone: milestoneId,
			});
	}

	async *getComments(last?: boolean): AsyncIterableIterator<Comment[]> {
		safeLog('Fetching comments for ' + this.issueData.number);

		const response = this.octokit.paginate.iterator(this.octokit.rest.issues.listComments, {
			...this.params,
			issue_number: this.issueData.number,
			per_page: 100,
			...(last ? { per_page: 1, page: (await this.getIssue()).numComments } : {}),
		});

		for await (const page of response) {
			numRequests++;
			yield page.data.map((comment) => ({
				author: { name: comment.user?.login ?? '', isGitHubApp: comment.user?.type === 'Bot' },
				body: comment.body ?? '',
				id: comment.id,
				timestamp: +new Date(comment.created_at),
			}));
		}
	}

	async addLabel(name: string): Promise<void> {
		safeLog(`Adding label ${name} to ${this.issueData.number}`);
		if (!(await this.repoHasLabel(name))) {
			throw Error(`Action could not execute becuase label ${name} is not defined.`);
		}
		if (!this.options.readonly)
			await this.octokit.rest.issues.addLabels({
				...this.params,
				issue_number: this.issueData.number,
				labels: [name],
			});
	}

	async getAssigner(assignee: string): Promise<string> {
		const options = {
			...this.params,
			issue_number: this.issueData.number,
		};

		let assigner: string | undefined;

		for await (const event of this.octokit.paginate.iterator(
			this.octokit.rest.issues.listEventsForTimeline,
			options,
		)) {
			numRequests++;
			const timelineEvents = event.data;
			for (const timelineEvent of timelineEvents) {
				if (timelineEvent.event === 'assigned' && timelineEvent.assignee?.login === assignee) {
					assigner = timelineEvent.actor?.login;
				}
			}
			if (assigner) {
				break;
			}
		}

		if (!assigner) {
			throw Error('Expected to find ' + assignee + ' in issue timeline but did not.');
		}

		return assigner;
	}

	async removeLabel(name: string): Promise<void> {
		safeLog(`Removing label ${name} from ${this.issueData.number}`);
		try {
			if (!this.options.readonly)
				await this.octokit.rest.issues.removeLabel({
					...this.params,
					issue_number: this.issueData.number,
					name,
				});
		} catch (err) {
			const statusErorr = err as RequestError;
			if (statusErorr.status === 404) {
				safeLog(`Label ${name} not found on issue`);
				return;
			}
			throw err;
		}
	}

	async getClosingInfo(
		alreadyChecked: number[] = [],
	): Promise<{ hash: string | undefined; timestamp: number } | undefined> {
		if (alreadyChecked.includes(this.issueData.number)) {
			return undefined;
		}
		alreadyChecked.push(this.issueData.number);

		if ((await this.getIssue()).open) {
			return;
		}

		const closingHashComment =
			/(?:\\|\/)closedWith (?:https:\/\/github\.com\/microsoft\/vscode\/commit\/)?([a-fA-F0-9]{7,40})/;

		const options = {
			...this.params,
			issue_number: this.issueData.number,
		};
		let closingCommit: { hash: string | undefined; timestamp: number } | undefined;
		const crossReferencing: number[] = [];
		for await (const event of this.octokit.paginate.iterator(
			this.octokit.rest.issues.listEventsForTimeline,
			options,
		)) {
			numRequests++;

			const timelineEvents = event.data;
			for (const timelineEvent of timelineEvents) {
				if (
					(timelineEvent.event === 'closed' || timelineEvent.event === 'merged') &&
					timelineEvent.created_at &&
					timelineEvent.commit_id &&
					timelineEvent.commit_url
						?.toLowerCase()
						.includes(`/${this.params.owner}/${this.params.repo}/`.toLowerCase())
				) {
					closingCommit = {
						hash: timelineEvent.commit_id,
						timestamp: +new Date(timelineEvent.created_at),
					};
				}
				if (timelineEvent.event === 'reopened') {
					closingCommit = undefined;
				}
				if (
					timelineEvent.created_at &&
					timelineEvent.event === 'commented' &&
					!((timelineEvent as any).body as string)?.includes('UNABLE_TO_LOCATE_COMMIT_MESSAGE') &&
					closingHashComment.test((timelineEvent as any).body)
				) {
					closingCommit = {
						hash: closingHashComment.exec((timelineEvent as any).body)![1],
						timestamp: +new Date(timelineEvent.created_at),
					};
				}
				if (
					timelineEvent.event === 'cross-referenced' &&
					(timelineEvent as any).source?.issue?.number &&
					(timelineEvent as any).source?.issue?.pull_request?.url.includes(
						`/${this.params.owner}/${this.params.repo}/`.toLowerCase(),
					)
				) {
					crossReferencing.push((timelineEvent as any).source.issue.number);
				}
			}
		}

		// If we dont have any closing info, try to get it from linked issues (PRs).
		// If there's a linked issue that was closed at almost the same time, guess it was a PR that closed this.
		if (!closingCommit) {
			for (const id of crossReferencing.reverse()) {
				const closed = await new OctoKitIssue(this.token, this.params, {
					number: id,
				}).getClosingInfo(alreadyChecked);

				if (closed) {
					if (Math.abs(closed.timestamp - ((await this.getIssue()).closedAt ?? 0)) < 5000) {
						closingCommit = closed;
						break;
					}
				}
			}
		}

		safeLog(`Got ${JSON.stringify(closingCommit)} as closing commit of ${this.issueData.number}`);
		return closingCommit;
	}
}

function isIssue(object: any): object is Issue {
	const isIssue =
		'author' in object &&
		'body' in object &&
		'title' in object &&
		'labels' in object &&
		'open' in object &&
		'locked' in object &&
		'number' in object &&
		'numComments' in object &&
		'reactions' in object &&
		'milestoneId' in object;

	return isIssue;
}
