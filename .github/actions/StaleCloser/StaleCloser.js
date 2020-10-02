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
    constructor(github, closeDays, labels, closeComment, pingDays, pingComment, additionalTeam, addLabels, milestoneName, milestoneId, ignoreLabels, ignoreMilestoneNames, ignoreMilestoneIds, minimumVotes, maximumVotes) {
        super(labels, milestoneName, milestoneId, ignoreLabels, ignoreMilestoneNames, ignoreMilestoneIds, minimumVotes, maximumVotes);
        this.github = github;
        this.closeDays = closeDays;
        this.closeComment = closeComment;
        this.pingDays = pingDays;
        this.pingComment = pingComment;
        this.additionalTeam = additionalTeam;
        this.addLabels = addLabels;
    }
    async run() {
        const updatedTimestamp = utils_1.daysAgoToHumanReadbleDate(this.closeDays);
        const pingTimestamp = this.pingDays ? utils_1.daysAgoToTimestamp(this.pingDays) : undefined;
        const query = this.buildQuery((this.closeDays ? `updated:<${updatedTimestamp} ` : "") + "is:open is:unlocked");
        const addLabelsSet = this.addLabels ? this.addLabels.split(',') : [];
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
                        // TODO: List the collaborators once per go rather than checking a single user each issue
                        (pingTimestamp != undefined &&
                            (this.additionalTeam.includes(lastComment.author.name) ||
                                (await issue.hasWriteAccess(lastComment.author))))) {
                        if (lastComment) {
                            console.log(`Last comment on ${hydrated.number} by ${lastComment.author.name}. Closing.`);
                        }
                        else {
                            console.log(`No comments on ${hydrated.number}. Closing.`);
                        }
                        if (this.closeComment) {
                            await issue.postComment(this.closeComment);
                        }
                        if (addLabelsSet.length > 0) {
                            for (const addLabel of addLabelsSet) {
                                if (addLabel && addLabel.length > 0) {
                                    console.log(`Adding label on ${hydrated.number}: ${addLabel}`);
                                    await issue.addLabel(addLabel);
                                }
                            }
                        }
                        console.log(`Closing ${hydrated.number}.`);
                        await issue.closeIssue();
                    }
                    else if (pingTimestamp != undefined) {
                        // Ping 
                        if (hydrated.updatedAt < pingTimestamp && hydrated.assignee) {
                            console.log(`Last comment on ${hydrated.number} by ${lastComment.author.name}. Pinging @${hydrated.assignee}`);
                            if (this.pingComment) {
                                await issue.postComment(this.pingComment
                                    .replace('${assignee}', hydrated.assignee)
                                    .replace('${author}', hydrated.author.name));
                            }
                        }
                        else {
                            console.log(`Last comment on ${hydrated.number} by ${lastComment.author.name}. Skipping.${hydrated.assignee ? ' cc @' + hydrated.assignee : ''}`);
                        }
                    }
                }
                else {
                    console.log('Query returned an invalid issue:' +
                        JSON.stringify({ ...hydrated, body: 'stripped' }));
                }
            }
        }
    }
}
exports.StaleCloser = StaleCloser;
//# sourceMappingURL=StaleCloser.js.map