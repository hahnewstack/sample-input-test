import { test, type Page } from '@playwright/test';
import {
  CollectedTestFailure,
  collectTestFailure,
  selectMostSevereError,
} from './errorClassification';

/**
 * Deterministic on-disk name for a spec's failure screenshot.
 *
 * Why this exists: our Failure Architecture (S-01–S-04) catches errors, collects
 * them, and closes the page *inside the test body*; the only throw happens later
 * in `afterAll`. By then every page is closed and the failure is attributed to a
 * hook, so Playwright's `screenshot: 'only-on-failure'` never fires and the
 * failed result carries no screenshot attachment. The auto-task pipeline
 * therefore has nothing to upload.
 *
 * `captureFailureScreenshot()` takes the shot *while the page is still alive*
 * (in the `catch`, before `page.close()`) and writes it under a name that
 * `classify-failures.js` can reproduce purely from the spec path — no
 * attachment plumbing required. KEEP THE SANITISER IN SYNC with
 * `screenshotBasenameForSpec()` in `.github/scripts/classify-failures.js`.
 */
function specKeyFromFile(file: string): string {
  let s = String(file || '').replace(/\\/g, '/').replace(/^\.\//, '');
  const marker = 'playwright/tests/';
  const i = s.indexOf(marker);
  if (i >= 0) s = s.slice(i + marker.length);
  return s;
}

export function failureShotBasename(specFileOrKey: string): string {
  const safe = specKeyFromFile(specFileOrKey)
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return `failure-shot__${safe}.png`;
}

/**
 * Best-effort failure screenshot. Call from a `catch` block BEFORE the page is
 * closed. Never throws — a screenshot must not be able to fail the test or mask
 * the real error. Writes into the Playwright output dir (swept into the report's
 * `screenshots/` folder by the CI composite action) and also attaches it to the
 * HTML report for local debugging.
 */
export async function captureFailureScreenshot(page: Page): Promise<void> {
  try {
    if (!page || page.isClosed()) return;
    const info = test.info();
    if (!info) return;
    const basename = failureShotBasename(info.file);
    const target = info.outputPath(basename);
    await page.screenshot({ path: target, fullPage: true });
    await info.attach('screenshot', { path: target, contentType: 'image/png' });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(
      `[failureHelpers] captureFailureScreenshot skipped: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }
}

export interface RecordFailureParams {
  testName: string;
  language: string;
  error: Error;
  context?: Record<string, string>;
}

export function recordFailure(
  list: CollectedTestFailure[],
  params: RecordFailureParams,
): void {
  list.push(
    collectTestFailure({
      testName: params.testName,
      language: params.language,
      originalError: params.error,
      context: params.context ?? {},
    }),
  );
}

const defaultFormatter = (f: CollectedTestFailure): string =>
  `[${f.category.toUpperCase()}] ${f.language.toUpperCase()} | ${f.testName} | ${f.message}`;

export function throwMostSevereIfAny(
  failures: CollectedTestFailure[],
  formatMessage: (failure: CollectedTestFailure) => string = defaultFormatter,
): void {
  const mostSevere = selectMostSevereError(failures);
  if (!mostSevere) return;

  if (process.env.SHOW_STACKTRACE === 'true' && mostSevere.originalError) {
    throw mostSevere.originalError;
  }

  const err = new Error(formatMessage(mostSevere));
  if (mostSevere.originalError?.name) err.name = mostSevere.originalError.name;
  throw err;
}

export function toCsvRows(
  failures: CollectedTestFailure[],
): Array<Record<string, unknown>> {
  return failures.map((f) => {
    const flatContext = Object.fromEntries(
      Object.entries(f.context ?? {}).map(([k, v]) => [`context.${k}`, v]),
    );
    return { ...f, ...flatContext, testStatus: 'failed' as const };
  });
}
