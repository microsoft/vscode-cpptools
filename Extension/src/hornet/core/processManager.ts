import { spawn, ChildProcessWithoutNullStreams } from 'node:child_process';

/** Every process is launched without a shell and owned until it exits. */
export class ProcessManager {
    private readonly children = new Set<ChildProcessWithoutNullStreams>();
    async spawn(binary: string, args: string[], cwd: string): Promise<ChildProcessWithoutNullStreams> {
        const child = spawn(binary, args, { cwd, shell: false, windowsHide: true, stdio: 'pipe', detached: process.platform !== 'win32' });
        this.children.add(child);
        child.once('exit', () => this.children.delete(child));
        return new Promise((resolve, reject) => {
            child.once('spawn', () => resolve(child));
            child.once('error', error => { this.children.delete(child); reject(error); });
        });
    }
    async stop(child: ChildProcessWithoutNullStreams): Promise<void> {
        if (child.exitCode !== null || child.signalCode !== null) { return; }
        const exited = new Promise<void>(resolve => child.once('exit', () => resolve()));
        if (process.platform === 'win32' && child.pid) {
            const taskkill = spawn('taskkill.exe', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true, shell: false });
            taskkill.on('error', () => child.kill());
            taskkill.on('exit', code => { if (code) { child.kill(); } });
        } else if (child.pid) {
            try { process.kill(-child.pid, 'SIGTERM'); } catch { child.kill(); }
        }
        await Promise.race([exited, new Promise<void>(resolve => {
            const timer = setTimeout(() => {
                if (child.exitCode === null && child.signalCode === null) {
                    try { if (process.platform !== 'win32' && child.pid) { process.kill(-child.pid, 'SIGKILL'); } else { child.kill('SIGKILL'); } } catch { /* Already exited. */ }
                }
                resolve();
            }, 2000);
            timer.unref();
            child.once('exit', () => { clearTimeout(timer); resolve(); });
        })]);
    }
    async run(binary: string, args: string[], cwd: string, log: (text: string) => void, timeout = 120000): Promise<void> {
        const child = await this.spawn(binary, args, cwd);
        child.stdout.on('data', data => log(String(data)));
        child.stderr.on('data', data => log(String(data)));
        await new Promise<void>((resolve, reject) => {
            const timer = setTimeout(() => { void this.stop(child); reject(new Error(`${binary} timed out`)); }, timeout);
            child.once('error', error => { clearTimeout(timer); reject(error); });
            child.once('exit', code => { clearTimeout(timer); code === 0 ? resolve() : reject(new Error(`${binary} exited with code ${code}`)); });
        });
    }
    async dispose(): Promise<void> { await Promise.all([...this.children].map(child => this.stop(child))); }
}
