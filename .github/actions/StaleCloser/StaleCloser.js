"use strict";
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
Object.defineProperty(exports, "__esModule", { value: true });
exports.StaleCloser = void 0;
const ActionBase_1 = require("../common/ActionBase");
const utils_1 = require("../common/utils");
class StaleCloser extends ActionBase_1.ActionBase {
    constructor(github, closeDays, labels, closeComment, pingDays, pingComment, additionalTeam, addLabels, removeLabels, setMilestoneId, milestoneName, milestoneId, ignoreLabels, ignoreMilestoneNames, ignoreMilestoneIds, minimumVotes, maximumVotes, involves) {
        super(labels, milestoneName, milestoneId, ignoreLabels, ignoreMilestoneNames, ignoreMilestoneIds, minimumVotes, maximumVotes, involves);
        this.github = github;
        this.closeDays = closeDays;
        this.closeComment = closeComment;
        this.pingDays = pingDays;
        this.pingComment = pingComment;
        this.additionalTeam = additionalTeam;
        this.addLabels = addLabels;
        this.removeLabels = removeLabels;
        this.setMilestoneId = setMilestoneId;
    }
    async run() {
        const updatedTimestamp = (0, utils_1.daysAgoToHumanReadbleDate)(this.closeDays);
        const pingTimestamp = this.pingDays ? (0, utils_1.daysAgoToTimestamp)(this.pingDays) : undefined;
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
                    if (!lastComment ||
                        lastComment.author.isGitHubApp ||
                        pingTimestamp == undefined ||
                        // TODO: List the collaborators once per go rather than checking a single user each issue
                        this.additionalTeam.includes(lastComment.author.name) ||
                        await issue.hasWriteAccess(lastComment.author)) {
                        if (pingTimestamp != undefined) {
                            if (lastComment) {
                                (0, utils_1.safeLog)(`Last comment on issue ${hydrated.number} by ${lastComment.author.name}. Closing.`);
                            }
                            else {
                                (0, utils_1.safeLog)(`No comments on issue ${hydrated.number}. Closing.`);
                            }
                        }
                        if (this.closeComment) {
                            (0, utils_1.safeLog)(`Posting comment on issue ${hydrated.number}`);
                            await issue.postComment(this.closeComment);
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
                        await issue.closeIssue("not_planned");
                        if (this.setMilestoneId != undefined) {
                            (0, utils_1.safeLog)(`Setting milestone of issue ${hydrated.number} to id ${+this.setMilestoneId}`);
                            await issue.setMilestone(+this.setMilestoneId);
                        }
                        (0, utils_1.safeLog)(`Closing issue ${hydrated.number}.`);
                    }
                    else {
                        // Ping
                        if (hydrated.updatedAt < pingTimestamp && hydrated.assignee) {
                            (0, utils_1.safeLog)(`Last comment on issue ${hydrated.number} by ${lastComment.author.name}. Pinging @${hydrated.assignee}`);
                            if (this.pingComment) {
                                await issue.postComment(this.pingComment
                                    .replace('${assignee}', hydrated.assignee)
                                    .replace('${author}', hydrated.author.name));
                            }
                        }
                        else {
                            (0, utils_1.safeLog)(`Last comment on issue ${hydrated.number} by ${lastComment.author.name}. Skipping.${hydrated.assignee ? ' cc @' + hydrated.assignee : ''}`);
                        }
                    }
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
exports.StaleCloser = StaleCloser;
//# sourceMappingURL=StaleCloser.js.map