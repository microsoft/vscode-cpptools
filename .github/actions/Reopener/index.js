"use strict";
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
Object.defineProperty(exports, "__esModule", { value: true });
const utils_1 = require("../common/utils");
const Reopener_1 = require("./Reopener");
const Action_1 = require("../common/Action");
class ReopenerAction extends Action_1.Action {
    constructor() {
        super(...arguments);
        this.id = 'Locker';
    }
    async onTriggered(github) {
        const alsoApplyToOpenIssues = utils_1.getInput('alsoApplyToOpenIssues');
        await new Reopener_1.Reopener(github, alsoApplyToOpenIssues != undefined && alsoApplyToOpenIssues.toLowerCase() == 'true', utils_1.getInput('addLabels') || undefined, utils_1.getInput('removeLabels') || undefined, utils_1.getInput('reopenComment') || '', utils_1.getInput('setMilestoneId') || undefined, utils_1.getInput('labels') || undefined, utils_1.getInput('milestoneName') || undefined, utils_1.getInput('milestoneId') || undefined, utils_1.getInput('ignoreLabels') || undefined, utils_1.getInput('ignoreMilestoneNames') || undefined, utils_1.getInput('ignoreMilestoneIds') || undefined, +(utils_1.getInput('minimumVotes') || 0), +(utils_1.getInput('maximumVotes') || 9999999)).run();
    }
}
new ReopenerAction().run(); // eslint-disable-line
//# sourceMappingURL=index.js.map