/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Issue } from '../api/api'

export class ActionBase {
	constructor(
		private labels?: string,
		private milestoneName?: string,
		private milestoneId?: string,
		private ignoreLabels?: string,
		private ignoreMilestoneNames?: string,
		private ignoreMilestoneIds?: string,
		private minimumVotes?: number,
		private maximumVotes?: number,
		private involves?: string,
	) {}

	private labelsSet: string[] = [];
	private ignoreLabelsSet: string[] = [];
	private ignoreMilestoneNamesSet: string[] = [];
	private ignoreMilestoneIdsSet: string[] = [];
	private ignoreAllWithLabels: boolean = false;
	private ignoreAllWithMilestones: boolean = false;
	private involvesSet: string[] = [];

	buildQuery(baseQuery: string): string {
		let query = baseQuery;

		console.log(`labels: ${this.labels}`);
		console.log(`milestoneName: ${this.milestoneName}`);
		console.log(`milestoneId: ${this.milestoneId}`);
		console.log(`ignoreLabels: ${this.ignoreLabels}`);
		console.log(`ignoreMilestoneNames: ${this.ignoreMilestoneNames}`);
		console.log(`ignoreMilestoneIds: ${this.ignoreMilestoneIds}`);
		console.log(`minimumVotes: ${this.minimumVotes}`);
		console.log(`maximumVotes: ${this.maximumVotes}`);
		console.log(`involves: ${this.involves}`);

		// Both milestone name and milestone Id must be provided and must match.
		// The name is used to construct the query, which does not accept ID.
		// The ID is used for comparisons with issue data, which does not include the name.
		// TODO: Figure out a way to convert either from milestone name to ID, or vice versa.

		// If label inclusion and exclusion are mixed, exclusion will take precedence.
		// For example, an issue with both labels A and B will not match if B is excluded, even if A is included.

		// If a milestoneName/milestoneId are set, ignoreMilenameName/ignoreMilestoneIds are ignored.

		// GitHub does not appear to support searching for all issues with milestones (not lacking a milestone).  "-no:milestone" does not work.
		// GitHub does not appear to support searching for all issues with labels (not lacking a label).  "-no:label" does not work.

		// All indicated labels must be present
		if (this.labels) {
			if (this.labels?.length > 2  && this.labels?.startsWith('"') && this.labels?.endsWith('"')) {
				this.labels = this.labels.substring(1, this.labels.length - 2);
			}
			this.labelsSet = this.labels?.split(',');
			for (const str of this.labelsSet) {
				if (str != "") {
					query = query.concat(` label:"${str}"`);
				}
			}
		}

		// The "involves" qualifier to find issues that in some way involve a certain user.
		// It is a logical OR between the author, assignee, and mentions.
		if (this.involves) {
			this.involvesSet = this.involves?.split(',');
			for (const str of this.involvesSet) {
				if (str != "") {
					query = query.concat(` involves:"${str}"`)
				}
			}
		}

		if (this.ignoreLabels) {
			if (this.ignoreLabels == "*" && !this.labels) { // only if unlabeled
				query = query.concat(` no:label`)
				this.ignoreAllWithLabels = true;
			} else {
				this.ignoreLabelsSet = this.ignoreLabels?.split(',');
				for (const str of this.ignoreLabelsSet) {
					if (str != "") {
						query = query.concat(` -label:"${str}"`)
					}
				}
			}
		}

		if (this.milestoneName) {
			query = query.concat(` milestone:"${this.milestoneName}"`)
		}
		else if (this.ignoreMilestoneNames) {
			if (this.ignoreMilestoneNames == "*") {
				query = query.concat(` no:milestone`)
				this.ignoreAllWithMilestones = true;
			} else if (this.ignoreMilestoneIds) {
				this.ignoreMilestoneNamesSet = this.ignoreMilestoneNames.split(',');
				this.ignoreMilestoneIdsSet = this.ignoreMilestoneIds.split(',');
				for (const str of this.ignoreMilestoneNamesSet) {
					if (str != "") {
						query = query.concat(` -milestone:"${str}"`)
					}
				}
			}
		}

		return query;
	}

	// This is necessary because GitHub sometimes returns incorrect results,
	// and because issues may get modified while we are processing them.
	validateIssue(issue: Issue): boolean {
		if (this.ignoreAllWithLabels) {
			// Validate that the issue does not have labels
			if (issue.labels && issue.labels.length !== 0) {
				console.log(`Issue ${issue.number} skipped due to label found after querying for no:label.`);
				return false;
			}
		} else {
			// Make sure all labels we wanted are present.
			if ((!issue.labels || issue.labels.length == 0) && this.labelsSet.length > 0) {
				console.log(`Issue ${issue.number} skipped due to not having a required label set.  No labels found.`);
				return false;
			}
			for (const str of this.labelsSet) {
				if (!issue.labels.includes(str)) {
					console.log(`Issue ${issue.number} skipped due to not having a required label set.`);
					return false;
				}
			}
			// Make sure no labels we wanted to ignore are present.
			if (issue.labels && issue.labels.length > 0) {
				for (const str of this.ignoreLabelsSet) {
					if (issue.labels.includes(str)) {
						console.log(`Issue ${issue.number} skipped due to having an ignore label set: ${str}`);
						return false;
					}
				}
			}
		}
		if (this.ignoreAllWithMilestones) {
			// Validate that the issue does not have a milestone.
			if (issue.milestoneId != null) {
				console.log(`Issue ${issue.number} skipped due to milestone found after querying for no:milestone.`);
				return false;
			}
		} else {
			// Make sure milestone is present, if required.
			if (this.milestoneId != undefined && issue.milestoneId != +this.milestoneId) {
				console.log(`Issue ${issue.number} skipped due to not having required milsetone id ${this.milestoneId}.  Had: ${issue.milestoneId}`);
				return false;
			}
			// Make sure a milestones we wanted to ignore is not present.
			if (issue.milestoneId != null) {
				for (const str of this.ignoreMilestoneIdsSet) {
					if (issue.milestoneId == +str) {
						console.log(`Issue ${issue.number} skipped due to milestone ${issue.milestoneId} found in list of ignored milestone IDs.`);
						return false;
					}
				}
			}
		}
		// Verify the issue has a sufficient number of upvotes
		let upvotes = 0;
		if (issue.reactions) {
			upvotes = issue.reactions['+1'];
		}
		if (this.minimumVotes != undefined) {
			if (upvotes < this.minimumVotes) {
				console.log(`Issue ${issue.number} skipped due to not having at least ${this.minimumVotes} upvotes.  Had: ${upvotes}`);
				return false;
			}
		}
		// Verify the issue does not have too many upvotes
		if (this.maximumVotes != undefined) {
			if (upvotes > this.maximumVotes) {
				console.log(`Issue ${issue.number} skipped due to having more than ${this.maximumVotes} upvotes.  Had: ${upvotes}`);
				return false;
			}
		}
		return true;
	}
}
