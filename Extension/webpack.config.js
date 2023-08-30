/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

//@ts-check

'use strict';

const path = require('path');

/**@type {import('webpack').Configuration}*/
const config = {
    target: 'node', // vscode extensions run in a Node.js-context 📖 -> https://webpack.js.org/configuration/node/


    // we now have two entries - one for the main entrypoint and one for the worker thread. 
    // we can webpack each one and they won't interfere with each other.
    entry: {
        main: {
            import: './src/main.ts',
            filename: 'main.js'
        },
        worker: {
            import: './src/ToolsetDetection/Service/worker.ts',
            filename: 'ToolsetDetection/Service/worker.js'
        },
    },

    // the entry point of this extension, 📖 -> https://webpack.js.org/configuration/entry-context/
    output: { // the bundle is stored in the 'dist' folder (check package.json), 📖 -> https://webpack.js.org/configuration/output/
        path: path.resolve(__dirname, 'dist', 'src'),
        libraryTarget: "commonjs2",
        devtoolModuleFilenameTemplate: "../[resource-path]",
    },
    node: {
        __dirname: false, // leave the __dirname behavior intact
    },
    devtool: 'source-map',
    externals: {
        vscode: "commonjs vscode" // the vscode-module is created on-the-fly and must be excluded. Add other modules that cannot be webpack'ed, 📖 -> https://webpack.js.org/configuration/externals/
    },
    resolve: { // support reading TypeScript and JavaScript files, 📖 -> https://github.com/TypeStrong/ts-loader
        extensions: ['.js', '.ts',],
        mainFields: ['main', 'module'],
    },
    module: {
        rules: [{
            test: /\.ts$/,
            exclude: /node_modules/,
            use: [{
                // configure TypeScript loader:
                // * enable sources maps for end-to-end source maps
                loader: 'ts-loader',
                options: {
                    compilerOptions: {
                        "inlineSourceMap": true,
                    }
                }
            }]
        }, {
            test: /.node$/,
            loader: 'node-loader',
        }]
    },
    optimization: {
        minimize: false
    },
    stats: {
        warnings: false
    }
}

module.exports = (env) => {
    if (env.vscode_nls) {
        // rewrite nls call when being asked for
        // @ts-ignore
        config.module.rules.unshift({
            loader: 'vscode-nls-dev/lib/webpack-loader',
            options: {
                base: `${__dirname}/src`
            }
        })
    }

    return config
};
