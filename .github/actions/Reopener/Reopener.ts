/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { GitHub, Issue } from '../api/api'
import { ActionBase } from '../common/ActionBase'

export class Reopener extends ActionBase {
	constructor(
		private github: GitHub,
		private alsoApplyToOpenIssues: boolean,
		private addLabels?: string,
		private removeLabels?: string,
		private reopenComment?: string,
		private setMilestoneId?: string,
		labels?: string,
		milestoneName?: string,
		milestoneId?: string,
		ignoreLabels?: string,
		ignoreMilestoneNames?: string,
		ignoreMilestoneIds?: string,
		minimumVotes?: number,
		maximumVotes?: number
	)
	{
		super(labels, milestoneName, milestoneId, ignoreLabels, ignoreMilestoneNames, ignoreMilestoneIds, minimumVotes, maximumVotes);
	}

	async run() {
		const addLabelsSet = this.addLabels ? this.addLabels.split(',') : [];
		const removeLabelsSet = this.removeLabels ? this.removeLabels.split(',') : [];

		console.log(`alsoApplyToOpenIssues: ${this.alsoApplyToOpenIssues}`);

		const query = this.buildQuery((this.alsoApplyToOpenIssues ? "": "is:closed ") + "is:unlocked");

		for await (const page of this.github.query({ q: query })) {
			await Promise.all(
				page.map(async (issue) => {
					const hydrated = await issue.getIssue()
					if (!hydrated.locked && (this.alsoApplyToOpenIssues || hydrated.open === false) && this.validateIssue(hydrated)
						// TODO: Verify closed and updated timestamps
					) {
						if (hydrated.open === false) {
							console.log(`Reopening issue ${hydrated.number}`)
							await issue.reopenIssue()
						}
						if (this.setMilestoneId != undefined) {
							console.log(`Setting milestone of issue ${hydrated.number} to id ${+this.setMilestoneId}`)
							await issue.setMilestone(+this.setMilestoneId)
						}
						if (removeLabelsSet.length > 0) {
							for (const removeLabel of removeLabelsSet) {
								if (removeLabel && removeLabel.length > 0) {
									console.log(`Removing label on issue ${hydrated.number}: ${removeLabel}`)
									await issue.removeLabel(removeLabel)
								}
							}
						}
						if (addLabelsSet.length > 0) {
							for (const addLabel of addLabelsSet) {
								if (addLabel && addLabel.length > 0) {
									console.log(`Adding label on issue ${hydrated.number}: ${addLabel}`)
									await issue.addLabel(addLabel)
								}
							}
						}
						if (this.reopenComment) {
							console.log(`Posting comment to issue ${hydrated.number}.`)
							await issue.postComment(this.reopenComment)
						}
					} else {
						if (hydrated.locked) {
							console.log(`Issue ${hydrated.number} is locked. Ignoring`)
						} else if (!this.alsoApplyToOpenIssues && hydrated.open) {
							console.log(`Issue ${hydrated.number} is open. Ignoring`)
						}
					}
				}),
			)
		}
	}
}
