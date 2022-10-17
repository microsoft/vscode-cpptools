/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { GitHub } from '../api/api';
import { ActionBase } from '../common/ActionBase';
import { daysAgoToHumanReadbleDate, daysAgoToTimestamp, safeLog } from '../common/utils';

export class StaleCloser extends ActionBase {
	constructor(
		private github: GitHub,
		private closeDays: number,
		labels: string,
		private closeComment: string,
		private pingDays: number,
		private pingComment: string,
		private additionalTeam: string[],
		private addLabels?: string,
		private removeLabels?: string,
		private setMilestoneId?: string,
		milestoneName?: string,
		milestoneId?: string,
		ignoreLabels?: string,
		ignoreMilestoneNames?: string,
		ignoreMilestoneIds?: string,
		minimumVotes?: number,
		maximumVotes?: number,
		involves?: string
	)
	{
		super(labels, milestoneName, milestoneId, ignoreLabels, ignoreMilestoneNames, ignoreMilestoneIds, minimumVotes, maximumVotes, involves);
	}

	async run() {
		const updatedTimestamp = daysAgoToHumanReadbleDate(this.closeDays);
		const pingTimestamp = this.pingDays ? daysAgoToTimestamp(this.pingDays) : undefined;

		const query = this.buildQuery((this.closeDays ? `updated:<${updatedTimestamp} ` : "") + "is:open is:unlocked");

		const addLabelsSet = this.addLabels ? this.addLabels.split(',') : [];
		const removeLabelsSet = this.removeLabels ? this.removeLabels.split(',') : [];

		for await (const page of this.github.query({ q: query })) {
			for (const issue of page) {
				const hydrated = await issue.getIssue();
				const lastCommentIterator = await issue.getComments(true).next();
				if (lastCommentIterator.done) {
					throw Error('Unexpected comment data');
				}
				const lastComment = lastCommentIterator.value[0];

				if (hydrated.open && this.validateIssue(hydrated)
					// TODO: Verify updated timestamp
				) {
					if (
						!lastComment ||
						lastComment.author.isGitHubApp ||
						pingTimestamp == undefined ||
						// TODO: List the collaborators once per go rather than checking a single user each issue
						this.additionalTeam.includes(lastComment.author.name) ||
						await issue.hasWriteAccess(lastComment.author)
					) {
						if (pingTimestamp != undefined) {
							if (lastComment) {
								safeLog(
									`Last comment on issue ${hydrated.number} by ${lastComment.author.name}. Closing.`,
								);
							} else {
								safeLog(`No comments on issue ${hydrated.number}. Closing.`);
							}
						}
						if (this.closeComment) {
							safeLog(`Posting comment on issue ${hydrated.number}`);
							await issue.postComment(this.closeComment);
						}
						if (removeLabelsSet.length > 0) {
							for (const removeLabel of removeLabelsSet) {
								if (removeLabel && removeLabel.length > 0) {
									safeLog(`Removing label on issue ${hydrated.number}: ${removeLabel}`);
									await issue.removeLabel(removeLabel);
								}
							}
						}
						if (addLabelsSet.length > 0) {
							for (const addLabel of addLabelsSet) {
								if (addLabel && addLabel.length > 0) {
									safeLog(`Adding label on issue ${hydrated.number}: ${addLabel}`);
									await issue.addLabel(addLabel);
								}
							}
						}
						await issue.closeIssue("not_planned");
						if (this.setMilestoneId != undefined) {
							safeLog(`Setting milestone of issue ${hydrated.number} to id ${+this.setMilestoneId}`);
							await issue.setMilestone(+this.setMilestoneId);
						}
						safeLog(`Closing issue ${hydrated.number}.`);
					} else {
						// Ping
						if (hydrated.updatedAt < pingTimestamp && hydrated.assignee) {
							safeLog(
								`Last comment on issue ${hydrated.number} by ${lastComment.author.name}. Pinging @${hydrated.assignee}`,
							);
							if (this.pingComment) {
								await issue.postComment(
									this.pingComment
										.replace('${assignee}', hydrated.assignee)
										.replace('${author}', hydrated.author.name),
								);
							}
						} else {
							safeLog(
								`Last comment on issue ${hydrated.number} by ${lastComment.author.name}. Skipping.${
									hydrated.assignee ? ' cc @' + hydrated.assignee : ''
								}`,
							);
						}
					}
				} else {
					if (!hydrated.open) {
						safeLog(`Issue ${hydrated.number} is not open. Ignoring`);
					}
				}
			}
		}
	}
}
