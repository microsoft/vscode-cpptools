import { IndexStatus } from '../engines/languageEngine';

/** clangd may report completed/total in the message without sending a percentage. */
export function backgroundIndexStatus(value: { message?: string; percentage?: number }): IndexStatus {
    const counts = value.message?.match(/\b(\d+)\s*\/\s*(\d+)\b/);
    const completed = counts ? Number(counts[1]) : undefined;
    const total = counts ? Number(counts[2]) : undefined;
    const raw = total && completed !== undefined ? completed / total * 100 : value.percentage;
    const percentage = raw !== undefined && Number.isFinite(raw) ? Math.max(0, Math.min(100, Math.floor(raw))) : undefined;
    return { state: 'building', phase: 'indexing', message: value.message || 'Building project index', completed, total, percentage };
}
