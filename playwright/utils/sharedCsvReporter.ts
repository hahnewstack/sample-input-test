/**
 * Shared CSV Reporter Utility
 * 
 * A higher-level wrapper around CsvReportWriter that standardizes CSV report generation
 * across all test types. Automatically adds common fields (environment, site, timestamp)
 * and provides consistent console output formatting.
 * 
 * Features:
 * - Automatically adds common fields to raw result objects
 * - Filters results by testStatus (default: failures/errors only)
 * - Generates single CSV file (no grouping/sheets)
 * - Standardized console output format
 * - Type-safe with generic result types
 */

import { test } from '@playwright/test';
import { CsvReportWriter, CsvColumn } from './ExcelReportWriter';
import { TEST_REPORTS_BASE, ensureReportDirectory } from '../tests/utils/reportPaths';
import { logError, logInfo } from '@/tests/utils/logger';

// ============================================================================
// QA INSTRUCTIONS (appended to every CSV)
// ============================================================================

export const CSV_QA_INSTRUCTIONS: string[] = [
  'Instructions for QA',
  '• Open and check the HTML report (test-results-*.html in test-reports/) for a clearer view and clickable screenshots.',
  '• When sharing with dev/QA, share the entire test-reports folder (or its zip) so the report and screenshots open correctly.'
];

// ============================================================================
// TYPES
// ============================================================================

export interface CsvReportConfig<T extends Record<string, any>> {
  /** Test name for report title */
  testName: string;
  /** Filename pattern (e.g., "footer-links-{site}-{env}-{date}.csv") */
  filename: string;
  /** Column definitions (common fields will be prepended automatically) */
  columns: CsvColumn[];
  /** Raw result objects without common fields (environment, site, timestamp) */
  results: T[];
  /** Report metadata */
  metadata: {
    subject: string;
    description: string;
    testDescription: string;
  };
  /** Optional configuration */
  options?: {
    /** Filter results by testStatus (default: ['failed', 'error']) */
    filterByStatus?: ('failed' | 'error' | 'passed')[];
    /** Output directory (defaults to TEST_REPORTS_BASE) */
    outputDir?: string;
  };
}

export interface CommonFields {
  environment: string;
  site: string;
  timestamp: Date;
}

// ============================================================================
// HELPERS
// ============================================================================

/**
 * Inserts a suffix before the .csv extension.
 * Used to write a fallback copy when the intended path is locked
 * (e.g. the CSV is open in Excel on Windows, which holds an exclusive lock).
 */
function withFilenameSuffix(filename: string, suffix: string): string {
  const dotIndex = filename.lastIndexOf('.');
  if (dotIndex <= 0) return `${filename}${suffix}.csv`;
  return `${filename.slice(0, dotIndex)}${suffix}${filename.slice(dotIndex)}`;
}

// ============================================================================
// MAIN FUNCTION
// ============================================================================

/**
 * Generates a CSV report from test results with automatic common field injection
 * 
 * @param config Report configuration with columns, results, and metadata
 * @param commonFields Common fields to add to each result (environment, site, timestamp)
 * @returns File path of generated CSV, or null if there was nothing to report or
 *          the report could not be written. Never throws — report generation is
 *          non-fatal and must not mask the failures a test collected.
 * 
 * @example
 * ```typescript
 * const filePath = await generateCsvReport({
 *   testName: 'Footer Links Validation',
 *   filename: `footer-links-${site}-${testEnv}-${dateString}.csv`,
 *   columns: [
 *     { header: 'Language', key: 'language', type: 'string' },
 *     { header: 'Link URL', key: 'linkUrl', type: 'string' },
 *     { header: 'Status Code', key: 'statusCode', type: 'string' }
 *   ],
 *   results: rawResults,
 *   metadata: csvMetadata
 * }, {
 *   environment: 'stage',
 *   site: 'mer',
 *   timestamp: new Date()
 * });
 * ```
 */
export async function generateCsvReport<T extends Record<string, any>>(
  config: CsvReportConfig<T>,
  commonFields: CommonFields
): Promise<string | null> {
  const {
    testName,
    filename,
    columns,
    results,
    metadata,
    options = {}
  } = config;

  const {
    filterByStatus = ['failed', 'error'],
    outputDir = TEST_REPORTS_BASE
  } = options;

  // Filter results by testStatus if specified
  const filteredResults = results.filter(result => {
    if (!result.testStatus) return false;
    return filterByStatus.includes(result.testStatus);
  });

  // Early return if no results to report
  if (filteredResults.length === 0) {
    logInfo(`\n✅ No results to generate CSV report. All tests passed!`);
    return null;
  }

  // Log collection statistics
  const resultsByLang = filteredResults.reduce((acc, result) => {
    const lang = result.language || 'unknown';
    if (!acc[lang]) acc[lang] = 0;
    acc[lang]++;
    return acc;
  }, {} as { [key: string]: number });

  logInfo(`\n📊 Collecting results from ${Object.keys(resultsByLang).length} language test(s)...`);
  Object.entries(resultsByLang).forEach(([lang, count]) => {
    logInfo(`  - ${lang.toUpperCase()}: ${count} result(s)`);
  });

  logInfo(`\n📊 Generating CSV report with ${filteredResults.length} result(s) from ${Object.keys(resultsByLang).length} language(s)...`);

  try {
    // Ensure output directory exists
    ensureReportDirectory(outputDir);

    // Prepend common field columns to provided columns
    const commonColumns: CsvColumn[] = [
      { header: 'Environment', key: 'environment', type: 'string' },
      { header: 'Site', key: 'site', type: 'string' },
      { header: 'Timestamp', key: 'timestamp', type: 'date' },
      { header: 'Test Status', key: 'testStatus', type: 'string' },
    ];

    const allColumns = [...commonColumns, ...columns];

    // Add common fields to each result
    const enrichedResults = filteredResults.map(result => ({
      ...result,
      environment: commonFields.environment,
      site: commonFields.site,
      timestamp: commonFields.timestamp
    }));

    // Create a CSV writer targeting a specific filename, with all results in a
    // single sheet (no grouping)
    const buildWriter = (outputFilename: string): CsvReportWriter => {
      const writer = new CsvReportWriter({
        title: testName,
        outputDir: outputDir,
        customFilename: outputFilename,
        metadata: metadata,
        footerInstructions: CSV_QA_INSTRUCTIONS
      });

      writer.addSheet({
        name: testName,
        columns: allColumns,
        data: enrichedResults
      });

      return writer;
    };

    // Save file. If the intended path is not writable (typically the CSV is open
    // in Excel, which holds an exclusive lock on Windows), retry once under a
    // fallback name so the results are not lost.
    const fallbackFilename = withFilenameSuffix(filename, `-alt-${Date.now()}`);
    let filePath: string | null = null;

    for (const candidate of [filename, fallbackFilename]) {
      try {
        filePath = await buildWriter(candidate).saveToFile();
        if (candidate !== filename) {
          logInfo(`⚠️  "${filename}" was not writable — saved this run's report as "${candidate}" instead.`);
        }
        break;
      } catch (error) {
        logError(`Failed to write CSV report to "${candidate}":`, error);
      }
    }

    if (!filePath) {
      logError(
        `⚠️  CSV report could not be written to ${outputDir}. Continuing without it — ` +
        `the test's own pass/fail result is unaffected. If the file is open in Excel, close it and re-run.`
      );
      return null;
    }

    // Attach the CSV to the Playwright report so the report alone has every failure.
    // From afterAll it lands on the last test that ran in the file. test.info()
    // throws outside a test or hook; skip the attachment then.
    try {
      await test.info().attach('CSV report', { path: filePath, contentType: 'text/csv' });
    } catch {
      // Not running inside a Playwright test — nothing to attach to.
    }

    // Standard console output format
    logInfo('');
    logInfo('='.repeat(80));
    logInfo('📊 CSV REPORT GENERATED');
    logInfo('='.repeat(80));
    logInfo(`Report saved to: ${filePath}`);
    logInfo(`Total results: ${filteredResults.length}`);
    
    // Count by status
    const statusCounts = filteredResults.reduce((acc, result) => {
      const status = result.testStatus || 'unknown';
      acc[status] = (acc[status] || 0) + 1;
      return acc;
    }, {} as { [key: string]: number });

    const statusSummary = Object.entries(statusCounts)
      .map(([status, count]) => `${status}: ${count}`)
      .join(', ');
    console.log(`Status breakdown: ${statusSummary}`);

    const languages = Object.keys(resultsByLang).join(', ');
    console.log(`Languages with results: ${languages}`);
    console.log('='.repeat(80));

    return filePath;
  } catch (error) {
    // Reporting is non-fatal: an unwritable or malformed report must never mask
    // the failures the test actually collected. Callers already treat a null
    // return as "no report produced".
    logError('Failed to generate CSV report — continuing without it:', error);
    return null;
  }
}

