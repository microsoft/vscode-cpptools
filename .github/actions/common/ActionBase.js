"use strict";
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
Object.defineProperty(exports, "__esModule", { value: true });
exports.ActionBase = void 0;
const utils_1 = require("./utils");
class ActionBase {
    constructor(labels, milestoneName, milestoneId, ignoreLabels, ignoreMilestoneNames, ignoreMilestoneIds, minimumVotes, maximumVotes, involves) {
        this.labels = labels;
        this.milestoneName = milestoneName;
        this.milestoneId = milestoneId;
        this.ignoreLabels = ignoreLabels;
        this.ignoreMilestoneNames = ignoreMilestoneNames;
        this.ignoreMilestoneIds = ignoreMilestoneIds;
        this.minimumVotes = minimumVotes;
        this.maximumVotes = maximumVotes;
        this.involves = involves;
        this.labelsSet = [];
        this.ignoreLabelsSet = [];
        this.ignoreMilestoneNamesSet = [];
        this.ignoreMilestoneIdsSet = [];
        this.ignoreAllWithLabels = false;
        this.ignoreAllWithMilestones = false;
        this.involvesSet = [];
    }
    buildQuery(baseQuery) {
        var _a, _b, _c, _d, _e, _f;
        let query = baseQuery;
        (0, utils_1.safeLog)(`labels: ${this.labels}`);
        (0, utils_1.safeLog)(`milestoneName: ${this.milestoneName}`);
        (0, utils_1.safeLog)(`milestoneId: ${this.milestoneId}`);
        (0, utils_1.safeLog)(`ignoreLabels: ${this.ignoreLabels}`);
        (0, utils_1.safeLog)(`ignoreMilestoneNames: ${this.ignoreMilestoneNames}`);
        (0, utils_1.safeLog)(`ignoreMilestoneIds: ${this.ignoreMilestoneIds}`);
        (0, utils_1.safeLog)(`minimumVotes: ${this.minimumVotes}`);
        (0, utils_1.safeLog)(`maximumVotes: ${this.maximumVotes}`);
        (0, utils_1.safeLog)(`involves: ${this.involves}`);
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
            if (((_a = this.labels) === null || _a === void 0 ? void 0 : _a.length) > 2 && ((_b = this.labels) === null || _b === void 0 ? void 0 : _b.startsWith('"')) && ((_c = this.labels) === null || _c === void 0 ? void 0 : _c.endsWith('"'))) {
                this.labels = this.labels.substring(1, this.labels.length - 2);
            }
            this.labelsSet = (_d = this.labels) === null || _d === void 0 ? void 0 : _d.split(',');
            for (const str of this.labelsSet) {
                if (str != "") {
                    query = query.concat(` label:"${str}"`);
                }
            }
        }
        // The "involves" qualifier to find issues that in some way involve a certain user.
        // It is a logical OR between the author, assignee, and mentions.
        if (this.involves) {
            this.involvesSet = (_e = this.involves) === null || _e === void 0 ? void 0 : _e.split(',');
            for (const str of this.involvesSet) {
                if (str != "") {
                    query = query.concat(` involves:"${str}"`);
                }
            }
        }
        if (this.ignoreLabels) {
            if (this.ignoreLabels == "*" && !this.labels) { // only if unlabeled
                query = query.concat(` no:label`);
                this.ignoreAllWithLabels = true;
            }
            else {
                this.ignoreLabelsSet = (_f = this.ignoreLabels) === null || _f === void 0 ? void 0 : _f.split(',');
                for (const str of this.ignoreLabelsSet) {
                    if (str != "") {
                        query = query.concat(` -label:"${str}"`);
                    }
                }
            }
        }
        if (this.milestoneName) {
            query = query.concat(` milestone:"${this.milestoneName}"`);
        }
        else if (this.ignoreMilestoneNames) {
            if (this.ignoreMilestoneNames == "*") {
                query = query.concat(` no:milestone`);
                this.ignoreAllWithMilestones = true;
            }
            else if (this.ignoreMilestoneIds) {
                this.ignoreMilestoneNamesSet = this.ignoreMilestoneNames.split(',');
                this.ignoreMilestoneIdsSet = this.ignoreMilestoneIds.split(',');
                for (const str of this.ignoreMilestoneNamesSet) {
                    if (str != "") {
                        query = query.concat(` -milestone:"${str}"`);
                    }
                }
            }
        }
        return query;
    }
    // This is necessary because GitHub sometimes returns incorrect results,
    // and because issues may get modified while we are processing them.
    validateIssue(issue) {
        var _a, _b;
        if (this.ignoreAllWithLabels) {
            // Validate that the issue does not have labels
            if (issue.labels && issue.labels.length !== 0) {
                (0, utils_1.safeLog)(`Issue ${issue.number} skipped due to label found after querying for no:label.`);
                return false;
            }
        }
        else {
            // Make sure all labels we wanted are present.
            if ((!issue.labels || issue.labels.length == 0) && this.labelsSet.length > 0) {
                (0, utils_1.safeLog)(`Issue ${issue.number} skipped due to not having a required label set.  No labels found.`);
                return false;
            }
            for (const str of this.labelsSet) {
                if (!issue.labels.includes(str)) {
                    (0, utils_1.safeLog)(`Issue ${issue.number} skipped due to not having a required label set.`);
                    return false;
                }
            }
            // Make sure no labels we wanted to ignore are present.
            if (issue.labels && issue.labels.length > 0) {
                for (const str of this.ignoreLabelsSet) {
                    if (issue.labels.includes(str)) {
                        (0, utils_1.safeLog)(`Issue ${issue.number} skipped due to having an ignore label set: ${str}`);
                        return false;
                    }
                }
            }
        }
        if (this.ignoreAllWithMilestones) {
            // Validate that the issue does not have a milestone.
            if (issue.milestone) {
                (0, utils_1.safeLog)(`Issue ${issue.number} skipped due to milestone found after querying for no:milestone.`);
                return false;
            }
        }
        else {
            // Make sure milestone is present, if required.
            if (this.milestoneId != null && ((_a = issue.milestone) === null || _a === void 0 ? void 0 : _a.milestoneId) != +this.milestoneId) {
                (0, utils_1.safeLog)(`Issue ${issue.number} skipped due to not having required milsetone id ${this.milestoneId}.  Had: ${(_b = issue.milestone) === null || _b === void 0 ? void 0 : _b.milestoneId}`);
                return false;
            }
            // Make sure a milestones we wanted to ignore is not present.
            if (issue.milestone && issue.milestone.milestoneId != null) {
                for (const str of this.ignoreMilestoneIdsSet) {
                    if (issue.milestone.milestoneId == +str) {
                        (0, utils_1.safeLog)(`Issue ${issue.number} skipped due to milestone ${issue.milestone.milestoneId} found in list of ignored milestone IDs.`);
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
                (0, utils_1.safeLog)(`Issue ${issue.number} skipped due to not having at least ${this.minimumVotes} upvotes.  Had: ${upvotes}`);
                return false;
            }
        }
        // Verify the issue does not have too many upvotes
        if (this.maximumVotes != undefined) {
            if (upvotes > this.maximumVotes) {
                (0, utils_1.safeLog)(`Issue ${issue.number} skipped due to having more than ${this.maximumVotes} upvotes.  Had: ${upvotes}`);
                return false;
            }
        }
        return true;
    }
}
exports.ActionBase = ActionBase;
//# sourceMappingURL=ActionBase.js.map