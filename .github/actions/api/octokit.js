"use strict";
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
Object.defineProperty(exports, "__esModule", { value: true });
exports.OctoKitIssue = exports.OctoKit = exports.getNumRequests = void 0;
const core_1 = require("@actions/core");
const github_1 = require("@actions/github");
const child_process_1 = require("child_process");
let numRequests = 0;
exports.getNumRequests = () => numRequests;
class OctoKit {
    constructor(token, params, options = { readonly: false }) {
        this.token = token;
        this.params = params;
        this.options = options;
        // when in readonly mode, record labels just-created so at to not throw unneccesary errors
        this.mockLabels = new Set();
        this.writeAccessCache = {};
        this._octokit = new github_1.GitHub(token);
    }
    get octokit() {
        numRequests++;
        return this._octokit;
    }
    // TODO: just iterate over the issues in a page here instead of making caller do it
    async *query(query) {
        const q = query.q + ` repo:${this.params.owner}/${this.params.repo}`;
        console.log(`Querying for ${q}:`);
        const options = this.octokit.search.issuesAndPullRequests.endpoint.merge({
            ...query,
            q,
            per_page: 100,
            headers: { Accept: 'application/vnd.github.squirrel-girl-preview+json' },
        });
        let pageNum = 0;
        const timeout = async () => {
            if (pageNum < 2) {
                /* pass */
            }
            else if (pageNum < 4) {
                await new Promise((resolve) => setTimeout(resolve, 3000));
            }
            else {
                await new Promise((resolve) => setTimeout(resolve, 30000));
            }
        };
        for await (const pageResponse of this.octokit.paginate.iterator(options)) {
            await timeout();
            numRequests++;
            const page = pageResponse.data;
            console.log(`Page ${++pageNum}: ${page.map(({ number }) => number).join(' ')}`);
            yield page.map((issue) => new OctoKitIssue(this.token, this.params, this.octokitIssueToIssue(issue), this.options));
        }
    }
    async createIssue(owner, repo, title, body) {
        core_1.debug(`Creating issue \`${title}\` on ${owner}/${repo}`);
        if (!this.options.readonly)
            await this.octokit.issues.create({ owner, repo, title, body });
    }
    octokitIssueToIssue(issue) {
        var _a, _b, _c, _d, _e, _f;
        return {
            author: { name: issue.user.login, isGitHubApp: issue.user.type === 'Bot' },
            body: issue.body,
            number: issue.number,
            title: issue.title,
            labels: issue.labels.map((label) => label.name),
            open: issue.state === 'open',
            locked: issue.locked,
            numComments: issue.comments,
            reactions: issue.reactions,
            assignee: (_b = (_a = issue.assignee) === null || _a === void 0 ? void 0 : _a.login) !== null && _b !== void 0 ? _b : (_d = (_c = issue.assignees) === null || _c === void 0 ? void 0 : _c[0]) === null || _d === void 0 ? void 0 : _d.login,
            milestoneId: (_f = (_e = issue.milestone) === null || _e === void 0 ? void 0 : _e.number) !== null && _f !== void 0 ? _f : null,
            createdAt: +new Date(issue.created_at),
            updatedAt: +new Date(issue.updated_at),
            closedAt: issue.closed_at ? +new Date(issue.closed_at) : undefined,
        };
    }
    async hasWriteAccess(user) {
        if (user.name in this.writeAccessCache) {
            core_1.debug('Got permissions from cache for ' + user);
            return this.writeAccessCache[user.name];
        }
        core_1.debug('Fetching permissions for ' + user);
        const permissions = (await this.octokit.repos.getCollaboratorPermissionLevel({
            ...this.params,
            username: user.name,
        })).data.permission;
        return (this.writeAccessCache[user.name] = permissions === 'admin' || permissions === 'write');
    }
    async repoHasLabel(name) {
        try {
            await this.octokit.issues.getLabel({ ...this.params, name });
            return true;
        }
        catch (err) {
            if (err.status === 404) {
                return this.options.readonly && this.mockLabels.has(name);
            }
            throw err;
        }
    }
    async createLabel(name, color, description) {
        core_1.debug('Creating label ' + name);
        if (!this.options.readonly)
            await this.octokit.issues.createLabel({ ...this.params, color, description, name });
        else
            this.mockLabels.add(name);
    }
    async deleteLabel(name) {
        core_1.debug('Deleting label ' + name);
        try {
            if (!this.options.readonly)
                await this.octokit.issues.deleteLabel({ ...this.params, name });
        }
        catch (err) {
            if (err.status === 404) {
                return;
            }
            throw err;
        }
    }
    async readConfig(path) {
        core_1.debug('Reading config at ' + path);
        const repoPath = `.github/${path}.json`;
        try {
            const data = (await this.octokit.repos.getContents({ ...this.params, path: repoPath })).data;
            if ('type' in data && data.type === 'file') {
                if (data.encoding === 'base64' && data.content) {
                    return JSON.parse(Buffer.from(data.content, 'base64').toString('utf-8'));
                }
                throw Error(`Could not read contents "${data.content}" in encoding "${data.encoding}"`);
            }
            throw Error('Found directory at config path when expecting file' + JSON.stringify(data));
        }
        catch (e) {
            throw Error('Error with config file at ' + repoPath + ': ' + JSON.stringify(e));
        }
    }
    async releaseContainsCommit(release, commit) {
        return new Promise((resolve, reject) => child_process_1.exec(`git -C ./repo merge-base --is-ancestor ${commit} ${release}`, (err) => {
            if (!err || err.code === 1) {
                resolve(!err ? 'yes' : 'no');
            }
            else if (err.message.includes(`Not a valid commit name ${release}`)) {
                // release branch is forked. Probably in endgame. Not released.
                resolve('no');
            }
            else if (err.message.includes(`Not a valid commit name ${commit}`)) {
                // commit is probably in a different repo.
                resolve('unknown');
            }
            else {
                reject(err);
            }
        }));
    }
    async dispatch(title) {
        core_1.debug('Dispatching ' + title);
        if (!this.options.readonly)
            await this.octokit.repos.createDispatchEvent({ ...this.params, event_type: title });
    }
}
exports.OctoKit = OctoKit;
class OctoKitIssue extends OctoKit {
    constructor(token, params, issueData, options = { readonly: false }) {
        super(token, params, options);
        this.params = params;
        this.issueData = issueData;
        console.log('running bot on issue', issueData.number);
    }
    async addAssignee(assignee) {
        core_1.debug('Adding assignee ' + assignee + ' to ' + this.issueData.number);
        if (!this.options.readonly) {
            await this.octokit.issues.addAssignees({
                ...this.params,
                issue_number: this.issueData.number,
                assignees: [assignee],
            });
        }
    }
    async removeAssignee(assignee) {
        core_1.debug('Removing assignee ' + assignee + ' to ' + this.issueData.number);
        if (!this.options.readonly) {
            await this.octokit.issues.removeAssignees({
                ...this.params,
                issue_number: this.issueData.number,
                assignees: [assignee],
            });
        }
    }
    async closeIssue() {
        core_1.debug('Closing issue ' + this.issueData.number);
        if (!this.options.readonly)
            await this.octokit.issues.update({
                ...this.params,
                issue_number: this.issueData.number,
                state: 'closed',
            });
    }
    async reopenIssue() {
        core_1.debug('Reopening issue ' + this.issueData.number);
        if (!this.options.readonly)
            await this.octokit.issues.update({
                ...this.params,
                issue_number: this.issueData.number,
                state: 'open',
            });
    }
    async lockIssue() {
        core_1.debug('Locking issue ' + this.issueData.number);
        if (!this.options.readonly)
            await this.octokit.issues.lock({ ...this.params, issue_number: this.issueData.number });
    }
    async getIssue() {
        if (isIssue(this.issueData)) {
            core_1.debug('Got issue data from query result ' + this.issueData.number);
            return this.issueData;
        }
        console.log('Fetching issue ' + this.issueData.number);
        const issue = (await this.octokit.issues.get({
            ...this.params,
            issue_number: this.issueData.number,
            mediaType: { previews: ['squirrel-girl'] },
        })).data;
        return (this.issueData = this.octokitIssueToIssue(issue));
    }
    async postComment(body) {
        core_1.debug(`Posting comment ${body} on ${this.issueData.number}`);
        if (!this.options.readonly)
            await this.octokit.issues.createComment({
                ...this.params,
                issue_number: this.issueData.number,
                body,
            });
    }
    async deleteComment(id) {
        core_1.debug(`Deleting comment ${id} on ${this.issueData.number}`);
        if (!this.options.readonly)
            await this.octokit.issues.deleteComment({
                owner: this.params.owner,
                repo: this.params.repo,
                comment_id: id,
            });
    }
    async setMilestone(milestoneId) {
        core_1.debug(`Setting milestone for ${this.issueData.number} to ${milestoneId}`);
        if (!this.options.readonly)
            await this.octokit.issues.update({
                ...this.params,
                issue_number: this.issueData.number,
                milestone: milestoneId,
            });
    }
    async *getComments(last) {
        core_1.debug('Fetching comments for ' + this.issueData.number);
        const response = this.octokit.paginate.iterator(this.octokit.issues.listComments.endpoint.merge({
            ...this.params,
            issue_number: this.issueData.number,
            per_page: 100,
            ...(last ? { per_page: 1, page: (await this.getIssue()).numComments } : {}),
        }));
        for await (const page of response) {
            numRequests++;
            yield page.data.map((comment) => ({
                author: { name: comment.user.login, isGitHubApp: comment.user.type === 'Bot' },
                body: comment.body,
                id: comment.id,
                timestamp: +new Date(comment.created_at),
            }));
        }
    }
    async addLabel(name) {
        core_1.debug(`Adding label ${name} to ${this.issueData.number}`);
        if (!(await this.repoHasLabel(name))) {
            throw Error(`Action could not execute becuase label ${name} is not defined.`);
        }
        if (!this.options.readonly)
            await this.octokit.issues.addLabels({
                ...this.params,
                issue_number: this.issueData.number,
                labels: [name],
            });
    }
    async getAssigner(assignee) {
        const options = this.octokit.issues.listEventsForTimeline.endpoint.merge({
            ...this.params,
            issue_number: this.issueData.number,
        });
        let assigner;
        for await (const event of this.octokit.paginate.iterator(options)) {
            numRequests++;
            const timelineEvents = event.data;
            for (const timelineEvent of timelineEvents) {
                if (timelineEvent.event === 'assigned' &&
                    timelineEvent.assignee.login === assignee) {
                    assigner = timelineEvent.actor.login;
                }
            }
        }
        if (!assigner) {
            throw Error('Expected to find ' + assignee + ' in issue timeline but did not.');
        }
        return assigner;
    }
    async removeLabel(name) {
        core_1.debug(`Removing label ${name} from ${this.issueData.number}`);
        try {
            if (!this.options.readonly)
                await this.octokit.issues.removeLabel({
                    ...this.params,
                    issue_number: this.issueData.number,
                    name,
                });
        }
        catch (err) {
            if (err.status === 404) {
                console.log(`Label ${name} not found on issue`);
                return;
            }
            throw err;
        }
    }
    async getClosingInfo(alreadyChecked = []) {
        var _a, _b, _c, _d, _e, _f, _g;
        if (alreadyChecked.includes(this.issueData.number)) {
            return undefined;
        }
        alreadyChecked.push(this.issueData.number);
        if ((await this.getIssue()).open) {
            return;
        }
        const closingHashComment = /(?:\\|\/)closedWith (\S*)/;
        const options = this.octokit.issues.listEventsForTimeline.endpoint.merge({
            ...this.params,
            issue_number: this.issueData.number,
        });
        let closingCommit;
        const crossReferencing = [];
        for await (const event of this.octokit.paginate.iterator(options)) {
            numRequests++;
            const timelineEvents = event.data;
            for (const timelineEvent of timelineEvents) {
                if ((timelineEvent.event === 'closed' || timelineEvent.event === 'merged') &&
                    timelineEvent.commit_id &&
                    timelineEvent.commit_url
                        .toLowerCase()
                        .includes(`/${this.params.owner}/${this.params.repo}/`.toLowerCase())) {
                    closingCommit = {
                        hash: timelineEvent.commit_id,
                        timestamp: +new Date(timelineEvent.created_at),
                    };
                }
                if (timelineEvent.event === 'reopened') {
                    closingCommit = undefined;
                }
                if (timelineEvent.event === 'commented' &&
                    !((_a = timelineEvent.body) === null || _a === void 0 ? void 0 : _a.includes('UNABLE_TO_LOCATE_COMMIT_MESSAGE')) &&
                    closingHashComment.test(timelineEvent.body)) {
                    closingCommit = {
                        hash: closingHashComment.exec(timelineEvent.body)[1],
                        timestamp: +new Date(timelineEvent.created_at),
                    };
                }
                if (timelineEvent.event === 'cross-referenced' && ((_c = (_b = timelineEvent.source) === null || _b === void 0 ? void 0 : _b.issue) === null || _c === void 0 ? void 0 : _c.number) && ((_f = (_e = (_d = timelineEvent.source) === null || _d === void 0 ? void 0 : _d.issue) === null || _e === void 0 ? void 0 : _e.pull_request) === null || _f === void 0 ? void 0 : _f.url.includes(`/${this.params.owner}/${this.params.repo}/`.toLowerCase()))) {
                    crossReferencing.push(timelineEvent.source.issue.number);
                }
            }
        }
        // If we dont have any closing info, try to get it from linked issues (PRs).
        // If there's a linked issue that was closed at almost the same time, guess it was a PR that closed this.
        if (!closingCommit) {
            for (const id of crossReferencing.reverse()) {
                const closed = await new OctoKitIssue(this.token, this.params, {
                    number: id,
                }, this.options).getClosingInfo(alreadyChecked);
                if (closed) {
                    if (Math.abs(closed.timestamp - ((_g = (await this.getIssue()).closedAt) !== null && _g !== void 0 ? _g : 0)) < 5000) {
                        closingCommit = closed;
                        break;
                    }
                }
            }
        }
        console.log(`Got ${JSON.stringify(closingCommit)} as closing commit of ${this.issueData.number}`);
        return closingCommit;
    }
}
exports.OctoKitIssue = OctoKitIssue;
function isIssue(object) {
    const isIssue = 'author' in object &&
        'body' in object &&
        'title' in object &&
        'labels' in object &&
        'open' in object &&
        'locked' in object &&
        'number' in object &&
        'numComments' in object &&
        'reactions' in object &&
        'milestoneId' in object;
    return isIssue;
}
//# sourceMappingURL=octokit.js.map