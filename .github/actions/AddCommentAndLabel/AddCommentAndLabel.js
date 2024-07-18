"use strict";
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
Object.defineProperty(exports, "__esModule", { value: true });
exports.AddCommentAndLabel = void 0;
const ActionBase_1 = require("../common/ActionBase");
const utils_1 = require("../common/utils");
class AddCommentAndLabel extends ActionBase_1.ActionBase {
    constructor(github, afterDays, labels, addComment, addLabels, removeLabels, setMilestoneId, milestoneName, milestoneId, ignoreLabels, ignoreMilestoneNames, ignoreMilestoneIds, minimumVotes, maximumVotes, involves) {
        super(labels, milestoneName, milestoneId, ignoreLabels, ignoreMilestoneNames, ignoreMilestoneIds, minimumVotes, maximumVotes, involves);
        this.github = github;
        this.afterDays = afterDays;
        this.addComment = addComment;
        this.addLabels = addLabels;
        this.removeLabels = removeLabels;
        this.setMilestoneId = setMilestoneId;
    }
    async run() {
        const afterTimestamp = (0, utils_1.daysAgoToHumanReadbleDate)(this.afterDays);
        const query = this.buildQuery((this.afterDays ? `updated:<${afterTimestamp} ` : "") + "is:open is:unlocked");
        const addLabelsSet = this.addLabels ? this.addLabels.split(',') : [];
        const removeLabelsSet = this.removeLabels ? this.removeLabels.split(',') : [];
        for await (const page of this.github.query({ q: query })) {
            for (const issue of page) {
                const hydrated = await issue.getIssue();
                if (hydrated.open && this.validateIssue(hydrated)
                // TODO: Verify updated timestamp
                ) {
                    if (this.addComment) {
                        (0, utils_1.safeLog)(`Posting comment on issue ${hydrated.number}`);
                        await issue.postComment(this.addComment);
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
                    if (this.setMilestoneId != undefined) {
                        (0, utils_1.safeLog)(`Setting milestone of issue ${hydrated.number} to id ${+this.setMilestoneId}`);
                        await issue.setMilestone(+this.setMilestoneId);
                    }
                    (0, utils_1.safeLog)(`Processing issue ${hydrated.number}.`);
                }
                else {
                    if (!hydrated.open) {
                        (0, utils_1.safeLog)(`Issue ${hydrated.number} is not open. Ignoring`);
                    }
                }
            }
        }
    }
}
exports.AddCommentAndLabel = AddCommentAndLabel;
//# sourceMappingURL=AddCommentAndLabel.js.map