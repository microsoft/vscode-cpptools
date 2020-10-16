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
		private maximumVotes?: number
	) {}

	private labelsSet: string[] = [];
	private ignoreLabelsSet: string[] = [];
	private ignoreMilestoneNamesSet: string[] = [];
	private ignoreMilestoneIdsSet: string[] = [];
	private ignoreAllWithLabels: boolean = false;
	private ignoreAllWithMilestones: boolean = false;

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

		// Both milestone name and milestone Id must be provided and must match.
		// The name is used to construct the query, which does not accept ID.
		// The ID is used for comparisons with issue data, which does not include the name.
		// TODO: Figure out a way to convert either from milestone name to ID, or vice versa.

		// If inclusion and exclusion are mixed, exclusion will take precedence.
		// For example, an issue with both labels A and B will not match if B is excluded, even if A is included.

		// GitHub does not appear to support searching for all issues with milestones (not lacking a milestone).  "-no:milestone" does not work.
		// GitHub does not appear to support searching for all issues with labels (not lacking a label).  "-no:label" does not work.

		// All indicated labels must be present
		if (this.labels) {
			this.labelsSet = this.labels?.split(',');
			for (const str of this.labelsSet) {
				if (str != "") {
					query = query.concat(` label:"${str}"`)
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

		if (this.ignoreMilestoneNames) {
			if (this.ignoreMilestoneNames == "*" && !this.milestoneName) { // only if no milestone
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
				return false;
			}
		} else {
			// Make sure all labels we wanted are present.
			if ((!issue.labels || issue.labels.length == 0) && this.labelsSet.length > 0) {
				return false;
			}
			for (const str of this.labelsSet) {
				if (!issue.labels.includes(str)) {
					return false;
				}
			}
			// Make sure no labels we wanted to ignore are present.
			if (issue.labels && issue.labels.length > 0) {
				for (const str of this.ignoreLabelsSet) {
					if (issue.labels.includes(str)) {
						return false;
					}
				}
			}
		}
		if (this.ignoreAllWithMilestones) {
			// Validate that the issue does not have a milestone.
			if (issue.milestoneId != null) {
				return false;
			}
		} else {
			// Make sure milestone is present, if required.
			if (this.milestoneId != undefined && issue.milestoneId != +this.milestoneId) {
				return false;
			}
			// Make sure a milestones we wanted to ignore is not present.
			if (issue.milestoneId != null) {
				for (const str of this.ignoreMilestoneIdsSet) {
					if (issue.milestoneId == +str) {
						return false;
					}
				}
			}
		}
		// Verify the issue has a sufficient number of upvotes
		if (this.minimumVotes != undefined) {
			if (issue.reactions['+1'] < this.minimumVotes) {
				return false;
			}
		}
		// Verify the issue does not have too many upvotes
		if (this.maximumVotes != undefined) {
			if (issue.reactions && issue.reactions['+1'] && issue.reactions['+1'] > this.maximumVotes) {
				return false;
			}
		}
		return true;
	}
}
