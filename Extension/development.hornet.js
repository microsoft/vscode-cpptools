const fs = require('fs');
const path = require('path');
const outputs = ['dist', 'out/hornet'];
const command = process.argv[2];
if (command === 'scripts') {
    for (const [name, script] of Object.entries(require('./package.json').scripts)) console.log(`${name}: ${script}`);
} else if (command === 'show' || command === 'clean') {
    for (const output of outputs) {
        const target = path.resolve(__dirname, output);
        const relative = path.relative(__dirname, target);
        if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('Build output escapes Extension');
        console.log(target);
        if (command === 'clean') fs.rmSync(target, { recursive: true, force: true });
    }
} else {
    throw new Error('Expected scripts, show or clean');
}
