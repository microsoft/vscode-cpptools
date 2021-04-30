'use strict'

const fs = require("fs-extra");
const cp = require("child_process");
const Octokit = require('@octokit/rest')
const path = require('path');

const branchName = 'localization';
const mergeTo = 'main';
const commitComment = 'Localization - Translated Strings';
const pullRequestTitle = '[Auto] Localization - Translated Strings';

let repoOwner = process.argv[2];
let repoName = process.argv[3];
let locProjectName = process.argv[4];
let authUser = process.argv[5];
let authToken = process.argv[6];
let userFullName = process.argv[7];
let userEmail = process.argv[8];
let locRepoPath = process.argv[9];

if (!repoOwner || !repoName || !locProjectName || !authUser || !authToken) {
    console.error(`ERROR: Usage: ${path.parse(process.argv[0]).base} ${path.parse(process.argv[1]).base} repo_owner repo_name loc_project_name auth_user auth_token user_full_name user_email loc_repo_path`);
    return;
}

console.log(`repoOwner=${repoOwner}`);
console.log(`repoName=${repoName}`);
console.log(`locProjectName=${locProjectName}`);
console.log(`authUser=${authUser}`);
console.log(`authToken=${authToken}`);
console.log(`locRepoPath=${locRepoPath}`);

function hasBranch(branchName) {
    console.log(`Checking for existance of branch "${branchName}" (git branch --list ${branchName})`);
    let output = cp.execSync(`git branch --list ${branchName}`);
    let lines = output.toString().split("\n");
    let found = false;
    lines.forEach(line => {
        found = found || (line === `  ${branchName}`);
    });

    return found;
}

function hasAnyChanges() {
    console.log("Checking if any files have changed (git status --porcelain)");
    let output = cp.execSync('git status --porcelain');
    let lines = output.toString().split("\n");
    let anyChanges = false;
    lines.forEach(line => {
        anyChanges = anyChanges || (line != '');
    });
    
    return anyChanges;
}

// When invoked on build server, we should already be in a repo freshly synced to the mergeTo branch

if (hasAnyChanges()) {
    console.log(`Changes already present in this repo!  This script is intended to be run against a freshly synced ${mergeTo} branch!`);
    return;
}

function sleep(ms) {
    var unixtime_ms = new Date().getTime();
    while(new Date().getTime() < unixtime_ms + ms) {}
}

console.log("This script is potentially DESTRUCTIVE!  Cancel now, or it will proceed in 10 seconds.");
sleep(10000);

let rootSourcePath = `${locRepoPath}\\Src\\VSCodeExt`;
let directories = fs.readdirSync(rootSourcePath, { withFileTypes: true }).filter(dirent => dirent.isDirectory()).map(dirent => dirent.name);
directories.forEach(folderName => {
    let sourcePath = `${rootSourcePath}\\${folderName}\\vscode-cpptools.xlf`;
    let destinationPath = `../vscode-translations-import/${folderName}/vscode-extensions/vscode-${locProjectName}.xlf`;
    console.log(`Copying "${sourcePath}" to "${destinationPath}"`);
    fs.copySync(sourcePath, destinationPath);
});


console.log("Import translations into i18n directory");
cp.execSync("npm run translations-import");

if (!hasAnyChanges()) {
    console.log("No changes detected");
    return;
}

console.log("Changes detected");

console.log(`Ensure main ref is up to date locally (git fetch)`);
cp.execSync('git fetch');

// Remove old localization branch, if any
if (hasBranch("localization")) {
	console.log(`Remove old localization branch, if any (git branch -D localization)`);
	cp.execSync('git branch -D localization');
}

// Check out local branch
console.log(`Creating local branch for changes (git checkout -b ${branchName})`);
cp.execSync('git checkout -b localization');

// Add changed files.
console.log("Adding changed file (git add .)");
cp.execSync('git add .');

// git add may have resolves CR/LF's and there may not be anything to commit
if (!hasAnyChanges()) {
    console.log("No changes detected.  The only changes must have been due to CR/LF's, and have been corrected.");
    return;
}

// Set up user and permissions(Never run this locally)
console.log(`Setting local user name to: "${userFullName}"`);
cp.execSync(`git config --local user.name "${userFullName}"`);

console.log(`Setting local user email to: "${userEmail}"`);
cp.execSync(`git config --local user.email "${userEmail}"`);

console.log(`Configuring git with permission to push and to create pull requests (git remote remove origin && git remote add origin https://${authUser}:${authToken}@github.com/${repoOwner}/${repoName}.git`);
cp.execSync('git remote remove origin');
cp.execSync(`git remote add origin https://${authUser}:${authToken}@github.com/${repoOwner}/${repoName}.git`);

// Commit changed files.
console.log(`Commiting changes (git commit -m "${commitComment}")`);
cp.execSync(`git commit -m "${commitComment}"`);

console.log(`pushing to remove branch (git push -f origin ${branchName})`);
cp.execSync(`git push -f origin ${branchName}`);

console.log("Checking if there is already a pull request...");
const octokit = new Octokit({auth: {
    username: authUser,
    password: authToken}
});
octokit.pulls.list({ owner: repoOwner, repo: repoName }).then(({data}) => {
    let alreadyHasPullRequest = false;
    if (data) {
        data.forEach((pr) => {
            alreadyHasPullRequest = alreadyHasPullRequest || (pr.title === pullRequestTitle);
        });
    }

    // If not already present, create a PR against our remote branch.
    if (!alreadyHasPullRequest) {
        console.log("There is not already a pull request.  Creating one.");
        octokit.pulls.create({ body:"", owner: repoOwner, repo: repoName, title: pullRequestTitle, head: branchName, base: mergeTo });
    } else {
        console.log("There is already a pull request.");
    }

    console.log(`Restoring default git permissions`);
    cp.execSync('git remote remove origin');
    cp.execSync(`git remote add origin https://github.com/${repoOwner}/${repoName}.git`);

    console.log(`Run 'git fetch' against updated remote`);
    cp.execSync('git fetch');

    console.log(`Switching back to main (git checkout main)`);
    cp.execSync('git checkout main');

    console.log(`Remove localization branch (git branch -D localization)`);
    cp.execSync('git branch -D localization');
});
