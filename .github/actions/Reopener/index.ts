/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { OctoKit } from '../api/octokit';
import { getInput, getRequiredInput } from '../common/utils';
import { Reopener } from './Reopener';
import { Action } from '../common/Action';

class ReopenerAction extends Action {
	id = 'Reopener';

	async onTriggered(github: OctoKit) {
		const alsoApplyToOpenIssues: string | undefined = getInput('alsoApplyToOpenIssues');
		await new Reopener(
			github,
			alsoApplyToOpenIssues != undefined && alsoApplyToOpenIssues.toLowerCase() == 'true',
			getInput('addLabels') || undefined,
			getInput('removeLabels') || undefined,
			getInput('reopenComment') || '',
			getInput('setMilestoneId') || undefined,
			getInput('labels') || undefined,
			getInput('milestoneName') || undefined,
			getInput('milestoneId') || undefined,
			getInput('ignoreLabels') || undefined,
			getInput('ignoreMilestoneNames') || undefined,
			getInput('ignoreMilestoneIds') || undefined,
			+(getInput('minimumVotes') || 0),
			+(getInput('maximumVotes') || 9999999)
		).run();
	}
}

new ReopenerAction().run(); // eslint-disable-line
