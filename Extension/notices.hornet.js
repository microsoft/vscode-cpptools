const fs = require('fs');
const path = require('path');

// Derive notices from the actual bundle rather than the historical dependency list.
module.exports = function writeNotices(metafile) {
    const packages = new Set();
    for (const input of Object.keys(metafile.inputs)) {
        if (!input.startsWith('node_modules/')) continue;
        let directory = path.dirname(input);
        while (!fs.existsSync(path.join(directory, 'package.json'))) {
            const parent = path.dirname(directory);
            if (parent === directory) throw new Error(`Cannot identify dependency: ${input}`);
            directory = parent;
        }
        packages.add(directory);
    }
    let result = 'Hornet C/C++ third-party notices\n\nNo native binaries are included. clangd is installed separately.\n';
    for (const directory of [...packages].sort()) {
        const metadata = JSON.parse(fs.readFileSync(path.join(directory, 'package.json'), 'utf8'));
        const license = fs.readdirSync(directory).find(name => /^licen[cs]e(\.(txt|md))?$/i.test(name));
        if (!license) throw new Error(`Missing license for ${metadata.name}`);
        result += `\n${'='.repeat(72)}\n${metadata.name} ${metadata.version} (${metadata.license})\n\n`;
        result += fs.readFileSync(path.join(directory, license), 'utf8') + '\n';
    }
    fs.writeFileSync('ThirdPartyNotices.txt', result.trimEnd() + '\n');
};
