/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { getOctokit } from '@actions/github';

type Rest = ReturnType<typeof getOctokit>['rest'];

// This file is just to re-export some octokit types as nicer names

export type ActionsListWorkflowRunsResponseWorkflowRunsItem =
	Awaited<ReturnType<Rest['actions']['listWorkflowRuns']>>['data']['workflow_runs'][0];

export type IssueGetResponse = Awaited<ReturnType<Rest['issues']['get']>>['data'];

export type IssueSearchResult =
	Awaited<ReturnType<Rest['search']['issuesAndPullRequests']>>['data']['items'][0];

export type IssuesGetResponseMilestone = IssueGetResponse['milestone'];
