/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { OctoKit, OctoKitIssue, getNumRequests } from '../api/octokit'
import { context, GitHub } from '@actions/github'
import { getRequiredInput, logErrorToIssue, getRateLimit, errorLoggingIssue } from './utils'
import { getInput, setFailed } from '@actions/core'

export abstract class Action {
	abstract id: string

	private username: Promise<string>
	private token = getRequiredInput('token')

	constructor() {
		this.username = new GitHub(this.token).users.getAuthenticated().then((v) => v.data.name)
	}

	public async run() {
		console.log('running ', this.id, 'with context', {
			...context,
			payload: {
				issue: context.payload?.issue?.number,
				label: context.payload?.label?.name,
				repository: context.payload?.repository?.html_url,
				sender: context.payload?.sender?.login ?? context.payload?.sender?.type,
			},
		})

		if (errorLoggingIssue) {
			const { repo, issue, owner } = errorLoggingIssue
			if (
				context.repo.repo === repo &&
				context.repo.owner === owner &&
				context.payload.issue?.number === issue
			) {
				return console.log('refusing to run on error logging issue to prevent cascading errors')
			}
		}

		try {
			const token = getRequiredInput('token')
			const readonly = !!getInput('readonly')

			const issue = context?.issue?.number
			if (issue) {
				const octokit = new OctoKitIssue(token, context.repo, { number: issue }, { readonly })
				if (context.eventName === 'issue_comment') {
					await this.onCommented(octokit, context.payload.comment.body, context.actor)
				} else if (context.eventName === 'issues') {
					switch (context.payload.action) {
						case 'opened':
							await this.onOpened(octokit)
							break
						case 'reopened':
							await this.onReopened(octokit)
							break
						case 'closed':
							await this.onClosed(octokit)
							break
						case 'labeled':
							await this.onLabeled(octokit, context.payload.label.name)
							break
						case 'unassigned':
							await this.onUnassigned(octokit, context.payload.assignee.login)
							break
						case 'edited':
							await this.onEdited(octokit)
							break
						case 'milestoned':
							await this.onMilestoned(octokit)
							break
						default:
							throw Error('Unexpected action: ' + context.payload.action)
					}
				}
			} else {
				await this.onTriggered(new OctoKit(token, context.repo, { readonly }))
			}
		} catch (e) {
			await this.error(e)
		}

		const usage = await getRateLimit(this.token)
	}

	private async error(error: Error) {
		const details: any = {
			message: `${error.message}\n${error.stack}`,
			id: this.id,
			user: await this.username,
		}

		if (context.issue.number) details.issue = context.issue.number

		const rendered = `
Message: ${details.message}

Actor: ${details.user}

ID: ${details.id}
`
		await logErrorToIssue(rendered, true, this.token)

		setFailed(error.message)
	}

	protected async onTriggered(_octokit: OctoKit): Promise<void> {
		throw Error('not implemented')
	}
	protected async onEdited(_issue: OctoKitIssue): Promise<void> {
		throw Error('not implemented')
	}
	protected async onLabeled(_issue: OctoKitIssue, _label: string): Promise<void> {
		throw Error('not implemented')
	}
	protected async onUnassigned(_issue: OctoKitIssue, _label: string): Promise<void> {
		throw Error('not implemented')
	}
	protected async onOpened(_issue: OctoKitIssue): Promise<void> {
		throw Error('not implemented')
	}
	protected async onReopened(_issue: OctoKitIssue): Promise<void> {
		throw Error('not implemented')
	}
	protected async onClosed(_issue: OctoKitIssue): Promise<void> {
		throw Error('not implemented')
	}
	protected async onMilestoned(_issue: OctoKitIssue): Promise<void> {
		throw Error('not implemented')
	}
	protected async onCommented(_issue: OctoKitIssue, _comment: string, _actor: string): Promise<void> {
		throw Error('not implemented')
	}
}
