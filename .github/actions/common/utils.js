"use strict";
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
Object.defineProperty(exports, "__esModule", { value: true });
exports.safeLog = exports.logErrorToIssue = exports.errorLoggingIssue = exports.getRateLimit = exports.daysAgoToHumanReadbleDate = exports.daysAgoToTimestamp = exports.loadLatestRelease = exports.normalizeIssue = exports.getRequiredInput = exports.getInput = void 0;
const core = require("@actions/core");
const github_1 = require("@actions/github");
const axios_1 = require("axios");
const octokit_1 = require("../api/octokit");
const getInput = (name) => core.getInput(name) || undefined;
exports.getInput = getInput;
const getRequiredInput = (name) => core.getInput(name, { required: true });
exports.getRequiredInput = getRequiredInput;
const normalizeIssue = (issue) => {
    let { body, title } = issue;
    body = body !== null && body !== void 0 ? body : '';
    title = title !== null && title !== void 0 ? title : '';
    const isBug = body.includes('bug_report_template') || /Issue Type:.*Bug.*/.test(body);
    const isFeatureRequest = body.includes('feature_request_template') || /Issue Type:.*Feature Request.*/.test(body);
    const cleanse = (str) => {
        let out = str
            .toLowerCase()
            .replace(/<!--.*-->/gu, '')
            .replace(/.* version: .*/gu, '')
            .replace(/issue type: .*/gu, '')
            .replace(/vs ?code/gu, '')
            .replace(/we have written.*please paste./gu, '')
            .replace(/steps to reproduce:/gu, '')
            .replace(/does this issue occur when all extensions are disabled.*/gu, '')
            .replace(/!?\[[^\]]*\]\([^)]*\)/gu, '')
            .replace(/\s+/gu, ' ')
            .replace(/```[^`]*?```/gu, '');
        while (out.includes(`<details>`) &&
            out.includes('</details>') &&
            out.indexOf(`</details>`) > out.indexOf(`<details>`)) {
            out = out.slice(0, out.indexOf('<details>')) + out.slice(out.indexOf(`</details>`) + 10);
        }
        return out;
    };
    return {
        body: cleanse(body),
        title: cleanse(title),
        issueType: isBug ? 'bug' : isFeatureRequest ? 'feature_request' : 'unknown',
    };
};
exports.normalizeIssue = normalizeIssue;
const loadLatestRelease = async (quality) => (await axios_1.default.get(`https://update.code.visualstudio.com/api/update/darwin/${quality}/latest`)).data;
exports.loadLatestRelease = loadLatestRelease;
const daysAgoToTimestamp = (days) => +new Date(Date.now() - days * 24 * 60 * 60 * 1000);
exports.daysAgoToTimestamp = daysAgoToTimestamp;
const daysAgoToHumanReadbleDate = (days) => new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().replace(/\.\d{3}\w$/, '');
exports.daysAgoToHumanReadbleDate = daysAgoToHumanReadbleDate;
const getRateLimit = async (token) => {
    const usageData = (await (0, github_1.getOctokit)(token).rest.rateLimit.get()).data.resources;
    const usage = {};
    ['core', 'graphql', 'search'].forEach(async (category) => {
        var _a, _b, _c, _d;
        if (usageData[category]) {
            usage[category] = 1 - ((_b = (_a = usageData[category]) === null || _a === void 0 ? void 0 : _a.remaining) !== null && _b !== void 0 ? _b : 0) / ((_d = (_c = usageData[category]) === null || _c === void 0 ? void 0 : _c.limit) !== null && _d !== void 0 ? _d : 1);
        }
    });
    return usage;
};
exports.getRateLimit = getRateLimit;
exports.errorLoggingIssue = (() => {
    try {
        const repo = github_1.context.repo.owner.toLowerCase() + '/' + github_1.context.repo.repo.toLowerCase();
        if (repo === 'microsoft/vscode' || repo === 'microsoft/vscode-remote-release') {
            return { repo: 'vscode', owner: 'Microsoft', issue: 93814 };
        }
        else if (/microsoft\//.test(repo)) {
            return { repo: 'vscode-internalbacklog', owner: 'Microsoft', issue: 974 };
        }
        else if ((0, exports.getInput)('errorLogIssueNumber')) {
            return { ...github_1.context.repo, issue: +(0, exports.getRequiredInput)('errorLogIssueNumber') };
        }
        else {
            return undefined;
        }
    }
    catch (e) {
        console.error(e);
        return undefined;
    }
})();
const logErrorToIssue = async (message, ping, token) => {
    var _a;
    // Attempt to wait out abuse detection timeout if present
    await new Promise((resolve) => setTimeout(resolve, 10000));
    const dest = exports.errorLoggingIssue;
    if (!dest)
        return console.log('no error logging repo defined. swallowing error.');
    return new octokit_1.OctoKitIssue(token, { owner: dest.owner, repo: dest.repo }, { number: dest.issue })
        .postComment(`
Workflow: ${github_1.context.workflow}

Error: ${message}

Issue: ${ping ? `${github_1.context.repo.owner}/${github_1.context.repo.repo}#` : ''}${(_a = github_1.context.issue) === null || _a === void 0 ? void 0 : _a.number}

Repo: ${github_1.context.repo.owner}/${github_1.context.repo.repo}

<!-- Context:
${JSON.stringify(github_1.context, null, 2)
        .replace(/<!--/gu, '<@--')
        .replace(/-->/gu, '--@>')
        .replace(/\/|\\/gu, 'slash-')}
-->
`);
};
exports.logErrorToIssue = logErrorToIssue;
const safeLog = (message, ...args) => {
    const clean = (val) => ('' + val).replace(/:|#/g, '');
    console.log(clean(message), ...args.map(clean));
};
exports.safeLog = safeLog;
//# sourceMappingURL=utils.js.map