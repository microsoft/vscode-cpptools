/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { GitHub } from '../api/api';
import { ActionBase } from '../common/ActionBase';
import { daysAgoToHumanReadbleDate, daysAgoToTimestamp, safeLog } from '../common/utils';

export class AddComment extends ActionBase {
	constructor(
		private github: GitHub,
		private createdAfter: string | undefined,
		private afterDays: number,
		labels: string,
		private addComment: string,
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
	) {
		super(labels, milestoneName, milestoneId, ignoreLabels, ignoreMilestoneNames, ignoreMilestoneIds, minimumVotes, maximumVotes, involves);
	}

	async run() {
		const updatedTimestamp = this.afterDays ? daysAgoToHumanReadbleDate(this.afterDays) : undefined;
		const query = this.buildQuery(
			(updatedTimestamp ? `updated:<${updatedTimestamp} ` : "") +
			(this.createdAfter ? `created:>${this.createdAfter} ` : "") +
			"is:open is:unlocked");

		const addLabelsSet = this.addLabels ? this.addLabels.split(',') : [];
		const removeLabelsSet = this.removeLabels ? this.removeLabels.split(',') : [];

		for await (const page of this.github.query({ q: query })) {
			for (const issue of page) {
				const hydrated = await issue.getIssue();
				if (hydrated.open && this.validateIssue(hydrated)
					// TODO: Verify updated timestamp
				) {
					// Don't add a comment if already commented on by an action.
					let foundActionComment = false;
					for await (const commentBatch of issue.getComments()) {
						for (const comment of commentBatch) {
							if (comment.author.isGitHubApp) {
								foundActionComment = true;
								break;
							}
						}
						if (foundActionComment)
							break;
					}
					if (foundActionComment) {
						safeLog(`Issue ${hydrated.number} already commented on by an action. Ignoring.`);
						continue;
					}

					if (this.addComment) {
						safeLog(`Posting comment on issue ${hydrated.number}`);
						await issue.postComment(this.addComment);
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
					if (this.setMilestoneId != undefined) {
						safeLog(`Setting milestone of issue ${hydrated.number} to id ${+this.setMilestoneId}`);
						await issue.setMilestone(+this.setMilestoneId);
					}
					safeLog(`Processing issue ${hydrated.number}.`);
				} else {
					if (!hydrated.open) {
						safeLog(`Issue ${hydrated.number} is not open. Ignoring`);
					}
				}
			}
		}
	}
}
