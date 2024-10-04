"use strict";
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
Object.defineProperty(exports, "__esModule", { value: true });
const utils_1 = require("../common/utils");
const AddComment_1 = require("./AddComment");
const Action_1 = require("../common/Action");
class AddCommentAction extends Action_1.Action {
    constructor() {
        super(...arguments);
        this.id = 'AddComment';
    }
    async onTriggered(github) {
        await new AddComment_1.AddComment(github, (0, utils_1.getInput)('createdAfter') || undefined, +((0, utils_1.getInput)('afterDays') || 0), (0, utils_1.getRequiredInput)('labels'), (0, utils_1.getInput)('addComment') || '', (0, utils_1.getInput)('addLabels') || undefined, (0, utils_1.getInput)('removeLabels') || undefined, (0, utils_1.getInput)('setMilestoneId') || undefined, (0, utils_1.getInput)('milestoneName') || undefined, (0, utils_1.getInput)('milestoneId') || undefined, (0, utils_1.getInput)('ignoreLabels') || undefined, (0, utils_1.getInput)('ignoreMilestoneNames') || undefined, (0, utils_1.getInput)('ignoreMilestoneIds') || undefined, +((0, utils_1.getInput)('minimumVotes') || 0), +((0, utils_1.getInput)('maximumVotes') || 9999999), (0, utils_1.getInput)('involves') || undefined).run();
    }
}
new AddCommentAction().run(); // eslint-disable-line
//# sourceMappingURL=index.js.map