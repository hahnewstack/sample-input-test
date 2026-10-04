// This test is intended to be run after migrating a site onto the React stack.
// It accepts a CSV file with URLs to check for redirections. The CSV file should have the following format
// (column names work in either case: Sources/Source, Lang, From/from, To/to):
// Sources,Lang,From,To
// Sitemap,de,https://www.mgalleryboutique.com/de/c/memorable-bed-bett,/de/c/memorable-bed-bett
//
// The test checks which URL the "From" URL redirects to, and compares it to the "To" URL.
// If the "To" URL is a relative path, it will be combined with the configured base URL.
// If the "From" URL does not redirect to the "To" URL, the test will fail and log the failed URLs.
// Known issues:
// - The test only works with headless mode off.
// - When USE_RDFLAG_COOKIE is true, we set rdflag=1 cookie so that from a US IP we are not
//   redirected to the NA site; the redirect comparison normalizes away referrer/rdflag to avoid false failures.
//
// Improvements:
// - The test now handles redirect errors gracefully and continues processing remaining URLs.
// - Redirect loops and other errors are logged but don't stop the entire test run.
import { test } from '@playwright/test';
import playwright from 'playwright';
import fs from 'fs';
import csvParser from 'csv-parser';
import { CollectedTestFailure, FailureSeverity } from '@/utils/errorClassification';
import { recordFailure, throwMostSevereIfAny, toCsvRows } from '@/utils/failureHelpers';
import { generateCsvReport } from '@/utils/sharedCsvReporter';
import { registerCsvReportFromCaller } from '@/utils/csvReportRegistry';
import { gotoWithRetry } from '@/tests/utils/navigation';

// When true, set rdflag=1 cookie before visiting so that from a US IP we are not redirected to the NA site.
// Keep enabled if you are testing from a US IP. Disabled if testing from EU.
const USE_RDFLAG_COOKIE = true;

// Configuration (can be overridden via environment variables)
const CONFIG = {
    csvFilePath: process.env.MIGRATION_CSV_PATH || 'input/migration_redirections.csv',
    requestDelayMs: parseInt(process.env.REQUEST_DELAY_MS || '1000'),
    testTimeoutMs: parseInt(process.env.TEST_TIMEOUT_MS || '18000000'), // 5 hours default
    baseUrl: process.env.BASE_URL || 'https://www.mgalleryboutique.com', // Base URL for relative paths
    maxRows: process.env.MAX_ROWS ? parseInt(process.env.MAX_ROWS) : 0, // 0 or undefined means unlimited
};

// CSV reporting common fields
const testEnv = process.env.TEST_ENV || 'stage';
// eslint-disable-next-line no-restricted-syntax
const site = process.env.CATALOG_ID || 'mgl';

// Normalize CSV row: accept Sources/Source, Lang/lang, From/from, To/to
function getCsvRow(row: Record<string, string>) {
    return {
        source: row.Sources ?? row.Source ?? '',
        lang: row.Lang ?? row.lang ?? '',
        from: row.From ?? row.from ?? '',
        to: row.To ?? row.to ?? '',
    };
}
// Language configuration
const LANGUAGE_CONFIG = {
    en: { locale: 'en-US', urlPattern: '/en/' },
    fr: { locale: 'fr-FR', urlPattern: '/fr/' },
    de: { locale: 'de-DE', urlPattern: '/de/' },
    es: { locale: 'es-ES', urlPattern: '/es/' },
} as const;
// Types for URL records
interface UrlRecord {
    source: string;
    lang: string;
    fromUrl: string;
    toUrl: string;
}

test.describe('Migration Redirections Test', () => {
    test('[REDIRECT-MIGRATION] Check URL redirections from old to new URLs', async () => {
        test.setTimeout(CONFIG.testTimeoutMs);
        const testFailures: CollectedTestFailure[] = [];
        const browser = await playwright.chromium.launch();
        try {
            const records: UrlRecord[] = [];
            // Read CSV file
            await readCsvFile(records);
            // Group URLs by language
            const languageChunks = groupUrlsByLanguage(records);
            // Process each language group
            for (const [language, urls] of Object.entries(languageChunks)) {
                console.log(`Processing language: ${language}`);
                // debug: log the language config
                console.log(`LANGUAGE_CONFIG: ${JSON.stringify(LANGUAGE_CONFIG)}`);
                const locale = LANGUAGE_CONFIG[language.toLowerCase() as keyof typeof LANGUAGE_CONFIG]?.locale;
                if (!locale) {
                    console.warn(`Skipping unsupported language: ${language}`);
                    continue;
                }
                await processUrlsForLanguage(
                    browser,
                    locale,
                    language.toLowerCase(),
                    urls,
                    testFailures
                );
            }
        } finally {
            // Always release the browser, even if CSV read or per-language processing throws.
            await browser.close();
        }

        // Log per-failure details (preserved from original output)
        logTestResults(testFailures);

        // Generate CSV report (failures only)
        const dateString = new Date().toISOString().split('T')[0].replace(/-/g, '');
        const csvPath = await generateCsvReport({
            testName: 'Migration Redirections Validation Results',
            filename: `migration-redirections-${site}-${testEnv}-${dateString}.csv`,
            columns: [
                { header: 'Language', key: 'language', type: 'string' },
                { header: 'Test Name', key: 'testName', type: 'string' },
                { header: 'From URL', key: 'context.fromUrl', type: 'string' },
                { header: 'Expected To URL', key: 'context.expectedToUrl', type: 'string' },
                { header: 'Actual To URL', key: 'context.actualToUrl', type: 'string' },
                { header: 'Status', key: 'context.status', type: 'string' },
                { header: 'Severity', key: 'severityLabel', type: 'string' },
                { header: 'Category', key: 'category', type: 'string' },
                { header: 'Error Message', key: 'message', type: 'string' },
            ],
            // Project a string severity label so QA reads LOW|MEDIUM|HIGH|CRITICAL
            // instead of the numeric FailureSeverity enum values (1–4).
            results: toCsvRows(testFailures).map(row => ({
                ...row,
                severityLabel: FailureSeverity[row.severity as FailureSeverity],
            })),
            metadata: {
                subject: 'Migration Redirections Validation',
                description: `Validation results for ${site} ${testEnv} environment (CSV: ${CONFIG.csvFilePath})`,
                testDescription:
                    'Verifies that legacy URLs from the migration CSV redirect to the expected new-stack URLs and return a 200 status code.',
            },
            options: { filterByStatus: ['failed', 'error'] },
        }, {
            environment: testEnv,
            site,
            timestamp: new Date(),
        });
        if (csvPath) registerCsvReportFromCaller(csvPath);

        // Single throw at the end based on most-severe collected failure.
        throwMostSevereIfAny(testFailures);
    });
});
// Helper Functions
async function readCsvFile(records: UrlRecord[]): Promise<void> {
    let rowCount = 0;
    return new Promise((resolve, reject) => {
        fs.createReadStream(CONFIG.csvFilePath)
            .pipe(csvParser())
            .on('data', (row) => {
                // Skip if we've reached the maximum number of rows
                if (CONFIG.maxRows && rowCount >= CONFIG.maxRows) {
                    return;
                }
                const r = getCsvRow(row);
                const toUrl = (r.to && typeof r.to === 'string')
                    ? (r.to.startsWith('http') ? r.to : `${CONFIG.baseUrl}${r.to}`)
                    : '';
                records.push({
                    source: r.source,
                    lang: r.lang,
                    fromUrl: r.from,
                    toUrl,
                });
                rowCount++;
            })
            .on('end', () => {
                if (CONFIG.maxRows) {
                    console.log(`Testing first ${Math.min(rowCount, CONFIG.maxRows)} rows out of total ${rowCount} rows`);
                } else {
                    console.log(`Testing all ${rowCount} rows`);
                }
                resolve();
            })
            .on('error', reject);
    });
}
function groupUrlsByLanguage(records: UrlRecord[]) {
    return records.reduce((acc, record) => {
        if (!acc[record.lang]) {
            acc[record.lang] = [];
        }
        acc[record.lang].push(record);
        return acc;
    }, {} as Record<string, UrlRecord[]>);
}
/** Set rdflag=1 cookie on the context for the base URL so US IP is not redirected to NA site. */
function setRdflagCookie(context: playwright.BrowserContext): void {
    if (!USE_RDFLAG_COOKIE) return;
    try {
        context.addCookies([{
            name: 'rdflag',
            value: '1',
            url: CONFIG.baseUrl,
        }]);
    } catch {
        // ignore if baseUrl is not a valid URL
    }
}

/** Resolve fromUrl to a full URL so we hit CONFIG.baseUrl and the rdflag cookie is sent. */
function resolveVisitUrl(fromUrl: string): string {
    if (fromUrl.startsWith('http://') || fromUrl.startsWith('https://')) return fromUrl;
    const base = CONFIG.baseUrl.replace(/\/$/, '');
    const path = fromUrl.startsWith('/') ? fromUrl : `/${fromUrl}`;
    return `${base}${path}`;
}

async function processUrlsForLanguage(
    browser: playwright.Browser,
    locale: string,
    language: string,
    urls: UrlRecord[],
    failures: CollectedTestFailure[]
): Promise<void> {
    const context = await browser.newContext({ locale });
    setRdflagCookie(context);
    const page = await context.newPage();
    // Land on base URL first so the rdflag cookie is sent on subsequent requests
    await gotoWithRetry(page, CONFIG.baseUrl, 1, 'domcontentloaded');
    for (const { fromUrl, toUrl } of urls) {
        const visitUrl = resolveVisitUrl(fromUrl);
        console.log(`Checking redirection from ${fromUrl} to ${toUrl}`);
        const { response } = await gotoWithRetry(page, visitUrl, 1, 'domcontentloaded');
        const actualToUrl = page.url();
        if (response === null) {
            recordFailure(failures, {
                testName: 'Migration Redirection - Navigation Error',
                language,
                error: new Error(`Navigation failed for: ${visitUrl}`),
                context: {
                    fromUrl,
                    expectedToUrl: toUrl,
                    actualToUrl: 'ERROR',
                    status: 'ERROR',
                },
            });
        } else {
            checkRedirection(language, fromUrl, toUrl, actualToUrl, failures);
            checkStatusCode(language, fromUrl, toUrl, actualToUrl, response.status(), failures);
        }
        // Delay between requests to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, CONFIG.requestDelayMs));
    }
    await context.close();
}
/** Normalize URL for comparison: strip trailing slash and referrer=internal / rdflag query params. */
function normalizeUrlForComparison(url: string): string {
    let u = url.endsWith('/') ? url.slice(0, -1) : url;
    try {
        const parsed = new URL(u.startsWith('http') ? u : `https://placeholder${u.startsWith('/') ? '' : '/'}${u}`);
        const params = parsed.searchParams;
        params.delete('referrer');
        params.delete('rdflag');
        parsed.search = params.toString();
        u = parsed.pathname + (parsed.search ? `?${parsed.search}` : '');
    } catch {
        // keep u as-is if URL parsing fails
    }
    return u;
}

function checkRedirection(
    language: string,
    fromUrl: string,
    expectedToUrl: string,
    actualToUrl: string,
    failures: CollectedTestFailure[]
): void {
    if (normalizeUrlForComparison(actualToUrl) !== normalizeUrlForComparison(expectedToUrl)) {
        recordFailure(failures, {
            testName: 'Migration Redirection - Mismatched Destination',
            language,
            error: new Error(`Redirected to unexpected URL: expected ${expectedToUrl}, got ${actualToUrl}`),
            context: {
                fromUrl,
                expectedToUrl,
                actualToUrl,
                status: '',
            },
        });
    }
}
function checkStatusCode(
    language: string,
    fromUrl: string,
    expectedToUrl: string,
    actualToUrl: string,
    status: number | undefined,
    failures: CollectedTestFailure[]
): void {
    if (status !== 200) {
        const statusStr = status?.toString() || 'unknown';
        recordFailure(failures, {
            testName: 'Migration Redirection - Non-200 Status',
            language,
            error: new Error(`Expected 200 status, got ${statusStr}`),
            context: {
                fromUrl,
                expectedToUrl,
                actualToUrl,
                status: statusStr,
            },
        });
    }
}
function logTestResults(failures: CollectedTestFailure[]): void {
    const mismatches = failures.filter(f => f.testName === 'Migration Redirection - Mismatched Destination');
    const non200 = failures.filter(f => f.testName === 'Migration Redirection - Non-200 Status');
    const errors = failures.filter(f => f.testName === 'Migration Redirection - Navigation Error');

    if (mismatches.length > 0) {
        console.error('\nFailed to redirect the following URLs:');
        mismatches.forEach(f => {
            console.error(`From URL: ${f.context?.fromUrl}`);
            console.error(`Expected To URL: ${f.context?.expectedToUrl}`);
            console.error(`Actual To URL: ${f.context?.actualToUrl}`);
            console.error('');
        });
    }
    if (non200.length > 0) {
        console.error('\nThe following URLs did not return a 200 status code:');
        non200.forEach(f => {
            console.error(`URL: ${f.context?.fromUrl}`);
            console.error(`Expected To URL: ${f.context?.expectedToUrl}`);
            console.error(`Status: ${f.context?.status}\n`);
        });
    }
    if (errors.length > 0) {
        console.error('\nNavigation errors encountered:');
        errors.forEach(f => {
            console.error(`URL: ${f.context?.fromUrl} | Status: ${f.context?.status} | ${f.message}`);
        });
    }
}
