"use strict";
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
Object.defineProperty(exports, "__esModule", { value: true });
const utils_1 = require("../common/utils");
const StaleCloser_1 = require("./StaleCloser");
const Action_1 = require("../common/Action");
class StaleCloserAction extends Action_1.Action {
    constructor() {
        super(...arguments);
        this.id = 'StaleCloser';
    }
    async onTriggered(github) {
        var _a;
        await new StaleCloser_1.StaleCloser(github, +(0, utils_1.getRequiredInput)('closeDays'), (0, utils_1.getRequiredInput)('labels'), (0, utils_1.getInput)('closeComment') || '', +((0, utils_1.getInput)('pingDays') || 0), (0, utils_1.getInput)('pingComment') || '', ((_a = (0, utils_1.getInput)('additionalTeam')) !== null && _a !== void 0 ? _a : '').split(','), (0, utils_1.getInput)('addLabels') || undefined, (0, utils_1.getInput)('removeLabels') || undefined, (0, utils_1.getInput)('setMilestoneId') || undefined, (0, utils_1.getInput)('milestoneName') || undefined, (0, utils_1.getInput)('milestoneId') || undefined, (0, utils_1.getInput)('ignoreLabels') || undefined, (0, utils_1.getInput)('ignoreMilestoneNames') || undefined, (0, utils_1.getInput)('ignoreMilestoneIds') || undefined, +((0, utils_1.getInput)('minimumVotes') || 0), +((0, utils_1.getInput)('maximumVotes') || 9999999), (0, utils_1.getInput)('involves') || undefined).run();
    }
}
new StaleCloserAction().run(); // eslint-disable-line
//# sourceMappingURL=index.js.map