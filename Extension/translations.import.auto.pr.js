'use strict'

const fs = require("fs-extra");
const cp = require("child_process");
const Octokit = require('@octokit/rest')

const authUser = 'Colenmgc';    // TODO: Change to service account
const authPersonalAccessToken = "b63f2b4def8fbc951fa119bb800619e656350b03";
const repoOwner = 'microsoft';
const repoName = 'vscode-cpptools';
const title = '[Auto] Localization - Translated Strings';
const branchName = 'localization';
const commitComment = 'Localization - Translated Strings';
const projectName = 'cpptools';

if (!process.env.RunningOnAzureDevOps) {
    console.log("");
    console.log("!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!");
    console.log("!!!! WARNING: This script is intended to be run only by a dedicated build config. !!!!");
    console.log("!!!! Running this script locally WILL result in local changes being overwritten.  !!!!");
    console.log("!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!");
    return;
}

// When invoked on build service, we should already be in a repo freshly synced to master

// Read Latest.txt to build a path to the latest localization drop
let latestTxt = fs.readFileSync("\\\\simpleloc\\drops\\Drops\\vscode-extensions_2432\\Latest.txt")
let exp = /Build No:\s*(.*)(?!=\n)/gm;
let match = exp.exec(latestTxt.toString());
let versionString = match[1];

// Enumerate through each language, copying our xlf files to the location we import them from
let rootSourcePath = `\\\\simpleloc\\drops\\Drops\\vscode-extensions_2432\\${versionString}\\Localization\\locdrop\\bin`; 
let directories = fs.readdirSync(rootSourcePath);
directories.forEach(folderName => {
    let sourcePath = `${rootSourcePath}\\${folderName}\\Projects\\Src\\vscode-extensions\\vscode-${projectName}.${folderName}.xlf`;
    let destinationPath = `../vscode-translations-import/${folderName}/vscode-extensions/vscode-${projectName}.xlf`;
    console.log(`Copying "${sourcePath}$" to "${destinationPath}"`);
    fs.copySync(sourcePath, destinationPath);
});

// Import translations into i18n directory structure
cp.execSync("npm run translations-import", { stdio: [0, 1, 2] });

// Check if any files have changed (git status --porcelain)
let output = cp.execSync('git status --porcelain');
let lines = output.toString().split("\n");
let anyAddedOrModified = false;
lines.forEach(line => {
    anyAddedOrModified |= line[0] === 'A' | line[1] === 'M';
});

// If no files have been added or modified, we are done.
if (!anyAddedOrModified)
    return;

// Check out local branch
cp.execSync('git checkout -b localization');

// Add changed files.
cp.execSync('git add .');

// Commit changes files.
cp.execSync(`git commit -m "${commitComment}"`);

// Force push our changes to our own (permanent) remote branch.
cp.execSync(`git push -f origin localization`);

// Check if there is already an outstanding PR

const octokit = new Octokit({auth: {
    username: authUser,
    password: authPersonalAccessToken}
})

octokit.pulls.list({ owner, repo }).then(({data}) => {
    let alreadyHasPullRequest = false;
    if (data) {
        data.forEach((pr) => {
            alreadyHasPullRequest |= pr.title === title;
        });
    }

    // If not already present, create a PR against our remote branch.
    if (!alreadyHasPullRequest) {
        octokit.pulls.create({ body:"", owner: repoOwner, repo: repoName, title, head: branchName, base: "master" }).then(res => {
            console.log(res);
        }, res => {
            console.log(res);
        });
    }
});
