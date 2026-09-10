import * as os from 'node:os';

export function threadCount(usage: string, count = os.cpus().length): number {
    const ratios: Record<string, number> = { Maximum: 1, High: 0.75, Medium: 0.5, Low: 0.25 };
    return Math.max(1, Math.floor(Math.max(1, count) * (ratios[usage] ?? 0.5)));
}
