/**
 * Navigation helper for the standalone migration-redirections sample.
 * gotoWithRetry() is copied verbatim from react-testing playwright/tests/utils/navigation.ts;
 * TIMING and sanitizeFilename are inlined so this file has no other project dependencies.
 */
import { Page, Response, Request } from '@playwright/test';
import { SCREENSHOTS_DIR, ensureReportDirectory } from './reportPaths';
import { join } from 'path';
import { logError, logInfo, logWarn } from './logger';

const TIMING = {
    MEDIUM: 10000,  // 10 seconds - For moderate complexity operations
    MAX: 180000     // 3 minutes - Absolute maximum for any single test
};

function sanitizeFilename(filename: string): string {
    if (!filename) return '';
    return filename
        .replace(/["<>|*?:\/\r\n]/g, '_')
        .replace(/_{2,}/g, '_')
        .replace(/^_+|_+$/g, '')
        .substring(0, 200);
}

export async function gotoWithRetry(
    page: Page,
    url: string,
    maxRetries = 3,
    waitUntil: 'domcontentloaded' | 'load' | 'networkidle' = 'domcontentloaded',
    retryDelay5xxMs?: number,
    timeout?: number
): Promise<{ response: Response | null; redirects: string[] }> {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        let response: Response | null = null;
        try {
            logInfo(`Attempt ${attempt} to navigate to URL: ${url} (waitUntil: ${waitUntil})`);
            const navigationTimeout =
                timeout ?? (waitUntil === 'networkidle' ? TIMING.MEDIUM : TIMING.MAX);

            response = await page.goto(url, {
                waitUntil,
                timeout: navigationTimeout
            });
            logInfo('Response:', response?.status());

            // Check if response status is 200, if not, treat as retryable error
            if (response?.status() !== 200) {
                console.error(`Failed to load URL ${url}: ${response?.status()}`);

                // If this is the last attempt, return the response so caller can check the actual status
                if (attempt === maxRetries) {
                    logError(`Final attempt failed for URL ${url}: ${response?.status()}`);
                    // compute redirects if any, and return structured result
                    const redirectsFinal: string[] = [];
                    try {
                        if (response) {
                            const finalReq = response.request();
                            let r: Request | null = finalReq;
                            while (r) {
                                // insert at beginning to have earliest -> latest order
                                redirectsFinal.unshift(r.url());
                                r = r.redirectedFrom();
                            }
                        }
                    } catch (e) {
                        // ignore any errors while computing redirects
                    }
                    return { response, redirects: redirectsFinal };
                }

                // 5xx (e.g. 502, 503): use longer delay when provided so gateways can recover
                const status = response?.status() ?? 0;
                const is5xx = status >= 500 && status < 600;
                const delayMs = (is5xx && retryDelay5xxMs !== undefined) ? retryDelay5xxMs : 1000 * attempt;
                logInfo(`Non-200 status code: ${status}. Retrying in ${delayMs}ms...`);
                await new Promise(r => setTimeout(r, delayMs));
                continue; // Go to next retry attempt
            }

            // Success! compute redirect chain and return structured result
            const redirects: string[] = [];
            try {
                if (response) {
                    const finalReq = response.request();
                    let r: Request | null = finalReq;
                    while (r) {
                        redirects.unshift(r.url());
                        r = r.redirectedFrom();
                    }
                }
            } catch (e) {
                // ignore any errors while computing redirects
            }

            return { response, redirects };
        } catch (error) {
                let errMsg: string = String((error as Error)?.message ?? error);

                // 🟡 HANDLE NETWORKIDLE TIMEOUT FIRST
                const isNetworkIdleTimeout =
                    waitUntil === 'networkidle' &&
                    errMsg.includes('Timeout');

                if (isNetworkIdleTimeout && attempt < maxRetries) {
                    logWarn(`⚠️ networkidle timeout on attempt ${attempt} — refreshing page...`);

                    try {
                        await page.reload({
                            waitUntil: 'domcontentloaded',
                            timeout: 10000
                        });
                    } catch (reloadErr) {
                        logWarn(`Reload failed: ${reloadErr}`);
                    }

                    continue; // skip the rest of catch and retry immediately
                }

                logInfo(`Attempt ${attempt} failed for URL: ${url}\nStatus: ${response?.status()}\nError: ${error}`);

                // Try to take a screenshot for debugging, but don't fail if it doesn't work
                try {
                    const sanitizedUrl = sanitizeFilename(url);
                    ensureReportDirectory(SCREENSHOTS_DIR);
                    await page.screenshot({ path: join(SCREENSHOTS_DIR, `failed-to-load-${sanitizedUrl}-attempt-${attempt}.jpg`) });
                } catch (screenshotError) {
                    logWarn(`Failed to take screenshot for debugging: ${screenshotError}`);
                }

                // If this is the last attempt, return null
                if (attempt === maxRetries) {
                    logError(`Final attempt failed for URL ${url}: ${error}`);
                    return { response: null, redirects: [] };
                }

                // Don't retry if page/context/browser is closed (e.g. new tab opened, frame detached)
                errMsg = String((error as Error)?.message ?? error);
                if (errMsg.includes('Target page, context or browser has been closed') || errMsg.includes('frame was detached') || errMsg.includes('ERR_ABORTED')) {
                    logError(`Page no longer valid (${errMsg}). Not retrying.`);
                    return { response: null, redirects: [] };
                }

                // Wait before retrying with exponential backoff
                logInfo(`Exception occurred. Retrying in ${1000 * attempt}ms...`);
                try {
                    await new Promise(r => setTimeout(r, 1000 * attempt));
                } catch (waitErr) {
                    logError(`Wait before retry failed (page may be closed): ${waitErr}`);
                    return { response: null, redirects: [] };
                }
            }
        }
        return { response: null, redirects: [] };
    }
