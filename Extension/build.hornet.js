const esbuild = require('esbuild');
esbuild.build({
    entryPoints: ['src/hornet/extension.ts'],
    outfile: 'dist/hornet.js',
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node18',
    external: ['vscode'],
    sourcemap: true,
    metafile: true
}).then(result => {
    require('fs').writeFileSync('dist/hornet.meta.json', JSON.stringify(result.metafile, null, 2));
    require('./notices.hornet')(result.metafile);
}).catch(() => process.exit(1));
