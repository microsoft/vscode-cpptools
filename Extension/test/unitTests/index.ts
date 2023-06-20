import * as glob from 'glob';
import * as Mocha from 'mocha';
import * as path from 'path';
const MochaTest = (Mocha as any) as (new (options?: Mocha.MochaOptions) => Mocha);

export function run(): Promise<void> {
    // Create the mocha test
    const mocha = new MochaTest({
        ui: 'tdd',
        color: true
    });

    const testsRoot = __dirname;

    return new Promise((c, e) => {
        glob('**/**.test.js', { cwd: testsRoot }, (err, files) => {
            if (err) {
                return e(err);
            }

            // Add files to the test suite
            files.forEach(f => mocha.addFile(path.resolve(testsRoot, f)));

            try {
                // Run the mocha test
                mocha.timeout(100000);
                mocha.run(failures => {
                    if (failures > 0) {
                        e(new Error(`${failures} tests failed.`));
                    } else {
                        c();
                    }
                });
            } catch (err) {
                e(err);
            }
        });
    });
}
