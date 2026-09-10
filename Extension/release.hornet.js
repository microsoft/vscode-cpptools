const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

// These are VSIX target identifiers, not npm's host CPU/OS installation filters.
const targets = Object.freeze([
    'win32-x64', 'win32-arm64', 'linux-x64', 'linux-arm64', 'linux-armhf',
    'darwin-x64', 'darwin-arm64', 'alpine-x64', 'alpine-arm64'
]);

function plan(args, manifest = require('./package.json')) {
    const options = { command: args[0], targets: ['universal'], preRelease: false, files: [], dryRun: false };
    for (let i = 1; i < args.length; i++) {
        switch (args[i]) {
            case '--all': options.targets = ['universal', ...targets]; break;
            case '--target': {
                const target = args[++i];
                if (target !== 'universal' && !targets.includes(target)) { throw new Error(`Unsupported target: ${target}`); }
                options.targets = [target]; break;
            }
            case '--pre-release': options.preRelease = true; break;
            case '--dry-run': options.dryRun = true; break;
            case '--vsix': {
                const file = args[++i];
                if (!file || !file.endsWith('.vsix')) { throw new Error('--vsix requires a VSIX file'); }
                options.files.push(path.resolve(file)); break;
            }
            default: throw new Error(`Unknown option: ${args[i]}`);
        }
    }
    if (!['package', 'marketplace', 'openvsx'].includes(options.command)) { throw new Error('Expected package, marketplace or openvsx'); }
    if (options.command !== 'package' && !options.files.length) { throw new Error('Publish an already reviewed package using --vsix <file>.'); }
    options.outputs = options.targets.map(target => ({ target,
        file: path.join('artifacts', `${manifest.name}-${manifest.version}-${target}${options.preRelease ? '-pre-release' : ''}.vsix`)
    }));
    return options;
}

function run(cli, args) {
    const result = spawnSync(process.execPath, [cli, ...args], { cwd: __dirname, stdio: 'inherit', shell: false, windowsHide: true });
    if (result.error) { throw result.error; }
    if (result.status !== 0) { throw new Error(`Release tool exited with ${result.status}`); }
}

function main(args) {
    const options = plan(args);
    if (options.dryRun) { console.log(JSON.stringify(options, null, 2)); return; }
    const vsce = path.join(path.dirname(require.resolve('@vscode/vsce/package.json')), 'vsce');
    if (options.command === 'package') {
        fs.mkdirSync(path.join(__dirname, 'artifacts'), { recursive: true });
        for (const output of options.outputs) {
            run(vsce, ['package', '--no-dependencies', '--no-yarn', '--out', output.file,
                ...(output.target === 'universal' ? [] : ['--target', output.target]), ...(options.preRelease ? ['--pre-release'] : [])]);
            run(path.join(__dirname, 'verify.hornet.js'), [output.file]);
        }
    } else {
        const tokenName = options.command === 'marketplace' ? 'VSCE_PAT' : 'OVSX_PAT';
        if (!process.env[tokenName]) { throw new Error(`Set ${tokenName} in the environment before publishing.`); }
        for (const file of options.files) { if (!fs.statSync(file).isFile()) { throw new Error(`Not a package: ${file}`); } }
        if (options.command === 'marketplace') {
            run(vsce, ['publish', '--packagePath', ...options.files]);
        } else {
            const directory = path.dirname(require.resolve('ovsx/package.json'));
            const manifest = require(path.join(directory, 'package.json'));
            const executable = typeof manifest.bin === 'string' ? manifest.bin : manifest.bin.ovsx;
            for (const file of options.files) { run(path.join(directory, executable), ['publish', file]); }
        }
    }
}

module.exports = { targets, plan };
if (require.main === module) {
    try { main(process.argv.slice(2)); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
