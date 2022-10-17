"use strict";
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
Object.defineProperty(exports, "__esModule", { value: true });
const utils_1 = require("../common/utils");
const Locker_1 = require("./Locker");
const Action_1 = require("../common/Action");
class LockerAction extends Action_1.Action {
    constructor() {
        super(...arguments);
        this.id = 'Locker';
    }
    async onTriggered(github) {
        await new Locker_1.Locker(github, +(0, utils_1.getRequiredInput)('daysSinceClose'), +(0, utils_1.getRequiredInput)('daysSinceUpdate'), (0, utils_1.getInput)('labels') || undefined, (0, utils_1.getInput)('milestoneName') || undefined, (0, utils_1.getInput)('milestoneId') || undefined, (0, utils_1.getInput)('ignoreLabels') || undefined, (0, utils_1.getInput)('ignoreMilestoneNames') || undefined, (0, utils_1.getInput)('ignoreMilestoneIds') || undefined, +((0, utils_1.getInput)('minimumVotes') || 0), +((0, utils_1.getInput)('maximumVotes') || 9999999)).run();
    }
}
new LockerAction().run(); // eslint-disable-line
//# sourceMappingURL=index.js.map