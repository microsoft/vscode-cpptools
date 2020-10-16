"use strict";
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
Object.defineProperty(exports, "__esModule", { value: true });
exports.Locker = void 0;
const utils_1 = require("../common/utils");
const ActionBase_1 = require("../common/ActionBase");
class Locker extends ActionBase_1.ActionBase {
    constructor(github, daysSinceClose, daysSinceUpdate, labels, milestoneName, milestoneId, ignoreLabels, ignoreMilestoneNames, ignoreMilestoneIds, minimumVotes, maximumVotes) {
        super(labels, milestoneName, milestoneId, ignoreLabels, ignoreMilestoneNames, ignoreMilestoneIds, minimumVotes, maximumVotes);
        this.github = github;
        this.daysSinceClose = daysSinceClose;
        this.daysSinceUpdate = daysSinceUpdate;
    }
    async run() {
        const closedTimestamp = utils_1.daysAgoToHumanReadbleDate(this.daysSinceClose);
        const updatedTimestamp = utils_1.daysAgoToHumanReadbleDate(this.daysSinceUpdate);
        const query = this.buildQuery((this.daysSinceClose ? `closed:<${closedTimestamp} ` : "") + (this.daysSinceUpdate ? `updated:<${updatedTimestamp} ` : "") + "is:closed is:unlocked");
        for await (const page of this.github.query({ q: query })) {
            await Promise.all(page.map(async (issue) => {
                const hydrated = await issue.getIssue();
                if (!hydrated.locked && hydrated.open === false && this.validateIssue(hydrated)
                // TODO: Verify closed and updated timestamps
                ) {
                    console.log(`Locking issue ${hydrated.number}`);
                    await issue.lockIssue();
                }
                else {
                    if (hydrated.locked) {
                        console.log(`Issue ${hydrated.number} is already locked. Ignoring`);
                    }
                    else if (hydrated.open) {
                        console.log(`Issue ${hydrated.number} is open. Ignoring`);
                    }
                }
            }));
        }
    }
}
exports.Locker = Locker;
//# sourceMappingURL=Locker.js.map