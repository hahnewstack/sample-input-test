export const VERBOSE = process.env.VERBOSE_LOGS === 'true';

export function logInfo(...args: any[]) {
    if (VERBOSE) {
        console.log(...args);
    }
}

export function logError(...args: any[]) {
    if (VERBOSE) {
        console.error(...args);
    }
}

export function logWarn(...args: any[]) {
    if (VERBOSE) {
        console.warn(...args);
    }
}