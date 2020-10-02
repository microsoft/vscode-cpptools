/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { OctoKit } from '../api/octokit'
import { getInput, getRequiredInput } from '../common/utils'
import { StaleCloser } from './StaleCloser'
import { Action } from '../common/Action'

class StaleCloserAction extends Action {
	id = 'StaleCloser'

	async onTriggered(github: OctoKit) {
		await new StaleCloser(
			github,
			+getRequiredInput('closeDays'),
			getRequiredInput('labels'),
			getInput('closeComment') || '',
			getInput('pingComment') || '',
			(getInput('additionalTeam') ?? '').split('|'),
			+getRequiredInput('pingDays'),
			getInput('addLabels') || undefined,
			getInput('milestoneName') || undefined,
			getInput('milestoneId') || undefined,
			getInput('ignoredLabels') || undefined,
			getInput('ignoredMilestoneNames') || undefined,
			getInput('ignoredMilestoneIds') || undefined,
			+(getInput('minimumVotes') || 0),
			+(getInput('maximumVotes') || 9999999)
		).run()
	}
}

new StaleCloserAction().run() // eslint-disable-line
