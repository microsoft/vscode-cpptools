/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { OctoKit } from '../api/octokit'
import { getInput, getRequiredInput } from '../common/utils'
import { AddCommentAndLabel } from './AddCommentAndLabel'
import { Action } from '../common/Action'

class AddCommentAndLabelAction extends Action {
	id = 'AddCommentAndLabel';

	async onTriggered(github: OctoKit) {
		await new AddCommentAndLabel(
			github,
			+(getInput('afterDays') || 0),
			getRequiredInput('labels'),
			getInput('addComment') || '',
			getInput('addLabels') || undefined,
			getInput('removeLabels') || undefined,
			getInput('setMilestoneId') || undefined,
			getInput('milestoneName') || undefined,
			getInput('milestoneId') || undefined,
			getInput('ignoreLabels') || undefined,
			getInput('ignoreMilestoneNames') || undefined,
			getInput('ignoreMilestoneIds') || undefined,
			+(getInput('minimumVotes') || 0),
			+(getInput('maximumVotes') || 9999999),
			getInput('involves') || undefined
		).run();
	}
}

new AddCommentAndLabelAction().run(); // eslint-disable-line