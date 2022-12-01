"use strict";
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
Object.defineProperty(exports, "__esModule", { value: true });
exports.Reopener = void 0;
const utils_1 = require("../common/utils");
const ActionBase_1 = require("../common/ActionBase");
class Reopener extends ActionBase_1.ActionBase {
    constructor(github, alsoApplyToOpenIssues, addLabels, removeLabels, reopenComment, setMilestoneId, labels, milestoneName, milestoneId, ignoreLabels, ignoreMilestoneNames, ignoreMilestoneIds, minimumVotes, maximumVotes) {
        super(labels, milestoneName, milestoneId, ignoreLabels, ignoreMilestoneNames, ignoreMilestoneIds, minimumVotes, maximumVotes);
        this.github = github;
        this.alsoApplyToOpenIssues = alsoApplyToOpenIssues;
        this.addLabels = addLabels;
        this.removeLabels = removeLabels;
        this.reopenComment = reopenComment;
        this.setMilestoneId = setMilestoneId;
    }
    async run() {
        const addLabelsSet = this.addLabels ? this.addLabels.split(',') : [];
        const removeLabelsSet = this.removeLabels ? this.removeLabels.split(',') : [];
        (0, utils_1.safeLog)(`alsoApplyToOpenIssues: ${this.alsoApplyToOpenIssues}`);
        const query = this.buildQuery((this.alsoApplyToOpenIssues ? "" : "is:closed ") + "is:unlocked");
        for await (const page of this.github.query({ q: query })) {
            await Promise.all(page.map(async (issue) => {
                const hydrated = await issue.getIssue();
                if (!hydrated.locked && (this.alsoApplyToOpenIssues || hydrated.open === false) && this.validateIssue(hydrated)
                // TODO: Verify closed and updated timestamps
                ) {
                    if (hydrated.open === false) {
                        (0, utils_1.safeLog)(`Reopening issue ${hydrated.number}`);
                        await issue.reopenIssue();
                    }
                    if (this.setMilestoneId != undefined) {
                        (0, utils_1.safeLog)(`Setting milestone of issue ${hydrated.number} to id ${+this.setMilestoneId}`);
                        await issue.setMilestone(+this.setMilestoneId);
                    }
                    if (removeLabelsSet.length > 0) {
                        for (const removeLabel of removeLabelsSet) {
                            if (removeLabel && removeLabel.length > 0) {
                                (0, utils_1.safeLog)(`Removing label on issue ${hydrated.number}: ${removeLabel}`);
                                await issue.removeLabel(removeLabel);
                            }
                        }
                    }
                    if (addLabelsSet.length > 0) {
                        for (const addLabel of addLabelsSet) {
                            if (addLabel && addLabel.length > 0) {
                                (0, utils_1.safeLog)(`Adding label on issue ${hydrated.number}: ${addLabel}`);
                                await issue.addLabel(addLabel);
                            }
                        }
                    }
                    if (this.reopenComment) {
                        (0, utils_1.safeLog)(`Posting comment to issue ${hydrated.number}.`);
                        await issue.postComment(this.reopenComment);
                    }
                }
                else {
                    if (hydrated.locked) {
                        (0, utils_1.safeLog)(`Issue ${hydrated.number} is locked. Ignoring`);
                    }
                    else if (!this.alsoApplyToOpenIssues && hydrated.open) {
                        (0, utils_1.safeLog)(`Issue ${hydrated.number} is open. Ignoring`);
                    }
                }
            }));
        }
    }
}
exports.Reopener = Reopener;
//# sourceMappingURL=Reopener.js.map