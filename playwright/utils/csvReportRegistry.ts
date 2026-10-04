/**
 * Passive registry for CSV report paths, so the terminal summary reporter can list
 * generated CSVs after a run. Registration happens only after a CSV is successfully
 * written; this module does not generate or modify CSV logic.
 */

import fs from 'fs';
import path from 'path';

const REGISTRY_PATH = path.join(process.cwd(), 'test-reports', 'csv-registry.ndjson');

export interface CsvRegistryEntry {
  specLabel: string;
  csvPath: string;
  /** Optional display title for the aggregate HTML (e.g. test describe or report name). Falls back to specLabel if omitted. */
  reportTitle?: string;
}

export interface RegisterCsvReportOptions {
  /** Display title for this report in the aggregate HTML (e.g. test describe or report name). */
  reportTitle?: string;
}

/**
 * Appends a CSV report entry to the registry. Call after generateCsvReport returns a path.
 * Derives the spec label from the call site (first .spec.ts in stack).
 * Pass options.reportTitle to use a custom section title in the aggregate HTML (e.g. test describe).
 */
export function registerCsvReportFromCaller(csvPath: string, options?: RegisterCsvReportOptions): void {
  const specLabel = getSpecLabelFromStack();
  const entry: CsvRegistryEntry = { specLabel, csvPath };
  if (options?.reportTitle !== undefined && options.reportTitle !== '') {
    entry.reportTitle = options.reportTitle;
  }
  appendEntry(entry);
}

/**
 * Appends a single entry to the registry file (NDJSON).
 */
function appendEntry(entry: CsvRegistryEntry): void {
  try {
    const dir = path.dirname(REGISTRY_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(REGISTRY_PATH, JSON.stringify(entry) + '\n', 'utf8');
  } catch {
    // Passive: do not throw; registry is optional for terminal display
  }
}

function getSpecLabelFromStack(): string {
  try {
    const stack = new Error().stack || '';
    const lines = stack.split('\n');
    for (const line of lines) {
      const match = line.match(/([^/\\]+\.spec\.ts)/);
      if (match) return match[1];
    }
  } catch {
    // ignore
  }
  return 'unknown.spec.ts';
}

/**
 * Clears the registry file. Called by the terminal summary reporter in onBegin.
 */
export function clearCsvRegistry(): void {
  try {
    if (fs.existsSync(REGISTRY_PATH)) fs.writeFileSync(REGISTRY_PATH, '', 'utf8');
  } catch {
    // ignore
  }
}

/**
 * Path to the registry file (for the reporter to read).
 */
export function getCsvRegistryPath(): string {
  return REGISTRY_PATH;
}
